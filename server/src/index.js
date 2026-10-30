'use strict';
try {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  require('dotenv').config();
} catch (e) {
  // Di Cloudflare Workers fs tidak tersedia — env datang dari binding.
}
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { db, initSchema, setSetting, audit, DB_PATH } = require('./db');
const { asyncHandler, errorHandler, badRequest } = require('./middleware/helpers');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 4000;

// Parser JSON sendiri (body-parser/iconv-lite tidak ter-bundle bersih di Cloudflare Workers).
function jsonBody(limit = 2 * 1024 * 1024) {
  return (req, res, next) => {
    if (req._body) return next();
    req.body = {};
    const type = req.headers['content-type'] || '';
    if (!/^application\/json\b/i.test(type)) return next();
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      next(err);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error('Payload terlalu besar (maksimal 2 MB).');
        err.status = 413;
        fail(err);
        if (typeof req.pause === 'function') req.pause();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (!chunks.length) return next();
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        req.body = parsed === null || parsed === undefined ? {} : parsed;
        req._body = true;
        next();
      } catch (e) {
        const err = new Error('Body JSON tidak valid.');
        err.status = 400;
        next(err);
      }
    });
    req.on('error', fail);
  };
}

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(jsonBody());
app.use(cookieParser());

// Bootstrap skema+roles sebelum request pertama dilayani (Node & Workers sama).
const ready = initSchema()
  .then(() => {
    console.log('bootstrap: schema ok');
    return ensureRoles();
  })
  .then(() => console.log('bootstrap: roles ok'));

app.use((req, res, next) => {
  ready.then(() => next()).catch(next);
});

// Keamanan dasar header
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Ensure roles default ada (async — jalankan setelah server start agar tidak blocking).
async function ensureRoles() {
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM roles').get()).n;
  if (n === 0) {
    await db.batch([
      { sql: 'INSERT INTO roles (code, name) VALUES (?,?)', params: ['direktur', 'Direktur/Pengelola'] },
      { sql: 'INSERT INTO roles (code, name) VALUES (?,?)', params: ['sekretaris', 'Sekretaris/Admin'] },
      { sql: 'INSERT INTO roles (code, name) VALUES (?,?)', params: ['tentor', 'Tentor'] },
    ]);
  }
  if (!(await db.prepare('SELECT 1 FROM settings WHERE key=?').get('nama_lembaga'))) {
    await setSetting('nama_lembaga', 'Bimbel Rumah Pintar');
  }
}

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/students', require('./routes/students'));
app.use('/api/tutors', require('./routes/tutors'));
app.use('/api/catalog', require('./routes/catalog'));
app.use('/api/data', require('./routes/classes'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/journals', require('./routes/journals'));
app.use('/api/assessments', require('./routes/assessments'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/archives', require('./routes/archives'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/laporan', require('./routes/laporan'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', app: 'Sistem Informasi Manajemen Bimbel Rumah Pintar', time: new Date().toISOString() });
});

// Hapus data demo (sekali jalan, direktur saja via body confirm)
app.post('/api/maintenance/purge-demo', requireAuth, asyncHandler(async (req, res) => {
  if (req.user.role !== 'direktur') return res.status(403).json({ error: 'Hanya direktur yang dapat menghapus data demo.' });
  if (!req.body || req.body.confirm !== 'HAPUS DEMO') return res.status(400).json({ error: 'Ketik "HAPUS DEMO" untuk konfirmasi.' });

  // Hapus data demo tanpa PRAGMA (D1 tidak mendukungnya). Andalkan ON DELETE di skema
  // dan urutan delete anak -> induk agar tidak melanggar FK. Dibungkus try agar
  // satu statement yang bentrok tidak menggagalkan seluruh operasi.
  const items = [];
  const pushSafe = (sql, params = []) => items.push({ sql, params });
  try {
    const demoStudents = (await db.prepare('SELECT id FROM students WHERE is_demo=1').all()).map((r) => r.id);
    const demoTutors = (await db.prepare('SELECT id FROM tutors WHERE is_demo=1').all()).map((r) => r.id);

    const studentTables = ['payment_allocations', 'payments', 'student_attendances', 'assessments', 'student_reports', 'invoices', 'class_students', 'student_subjects', 'student_guardians', 'archives'];
    const tutorTables = ['schedules', 'class_sessions', 'teaching_journals', 'tutor_attendances', 'student_reports'];

    for (const id of demoStudents) {
      for (const t of studentTables) pushSafe(`DELETE FROM ${t} WHERE student_id=?`, [id]);
      pushSafe('DELETE FROM students WHERE id=?', [id]);
    }
    for (const id of demoTutors) {
      for (const t of tutorTables) pushSafe(`DELETE FROM ${t} WHERE tutor_id=?`, [id]);
      pushSafe('DELETE FROM users WHERE tutor_id=?', [id]);
      pushSafe('DELETE FROM classes WHERE tutor_id=?', [id]);
      pushSafe('DELETE FROM tutors WHERE id=?', [id]);
    }
    pushSafe('DELETE FROM classes WHERE is_demo=1');
    pushSafe('DELETE FROM archives WHERE is_demo=1');
    pushSafe('DELETE FROM invoices WHERE is_demo=1');
    pushSafe('DELETE FROM payments WHERE is_demo=1');

    for (const item of items) {
      try {
        await db.prepare(item.sql).run(...item.params);
      } catch (e) {
        console.error('purge-demo lewati:', item.sql, e.message);
      }
    }
    await audit(req.user.id, req.user.fullName, 'HAPUS_DATA_DEMO', null, null, 'Seluruh data simulasi dihapus', req.ip);
  } catch (e) {
    throw badRequest('Gagal menghapus data demo: ' + e.message);
  }
  res.json({ message: 'Data demo berhasil dihapus. Akun login demo tetap ada dan dapat dihapus manual dari menu Pengguna.' });
}));

// Serve build client (produksi) — hanya bila filesystem tersedia (Node).
try {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api).*/, (req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }
} catch (e) {
  // Workers: aset statis disediakan binding terpisah.
}

app.use(errorHandler);

// Mode Node: listen setelah bootstrap sukses. Mode Workers: entry memanggil startServer().
function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    ready
      .then(() => {
        const server = app.listen(Number(port), () => {
          console.log(`\n  Bimbel Rumah Pintar API berjalan di http://localhost:${port}`);
          console.log(`  Database: ${db.backend === 'd1' ? 'Cloudflare D1' : DB_PATH}\n`);
          resolve(server);
        });
        server.on('error', reject);
      })
      .catch((e) => {
        console.error('Gagal bootstrap database:', e);
        reject(e);
      });
  });
}

if (!process.env.CF_WORKER) {
  startServer().catch(() => process.exit(1));
}

module.exports = { app, ready, startServer };
