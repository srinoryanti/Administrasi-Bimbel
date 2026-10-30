'use strict';
const express = require('express');
const path = require('path');
const multer = require('multer');
const storage = require('../storage');
const { db, audit, nextNumber, todayISO } = require('../db');
const { requireAuth, requireRole, isTutor } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../middleware/helpers');

const router = express.Router();
router.use(requireAuth);

// Penyimpanan di luar folder publik — hanya dapat diakses melalui endpoint terproteksi.
const ALLOWED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx', '.xls', '.xlsx']);
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new Error(`Tipe file tidak diizinkan: ${ext}. Yang diizinkan: ${[...ALLOWED_EXT].join(', ')}`));
    cb(null, true);
  },
});

function archiveKey(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  return `archive/${todayISO().slice(0, 7)}/${storage.randomKey(ext)}`;
}

const CATEGORIES = [
  'Arsip siswa', 'Arsip tentor', 'Arsip administrasi', 'Arsip pembelajaran',
  'Arsip absensi', 'Arsip rapor', 'Arsip keuangan', 'Surat masuk', 'Surat keluar', 'Arsip laporan',
];

async function canAccessArchive(user, row) {
  if (user.role === 'direktur' || user.role === 'sekretaris') return true;
  if (user.role === 'tentor') {
    if (row.tutor_id && row.tutor_id === user.tutorId) return true;
    if (row.student_id) {
      const owns = await db.prepare(
        `SELECT 1 FROM class_students cs JOIN classes c ON c.id = cs.class_id
         WHERE cs.student_id = ? AND c.tutor_id = ? AND cs.status='aktif' LIMIT 1`
      ).get(row.student_id, user.tutorId);
      if (owns) return true;
    }
    // Arsip rapor milik siswa yang diampu boleh diakses; kategori lain tidak.
    return false;
  }
  return false;
}

function mapArchive(r) {
  return {
    id: r.id, docCode: r.doc_code, docName: r.doc_name, docNumber: r.doc_number, category: r.category,
    description: r.description, docDate: r.doc_date, year: r.year, fileName: r.file_name, fileType: r.file_type,
    fileSize: r.file_size, version: r.version, status: r.status, studentId: r.student_id, tutorId: r.tutor_id,
    studentName: r.student_name, tutorName: r.tutor_name, uploaderName: r.uploader_name,
    createdAt: r.created_at, updatedAt: r.updated_at, isDemo: !!r.is_demo,
  };
}

router.get('/categories', (req, res) => res.json({ data: CATEGORIES }));

router.get('/', asyncHandler(async (req, res) => {
  const { search = '', category = '', year = '', studentId = '', status = '' } = req.query;
  const params = [];
  const where = [];
  if (isTutor(req.user)) {
    // Tentor: hanya arsip miliknya atau arsip siswa yang diampu.
    where.push(`(a.tutor_id = ? OR a.student_id IN (
      SELECT cs.student_id FROM class_students cs JOIN classes c ON c.id = cs.class_id
      WHERE c.tutor_id = ? AND cs.status = 'aktif'))`);
    params.push(req.user.tutorId, req.user.tutorId);
  }
  if (search) { where.push('(a.doc_name LIKE ? OR a.doc_code LIKE ? OR a.doc_number LIKE ?)'); const s = `%${search}%`; params.push(s, s, s); }
  if (category) { where.push('a.category = ?'); params.push(category); }
  if (year) { where.push('a.year = ?'); params.push(Number(year)); }
  if (studentId) { where.push('a.student_id = ?'); params.push(Number(studentId)); }
  if (status) { where.push('a.status = ?'); params.push(status); }
  const rows = await db.prepare(
    `SELECT a.*, s.full_name AS student_name, t.full_name AS tutor_name, u.full_name AS uploader_name
     FROM archives a LEFT JOIN students s ON s.id = a.student_id LEFT JOIN tutors t ON t.id = a.tutor_id
     LEFT JOIN users u ON u.id = a.uploaded_by
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT 500`
  ).all(...params);
  res.json({ data: rows.map(mapArchive) });
}));

router.get('/years', asyncHandler(async (req, res) => {
  const rows = await db.prepare('SELECT DISTINCT year FROM archives WHERE year IS NOT NULL ORDER BY year DESC').all();
  res.json({ data: rows.map((r) => r.year) });
}));

router.get('/:id/versions', asyncHandler(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM archive_versions WHERE archive_id = ? ORDER BY version DESC').all(Number(req.params.id));
  res.json({ data: rows });
}));

router.get('/:id/download', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM archives WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
  if (!(await canAccessArchive(req.user, row))) return res.status(403).json({ error: 'Anda tidak memiliki izin mengunduh dokumen ini.' });
  if (!(await storage.exists(row.file_path))) return res.status(404).json({ error: 'Berkas tidak ditemukan di penyimpanan.' });
  await audit(req.user.id, req.user.fullName, 'UNDUH_DOKUMEN', 'archives', id, row.doc_code, req.ip);
  const inline = req.query.inline === '1' && ['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(row.file_name).toLowerCase());
  res.setHeader('Content-Type', row.file_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${row.file_name}"`);
  const s = await storage.stream(row.file_path);
  s.pipe(res);
}));

router.post('/', requireRole('sekretaris', 'direktur', 'tentor'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw badRequest('Berkas wajib diunggah.');
  const b = req.body || {};
  if (!b.docName || !b.category) {
    throw badRequest('Nama dokumen dan kategori wajib diisi.');
  }
  if (!CATEGORIES.includes(b.category)) {
    throw badRequest('Kategori arsip tidak valid.');
  }
  if (isTutor(req.user) && !['Arsip pembelajaran', 'Arsip absensi', 'Arsip rapor'].includes(b.category)) {
    throw badRequest('Tentor hanya dapat mengunggah arsip pembelajaran, absensi, atau rapor.');
  }
  const key = archiveKey(req.file);
  await storage.put(key, req.file.buffer, req.file.mimetype);
  const docCode = await nextNumber(db, 'ARS', 'archives', 'doc_code');
  const info = await db.prepare(
    `INSERT INTO archives (doc_code, doc_name, doc_number, category, description, doc_date, year,
      file_name, file_path, file_type, file_size, student_id, tutor_id, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    docCode, b.docName, b.docNumber || null, b.category, b.description || null, b.docDate || todayISO(),
    Number((b.docDate || todayISO()).slice(0, 4)), req.file.originalname, key,
    req.file.mimetype, req.file.size, b.studentId || null,
    isTutor(req.user) ? req.user.tutorId : (b.tutorId || null), req.user.id
  );
  await audit(req.user.id, req.user.fullName, 'UNGGAH_DOKUMEN', 'archives', Number(info.lastInsertRowid), { docCode, nama: b.docName }, req.ip);
  res.status(201).json({ message: 'Dokumen berhasil diunggah.', id: Number(info.lastInsertRowid), docCode });
}));

// Ganti dokumen → simpan versi lama
router.post('/:id/replace', requireRole('sekretaris', 'direktur'), upload.single('file'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM archives WHERE id = ?').get(id);
  if (!row) throw notFound('Dokumen tidak ditemukan.');
  if (!req.file) throw badRequest('Berkas pengganti wajib diunggah.');
  await db.prepare(
    `INSERT INTO archive_versions (archive_id, version, file_name, file_path, file_size, note, replaced_by)
     VALUES (?,?,?,?,?,?,?)`
  ).run(id, row.version, row.file_name, row.file_path, row.file_size, req.body.note || 'Penggantian dokumen', req.user.id);
  const key = archiveKey(req.file);
  await storage.put(key, req.file.buffer, req.file.mimetype);
  await db.prepare(
    `UPDATE archives SET file_name=?, file_path=?, file_type=?, file_size=?, version=version+1,
      updated_at=datetime('now','+7 hours') WHERE id=?`
  ).run(req.file.originalname, key, req.file.mimetype, req.file.size, id);
  await audit(req.user.id, req.user.fullName, 'GANTI_DOKUMEN', 'archives', id, { versiBaru: row.version + 1 }, req.ip);
  res.json({ message: `Dokumen diganti. Versi lama (v${row.version}) tersimpan dalam riwayat versi.` });
}));

router.put('/:id', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM archives WHERE id = ?').get(id);
  if (!row) throw notFound('Dokumen tidak ditemukan.');
  const b = req.body || {};
  if (b.category && !CATEGORIES.includes(b.category)) return res.status(400).json({ error: 'Kategori tidak valid.' });
  await db.prepare(
    `UPDATE archives SET doc_name=?, doc_number=?, category=?, description=?, doc_date=?, year=?, status=?,
      student_id=?, tutor_id=?, updated_at=datetime('now','+7 hours') WHERE id=?`
  ).run(
    b.docName ?? row.doc_name, b.docNumber ?? row.doc_number, b.category ?? row.category,
    b.description ?? row.description, b.docDate ?? row.doc_date, b.year ?? row.year, b.status ?? row.status,
    b.studentId !== undefined ? b.studentId : row.student_id, b.tutorId !== undefined ? b.tutorId : row.tutor_id, id
  );
  await audit(req.user.id, req.user.fullName, 'UBAH_METADATA_DOKUMEN', 'archives', id, b.docName || row.doc_name, req.ip);
  res.json({ message: 'Metadata dokumen diperbarui.' });
}));

router.delete('/:id', requireRole('direktur', 'sekretaris'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const row = await db.prepare('SELECT * FROM archives WHERE id = ?').get(id);
  if (!row) throw notFound('Dokumen tidak ditemukan.');
  if (row.is_demo) return res.status(400).json({ error: 'Dokumen demo tidak dapat dihapus satu per satu. Gunakan fitur hapus data demo.' });
  await db.prepare(`UPDATE archives SET status='diarsipkan', updated_at=datetime('now','+7 hours') WHERE id=?`).run(id);
  await audit(req.user.id, req.user.fullName, 'ARSIPKAN_DOKUMEN', 'archives', id, row.doc_code, req.ip);
  res.json({ message: 'Dokumen diarsipkan (dinonaktifkan), berkas tetap tersimpan.' });
}));

module.exports = router;
