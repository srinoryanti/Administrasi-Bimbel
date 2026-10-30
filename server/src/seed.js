'use strict';
// Pembuat data awal + data demo untuk Bimbel Rumah Pintar.
//   node src/seed.js          → akun dasar + data demo (jika database kosong)
//   node src/seed.js --reset  → hapus database lama, buat ulang semua
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// Muat server/.env bila ada (mode lokal). Aman bila dotenv tidak tersedia.
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  require('dotenv').config();
} catch (_) { /* opsional */ }

const args = process.argv.slice(2);
const doReset = args.includes('--reset');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'bimbel.db');

if (doReset) {
  const usingD1 = !!(process.env.D1_ACCOUNT_ID && process.env.D1_API_TOKEN && process.env.D1_DATABASE_ID);
  if (usingD1) {
    console.log('Mode D1 aktif — reset file lokal dilewati (data ada di Cloudflare D1).');
  } else {
    for (const suffix of ['', '-wal', '-shm']) {
      const f = DB_PATH + suffix;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    console.log('Database lama dihapus.');
  }
}

const { db, initSchema, todayISO, nextNumber, setSetting } = require('./db');
const storage = require('./storage');
const PDFDocument = require('pdfkit');

const roleOf = async (code) => db.prepare('SELECT * FROM roles WHERE code=?').get(code);

let seed = 20261028;
function rnd() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function between(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

function ymd(d) {
  return d.toISOString().slice(0, 10);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

const HARI_NAMA = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function dummyPdfBuffer(title, lines) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.rect(0, 0, doc.page.width, 70).fill('#1e3a5f');
    doc.fill('#fff').font('Helvetica-Bold').fontSize(16).text('BIMBEL RUMAH PINTAR', 50, 24);
    doc.fill('#000').font('Helvetica-Bold').fontSize(12).text(title, 50, 100);
    doc.font('Helvetica').fontSize(10);
    (lines || []).forEach((l) => doc.text(l, 50, doc.y + 8));
    doc.moveDown(1);
    doc.fill('#999').fontSize(9).text('(Dokumen simulasi untuk data demo)', 50, 700);
    doc.end();
  });
}

async function getSettingSafe(key) {
  const defaults = {
    indicators: '["Disiplin","Tanggung Jawab","Motivasi Belajar","Kemandirian","Kerjasama"]',
    scale_labels: '["Perlu bimbingan","Cukup baik","Baik","Sangat baik"]',
  };
  const row = await db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : defaults[key];
}

async function main() {
  console.log('Menyiapkan data...');
  await initSchema();

  // --- pastikan roles ---
  if ((await db.prepare('SELECT COUNT(*) AS n FROM roles').get()).n === 0) {
    await db.exec(`INSERT INTO roles (code, name) VALUES ('direktur','Direktur/Pengelola'),('sekretaris','Sekretaris/Admin'),('tentor','Tentor')`);
  }

  if ((await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n > 0 && !doReset) {
    console.log('Database sudah berisi data. Gunakan --reset untuk membuat ulang seluruh data.');
    process.exit(0);
  }

  const today = new Date(todayISO() + 'T00:00:00');

  // ========== USERS ==========
  const hash = (p) => bcrypt.hashSync(p, 10);
  const users = [
    { role: 'direktur', username: 'direktur', email: 'direktur@rumahpintar.test', pass: 'Direktur#2026', name: 'H. Ahmad Fauzi, M.Pd.' },
    { role: 'sekretaris', username: 'sekretaris', email: 'sekretaris@rumahpintar.test', pass: 'Sekretaris#2026', name: 'Siti Rahmawati, S.Pd.' },
  ];
  const insUser = db.prepare(`INSERT INTO users (role_id, username, email, password_hash, full_name) VALUES (?,?,?,?,?)`);
  const userIds = {};
  for (const u of users) {
    const r = await insUser.run((await roleOf(u.role)).id, u.username, u.email, hash(u.pass), u.name);
    userIds[u.role] = Number(r.lastInsertRowid);
  }
  const adminId = userIds.direktur;

  // ========== MATA PELAJARAN ==========
  const subjects = [
    ['MTK', 'Matematika'], ['BIN', 'Bahasa Indonesia'], ['BIG', 'Bahasa Inggris'],
    ['IPA', 'IPA Terpadu'], ['IPS', 'IPS Terpadu'], ['PAI', 'Pendidikan Agama Islam'],
    ['PKN', 'Pendidikan Kewarganegaraan'],
    ['MBC', 'Membaca'], ['MNL', 'Menulis'], ['BHR', 'Berhitung'],
  ];
  const subjectIds = {};
  const insSubj = db.prepare('INSERT INTO subjects (code, name) VALUES (?,?)');
  for (const [c, n] of subjects) subjectIds[n] = Number((await insSubj.run(c, n)).lastInsertRowid);

  // ========== PROGRAM BIMBEL ==========
  const programDefs = [
    { code: 'CLS', name: 'Calistung', target: 'TK/RA', dur: 90, sesi: 12, price: 350000, desc: 'Baca, tulis, hitung — jenjang TK/RA. 90 menit, 12 pertemuan/bulan.' },
    { code: 'RGA', name: 'Reguler A', target: 'SD/MI', dur: 90, sesi: 12, price: 400000, desc: 'Program reguler jenjang SD/MI. 90 menit, 12 pertemuan/bulan.' },
    { code: 'RGB', name: 'Reguler B', target: null, dur: 60, sesi: 24, price: 500000, desc: 'Program intensif 60 menit, 24 pertemuan/bulan.' },
  ];
  const programIds = {};
  const insProg = db.prepare(
    `INSERT INTO programs (code, name, target_level, duration_minutes, sessions_per_month, price, description, status, is_demo) VALUES (?,?,?,?,?,?,?, 'aktif', 1)`
  );
  for (const p of programDefs) programIds[p.name] = Number((await insProg.run(p.code, p.name, p.target, p.dur, p.sesi, p.price, p.desc)).lastInsertRowid);
  const progByName = Object.fromEntries(programDefs.map((p) => [p.name, p]));

  // ========== MAPEL PER PROGRAM ==========
  // Calistung: Membaca, Menulis, Berhitung — Reguler A/B: mapel inti
  const insPS = db.prepare('INSERT OR IGNORE INTO program_subjects (program_id, subject_id) VALUES (?,?)');
  const coreSubjects = ['Matematika', 'Bahasa Indonesia', 'Bahasa Inggris', 'IPA Terpadu', 'IPS Terpadu', 'Pendidikan Agama Islam', 'Pendidikan Kewarganegaraan'];
  for (const n of coreSubjects) {
    await insPS.run(programIds['Reguler A'], subjectIds[n]);
    await insPS.run(programIds['Reguler B'], subjectIds[n]);
  }
  for (const n of ['Membaca', 'Menulis', 'Berhitung']) await insPS.run(programIds['Calistung'], subjectIds[n]);

  // ========== TENTOR (demo) ==========
  const tutorDefs = [
    { name: 'Dewi Lestari, S.Pd.', email: 'dewi@rumahpintar.test', phone: '081234560001', education: 'S.Pd. Matematika', expertise: 'Matematika SD-SMA', join: '2024-07-01' },
    { name: 'Rizky Pratama, S.Pd.', email: 'rizky@rumahpintar.test', phone: '081234560002', education: 'S.Pd. Bahasa Inggris', expertise: 'Bahasa Inggris & IPS', join: '2025-01-15' },
  ];
  const insTutor = db.prepare(
    `INSERT INTO tutors (employee_id, full_name, email, phone, address, education, expertise, join_date, status, is_demo) VALUES (?,?,?,?,?,?,?,?, 'aktif', 1)`
  );
  const tutorIds = [];
  for (let i = 0; i < tutorDefs.length; i++) {
    const t = tutorDefs[i];
    const eid = `TTR-${String(i + 1).padStart(4, '0')}`;
    const r = await insTutor.run(eid, t.name, t.email, t.phone, 'Jl. Melati No. ' + (i + 3) + ', Jakarta', t.education, t.expertise, t.join);
    tutorIds.push(Number(r.lastInsertRowid));
  }
  const [tutorA, tutorB] = tutorIds;

  // akun tentor
  const insUserT = db.prepare(`INSERT INTO users (role_id, tutor_id, username, email, password_hash, full_name) VALUES (?,?,?,?,?,?)`);
  const tA = await db.prepare('SELECT * FROM tutors WHERE id=?').get(tutorA);
  const tB = await db.prepare('SELECT * FROM tutors WHERE id=?').get(tutorB);
  await insUserT.run((await roleOf('tentor')).id, tutorA, 'tentor1', tA.email, hash('Tentor#2026'), tA.full_name);
  await insUserT.run((await roleOf('tentor')).id, tutorB, 'tentor2', tB.email, hash('Tentor#2026'), tB.full_name);

  // ========== SISWA (demo) ==========
  const studentDefs = [
    { name: 'Muhammad Rafa Ardiansyah', gp: 'L', bp: 'Jakarta', bd: '2015-03-12', level: 'SD', grade: 'Kelas 4', school: 'SDN Menteng 01', wali: 'Budi Ardiansyah', hub: 'Ayah', wa: '08111000001', prog: 'Reguler A' },
    { name: 'Nadia Putri Anggraini', gp: 'P', bp: 'Depok', bd: '2014-08-25', level: 'SD', grade: 'Kelas 5', school: 'SDN Sukamaju 03', wali: 'Sri Handayani', hub: 'Ibu', wa: '08111000002', prog: 'Reguler A' },
    { name: 'Bagas Dwi Saputra', gp: 'L', bp: 'Bekasi', bd: '2013-01-05', level: 'SD', grade: 'Kelas 6', school: 'SD Harapan Bangsa', wali: 'Agus Saputra', hub: 'Ayah', wa: '08111000003', prog: 'Reguler A' },
    { name: 'Salsabila Aulia Rahma', gp: 'P', bp: 'Jakarta', bd: '2012-11-17', level: 'SMP', grade: 'Kelas 7', school: 'SMPN 24 Jakarta', wali: 'Hj. Ratna Wulandari', hub: 'Ibu', wa: '08111000004', prog: 'Reguler B' },
    { name: 'Fajar Nugroho', gp: 'L', bp: 'Tangerang', bd: '2011-06-30', level: 'SMP', grade: 'Kelas 8', school: 'SMP Cendekia', wali: 'Drs. Hendro Nugroho', hub: 'Ayah', wa: '08111000005', prog: 'Reguler B' },
    { name: 'Aisyah Kamila', gp: 'P', bp: 'Jakarta', bd: '2010-09-08', level: 'SMP', grade: 'Kelas 9', school: 'SMPIT Al-Falah', wali: 'Ust. Hasan Basri', hub: 'Ayah', wa: '08111000006', prog: 'Reguler B' },
    { name: 'Kevin Jonathan Simatupang', gp: 'L', bp: 'Bogor', bd: '2009-04-21', level: 'SMA', grade: 'Kelas 10', school: 'SMA Negeri 6 Bogor', wali: 'Maria Simatupang', hub: 'Ibu', wa: '08111000007', prog: 'Reguler B' },
    { name: 'Anindya Sari Wijaya', gp: 'P', bp: 'Jakarta', bd: '2008-12-02', level: 'SMA', grade: 'Kelas 11', school: 'SMA Persada', wali: 'Wijaya Kusuma', hub: 'Ayah', wa: '08111000008', prog: 'Reguler B' },
    { name: 'Rafi Ahmad Maulana', gp: 'L', bp: 'Depok', bd: '2007-07-19', level: 'SMA', grade: 'Kelas 12', school: 'SMA Negeri 1 Depok', wali: 'Dedi Maulana', hub: 'Ayah', wa: '08111000009', prog: 'Reguler B' },
    { name: 'Kirana Maharani', gp: 'P', bp: 'Jakarta', bd: '2016-02-14', level: 'SD', grade: 'Kelas 3', school: 'SD Kebon Jeruk 02', wali: 'Rina Maharani', hub: 'Ibu', wa: '08111000010', prog: 'Reguler A' },
    { name: 'Kayla Putri Ramadhani', gp: 'P', bp: 'Jakarta', bd: '2020-05-09', level: 'TK', grade: 'TK B', school: 'RA Al-Hikmah', wali: 'Fauzan Ramadhani', hub: 'Ayah', wa: '08111000011', prog: 'Calistung' },
  ];
  const insStudent = db.prepare(
    `INSERT INTO students (nis, full_name, birth_place, birth_date, gender, education_level, school_grade, school_name, address, program, program_id, start_date, status, is_demo)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'aktif',1)`
  );
  const insGuard = db.prepare('INSERT INTO student_guardians (student_id, guardian_name, relation, phone, occupation) VALUES (?,?,?,?,?)');
  const studentIds = [];
  for (let i = 0; i < studentDefs.length; i++) {
    const s = studentDefs[i];
    const start = ymd(addDays(today, -between(60, 400)));
    const r = await insStudent.run(`SIS-${String(i + 1).padStart(4, '0')}`, s.name, s.bp, s.bd, s.gp, s.level, s.grade, s.school,
      `Jl. ${pick(['Mawar', 'Melati', 'Anggrek', 'Dahlia', 'Kenanga'])} No. ${between(1, 50)}, ${pick(['Jakarta Barat', 'Jakarta Selatan', 'Depok', 'Bekasi'])}`, s.prog, programIds[s.prog], start);
    const sid = Number(r.lastInsertRowid);
    studentIds.push(sid);
    await insGuard.run(sid, s.wali, s.hub, s.wa, pick(['Karyawan Swasta', 'Wiraswasta', 'PNS', 'Ibu Rumah Tangga', 'Guru']));
  }

  // ========== KELAS (berbasis program; mapel opsional untuk penilaian jenjang SD ke atas) ==========
  const classDefs = [
    { name: 'Calistung TK/RA – Angkatan 1', level: 'TK', prog: 'Calistung', subj: null, type: 'kelompok', tutor: tutorB, loc: 'Ruang TK', days: [1, 3, 5], start: '08:00', students: [10] },
    { name: 'Reguler A – SD Kelas 4', level: 'SD', prog: 'Reguler A', subj: 'Matematika', type: 'kelompok', tutor: tutorA, loc: 'Ruang 1', days: [1], start: '15:30', students: [0, 9] },
    { name: 'Reguler A – SD Kelas 5', level: 'SD', prog: 'Reguler A', subj: 'IPA Terpadu', type: 'kelompok', tutor: tutorA, loc: 'Ruang 2', days: [3], start: '15:30', students: [1] },
    { name: 'Reguler A – SD Kelas 6', level: 'SD', prog: 'Reguler A', subj: 'Matematika', type: 'kelompok', tutor: tutorA, loc: 'Ruang 1', days: [5], start: '16:00', students: [2] },
    { name: 'Reguler B – SMP Kelas 7', level: 'SMP', prog: 'Reguler B', subj: 'Matematika', type: 'kelompok', tutor: tutorA, loc: 'Ruang 3', days: [2, 4], start: '17:00', students: [3] },
    { name: 'Reguler B – SMP Kelas 8', level: 'SMP', prog: 'Reguler B', subj: 'Bahasa Inggris', type: 'kelompok', tutor: tutorB, loc: 'Ruang 2', days: [2], start: '17:00', students: [4] },
    { name: 'Reguler B – SMP Kelas 9', level: 'SMP', prog: 'Reguler B', subj: 'Bahasa Indonesia', type: 'kelompok', tutor: tutorB, loc: 'Ruang 3', days: [4], start: '17:00', students: [5] },
    { name: 'Reguler B – SMA Kelas 10', level: 'SMA', prog: 'Reguler B', subj: 'Matematika', type: 'kelompok', tutor: tutorA, loc: 'Ruang 4', days: [6], start: '09:00', students: [6] },
    { name: 'Privat – Anindya (Reguler B)', level: 'SMA', prog: 'Reguler B', subj: 'Matematika', type: 'privat', tutor: tutorA, loc: 'Ruang Privat', days: [4], start: '19:00', students: [7] },
    { name: 'Privat – Rafi (Reguler B)', level: 'SMA', prog: 'Reguler B', subj: 'Bahasa Inggris', type: 'privat', tutor: tutorB, loc: 'Ruang Privat', days: [5], start: '19:00', students: [8] },
  ];
  const insClass = db.prepare(
    `INSERT INTO classes (class_code, name, level, program_id, subject_id, type, tutor_id, location, capacity, status, is_demo) VALUES (?,?,?,?,?,?,?,?,?,'aktif',1)`
  );
  const insCS = db.prepare(`INSERT INTO class_students (class_id, student_id, joined_at) VALUES (?,?,?)`);
  const insSS = db.prepare(`INSERT OR IGNORE INTO student_subjects (student_id, subject_id, class_id, tutor_id, joined_at) VALUES (?,?,?,?,?)`);
  const insSched = db.prepare(`INSERT INTO schedules (class_id, tutor_id, day_of_week, start_time, end_time, location) VALUES (?,?,?,?,?,?)`);
  const insPSStu = db.prepare(`INSERT OR IGNORE INTO student_subjects (student_id, subject_id, class_id, tutor_id, joined_at) VALUES (?,?,NULL,NULL,?)`);
  const classIds = [];
  for (let i = 0; i < classDefs.length; i++) {
    const c = classDefs[i];
    const code = `KLS-${String(i + 1).padStart(4, '0')}`;
    // Jam selesai otomatis = jam mulai + durasi program
    const p = progByName[c.prog];
    const endMin = c.start.split(':').reduce((a, b) => Number(a) * 60 + Number(b)) + p.dur;
    const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
    const r = await insClass.run(code, c.name, c.level, programIds[c.prog], c.subj ? subjectIds[c.subj] : null, c.type, c.tutor, c.loc, c.type === 'privat' ? 1 : 12);
    const cid = Number(r.lastInsertRowid);
    classIds.push(cid);
    for (const si of c.students) {
      await insCS.run(cid, studentIds[si], ymd(addDays(today, -between(50, 300))));
      if (c.subj) await insSS.run(studentIds[si], subjectIds[c.subj], cid, c.tutor, todayISO());
    }
    for (const day of c.days) await insSched.run(cid, c.tutor, day, c.start, end, c.loc);
  }

  // Siswa terdaftar pada seluruh mata pelajaran programnya (untuk rapor & penilaian)
  for (let i = 0; i < studentDefs.length; i++) {
    const s = studentDefs[i];
    const pid = programIds[s.prog];
    if (!pid) continue;
    const subjRows = await db.prepare('SELECT subject_id FROM program_subjects WHERE program_id = ?').all(pid);
    for (const ps of subjRows) {
      await insPSStu.run(studentIds[i], ps.subject_id, todayISO());
    }
  }

  // ========== PERTEMUAN 6 MINGGU TERAKHIR ==========
  const insSession = db.prepare(
    `INSERT OR IGNORE INTO class_sessions (schedule_id, class_id, tutor_id, session_date, start_time, end_time, status, created_by)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  const schedules = await db.prepare('SELECT s.*, c.type FROM schedules s JOIN classes c ON c.id=s.class_id').all();
  const sessionRows = [];
  for (let back = 45; back >= 1; back--) {
    const d = addDays(today, -back);
    const dateStr = ymd(d);
    const dow = d.getDay();
    for (const s of schedules) {
      if (s.day_of_week === dow) {
        const st = back <= 3 && rnd() < 0.08 ? 'batal' : 'selesai';
        const info = await insSession.run(s.id, s.class_id, s.tutor_id, dateStr, s.start_time, s.end_time, st, adminId);
        if (Number(info.changes) > 0) {
          sessionRows.push({ id: Number(info.lastInsertRowid), classId: s.class_id, tutorId: s.tutor_id, date: dateStr, status: st });
        }
      }
    }
  }
  // pertemuan hari ini & besok (belum selesai) untuk dashboard
  const tomorrow = ymd(addDays(today, 1));
  for (const s of schedules) {
    const dowToday = today.getDay();
    if (s.day_of_week === dowToday) {
      const info = await insSession.run(s.id, s.class_id, s.tutor_id, todayISO(), s.start_time, s.end_time, 'terjadwal', adminId);
      if (Number(info.changes) > 0) sessionRows.push({ id: Number(info.lastInsertRowid), classId: s.class_id, tutorId: s.tutor_id, date: todayISO(), status: 'terjadwal' });
    }
    const dt = new Date(tomorrow + 'T00:00:00');
    if (s.day_of_week === dt.getDay()) {
      await insSession.run(s.id, s.class_id, s.tutor_id, tomorrow, s.start_time, s.end_time, 'terjadwal', adminId);
    }
  }

  // ========== ABSENSI SISWA ==========
  const insAtt = db.prepare(
    `INSERT OR IGNORE INTO student_attendances (session_id, student_id, class_id, status, note, recorded_by) VALUES (?,?,?,?,?,?)`
  );
  const classStudents = await db.prepare(`SELECT * FROM class_students WHERE status='aktif'`).all();
  for (const ses of sessionRows) {
    if (ses.status !== 'selesai') continue;
    const members = classStudents.filter((cs) => cs.class_id === ses.classId);
    for (const m of members) {
      const roll = rnd();
      let status = 'hadir', note = null;
      if (roll > 0.93) { status = 'alpa'; note = 'Tanpa keterangan.'; }
      else if (roll > 0.87) { status = 'izin'; note = 'Izin keperluan keluarga.'; }
      else if (roll > 0.82) { status = 'sakit'; note = 'Sakit demam, izin orang tua.'; }
      await insAtt.run(ses.id, m.student_id, ses.classId, status, note, adminId);
    }
  }

  // ========== ABSENSI TENTOR ==========
  const insTAtt = db.prepare(
    `INSERT OR IGNORE INTO tutor_attendances (tutor_id, session_id, att_date, start_time, end_time, status, learning_status, recorded_by) VALUES (?,?,?,?,?,?,?,?)`
  );
  for (const ses of sessionRows) {
    if (ses.status === 'batal') {
      await insTAtt.run(ses.tutorId, ses.id, ses.date, null, null, 'izin', 'dibatalkan', adminId);
      continue;
    }
    if (ses.status !== 'selesai') continue;
    const roll = rnd();
    const status = roll > 0.95 ? 'sakit' : 'hadir';
    await insTAtt.run(ses.tutorId, ses.id, ses.date, null, null, status, 'dilaksanakan', adminId);
  }

  // ========== JURNAL MENGAJAR ==========
  const insJournal = db.prepare(
    `INSERT INTO teaching_journals (session_id, class_id, tutor_id, journal_date, material, objective, activities, outcomes, obstacles, assignments, next_plan, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, 'terisi')`
  );
  const matBySubject = {
    'Matematika': ['Pecahan dan operasinya', 'Bilangan bulat dan operasi', 'Bangun datar: luas dan keliling', 'Aljabar dasar: variabel', 'Persamaan linear satu variabel'],
    'IPA Terpadu': ['Sistem pernapasan manusia', 'Zat dan perubahannya', 'Ekosistem dan rantai makanan', 'Listrik statis dan dinamis'],
    'Bahasa Inggris': ['Daily expressions & greeting', 'Simple present & past tense', 'Reading comprehension: my hobby', 'Descriptive text'],
    'Bahasa Indonesia': ['Teks deskripsi', 'Kosakata dan ejaan', 'Membaca pemahaman: majas', 'Menulis surat pribadi'],
  };
  const classSubj = {};
  for (const c of classDefs) classSubj[c.name] = c.subj;
  const clsRows = await db.prepare('SELECT * FROM classes').all();
  for (const ses of sessionRows) {
    if (ses.status !== 'selesai' || rnd() < 0.25) continue; // sebagian jurnal masih kosong (untuk demo "belum diisi")
    const cls = clsRows.find((c) => c.id === ses.classId);
    if (!cls) continue;
    const mats = matBySubject[classSubj[cls.name]] || (cls.level === 'TK'
      ? ['Mengenal huruf vokal dan konsonan', 'Menulis huruf dan angka dengan benar', 'Berhitung penjumlahan benda di sekitar']
      : ['Materi umum']);
    const mat = pick(mats);
    await insJournal.run(ses.id, ses.classId, ses.tutorId, ses.date, mat,
      `Peserta didik memahami konsep ${mat.toLowerCase()} dan mampu menerapkannya pada soal latihan.`,
      'Ceramah interaktif, diskusi kelompok, dan latihan soal berjenjang.',
      rnd() > 0.3 ? 'Sebagian besar siswa mencapai target pemahaman.' : 'Beberapa siswa masih perlu pendalaman pada bagian tertentu.',
      rnd() > 0.6 ? 'Sebagian siswa lambat menyelesaikan soal cerita.' : null,
      'Latihan soal halaman yang ditentukan.', 'Pengayaan materi dan latihan soal HOTS.');
  }

  // ========== PERIODE RAPOR ==========
  const insPeriod = db.prepare('INSERT INTO report_periods (name, start_date, end_date) VALUES (?,?,?)');
  const curMonthStart = `${today.toISOString().slice(0, 7)}-01`;
  const curMonthEnd = ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const prevMonthStart = ymd(prev);
  const prevMonthEnd = ymd(new Date(today.getFullYear(), today.getMonth(), 0));
  const monthNames = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const p1 = Number((await insPeriod.run(`${monthNames[prev.getMonth()]} ${prev.getFullYear()}`, prevMonthStart, prevMonthEnd)).lastInsertRowid);
  const p2 = Number((await insPeriod.run(`${monthNames[today.getMonth()]} ${today.getFullYear()}`, curMonthStart, curMonthEnd)).lastInsertRowid);

  // ========== NILAI (per mata pelajaran program siswa) ==========
  const condBySubject = {
    'Matematika': 'Memahami penjumlahan, pengurangan, dan perkalian dasar; pembagian serta soal cerita belum dikuasai.',
    'Bahasa Indonesia': 'Membaca kata sederhana dengan lancar, menulis huruf dan angka dengan benar.',
    'Bahasa Inggris': 'Mengenal alfabet dan kosakata dasar; belum percaya berbicara dalam bahasa Inggris.',
    'IPA Terpadu': 'Memahami ciri makhluk hidup, lingkungan sekitar, dan peristiwa alam secara dasar.',
    'IPS Terpadu': 'Mengenal lingkungan sekitar dan kegiatan masyarakat secara sederhana.',
    'Pendidikan Agama Islam': 'Menghafal doa harian dasar dan mengenal huruf hijaiyah.',
    'Pendidikan Kewarganegaraan': 'Memahami aturan kelas, sikap disiplin, dan pentingnya kejujuran.',
    'Membaca': 'Mengenal huruf vokal dan konsonan; membaca kata dan kalimat sederhana masih perlu pendampingan.',
    'Menulis': 'Menulis huruf dan angka dengan bentuk yang benar; kerapian tulisan masih perlu dilatih.',
    'Berhitung': 'Memahami penjumlahan dan pengurangan benda di sekitar; pengenalan bilangan sampai 50.',
  };
  const insAssess = db.prepare(
    `INSERT INTO assessments (student_id, subject_id, period_id, period_label, initial_score, task_score, practice_score, final_score, notes, initial_condition, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );
  const progSubjOf = db.prepare(
    `SELECT sub.id, sub.name FROM program_subjects ps JOIN subjects sub ON sub.id = ps.subject_id WHERE ps.program_id = ?`
  );
  for (const [i, st] of studentDefs.entries()) {
    const sid = studentIds[i];
    const progSubjects = await progSubjOf.all(programIds[st.prog] || 0);
    for (const sub of progSubjects) {
      for (const [periodId, label] of [[p1, monthNames[prev.getMonth()] + ' ' + prev.getFullYear()], [p2, monthNames[today.getMonth()] + ' ' + today.getFullYear()]]) {
        if (periodId === p2 && rnd() < 0.5) continue; // periode berjalan, sebagian belum dinilai
        const initial = rnd() < 0.2 ? null : between(65, 88);
        const task = between(70, 95);
        const practice = between(68, 96);
        const final = Math.round((task + practice) / 2);
        let note = null;
        if (final >= 85) note = 'Pemahaman materi sangat baik, pertahankan.';
        else if (final >= 75) note = 'Cukup baik, perlu latihan soal cerita.';
        else note = 'Perlu pendalaman konsep dasar dan bimbingan tambahan.';
        await insAssess.run(sid, sub.id, periodId, label, initial, task, practice, final, note,
          condBySubject[sub.name] || 'Memahami sebagian materi dasar sesuai jenjang saat masuk bimbel.', userIds.direktur);
      }
    }
  }

  // ========== RAPOR (contoh berbagai status) ==========
  const insReport = db.prepare(
    `INSERT INTO student_reports (report_code, student_id, period_id, class_id, tutor_id, status, scheduled_count, hadir_count, izin_count, sakit_count, alpa_count,
      notes_mastered, notes_improve, notes_difficulties, notes_positive, notes_suggestion, notes_parent, conclusion, submitted_at, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const insDetail = db.prepare('INSERT INTO report_details (report_id, indicator, score, note) VALUES (?,?,?,?)');
  const indicators = JSON.parse(await getSettingSafe('indicators'));
  const reportDefs = [
    { si: 0, ci: 1, period: p1, status: 'diterbitkan' },
    { si: 1, ci: 2, period: p1, status: 'diterbitkan' },
    { si: 3, ci: 4, period: p1, status: 'disetujui' },
    { si: 4, ci: 5, period: p1, status: 'menunggu' },
    { si: 7, ci: 8, period: p1, status: 'revisi' },
    { si: 2, ci: 3, period: p2, status: 'draf' },
    { si: 10, ci: 0, period: p1, status: 'diterbitkan' }, // Kayla — Calistung (Membaca, Menulis, Berhitung)
  ];
  for (const rd of reportDefs) {
    const sid = studentIds[rd.si], cid = classIds[rd.ci];
    const cls = clsRows.find((c) => c.id === cid);
    if (!cls || !(await db.prepare(`SELECT 1 FROM class_students WHERE class_id=? AND student_id=?`).get(cid, sid))) continue;
    const recapRows = await db.prepare(
      `SELECT a.status, COUNT(*) n FROM student_attendances a JOIN class_sessions cs ON cs.id=a.session_id
       WHERE a.student_id=? AND cs.session_date BETWEEN ? AND ? GROUP BY a.status`
    ).all(sid, prevMonthStart, prevMonthEnd);
    const scheduled = (await db.prepare(
      `SELECT COUNT(*) n FROM class_sessions cs JOIN class_students csm ON csm.class_id=cs.class_id AND csm.student_id=? AND csm.status='aktif'
       WHERE cs.session_date BETWEEN ? AND ? AND cs.status!='batal'`
    ).get(sid, prevMonthStart, prevMonthEnd)).n;
    const m = Object.fromEntries(recapRows.map((r) => [r.status, r.n]));
    const code = await nextNumber(db, 'RPR', 'student_reports', 'report_code');
    const rid = Number((await insReport.run(
      code, sid, rd.period, cid, cls.tutor_id, rd.status, scheduled, m.hadir || 0, m.izin || 0, m.sakit || 0, m.alpa || 0,
      'Sudah menguasai materi pokok dan operasi hitung dasar dengan baik.',
      'Perlu meningkatkan ketelitian pada soal cerita dan pengerjaan tugas tepat waktu.',
      'Kadang kesulitan memahami instruksi soal panjang.',
      'Aktif bertanya dan membantu teman saat diskusi kelompok.',
      'Latihan rutin 15 soal per minggu dan pendalaman materi yang belum dikuasai.',
      'Terus dukung anak dengan membiasakan belajar terjadwal di rumah.',
      'Anak menunjukkan perkembangan positif selama periode ini dengan rata-rata kehadiran yang baik. Perlu latihan soal cerita secara rutin di rumah.',
      rd.status === 'draf' ? null : ymd(addDays(today, -2)), adminId
    )).lastInsertRowid);
    for (let k = 0; k < indicators.length; k++) {
      const ind = indicators[k];
      const sc = k === 0 ? 4 : k === 1 ? 3 : between(2, 4);
      await insDetail.run(rid, ind, sc, sc >= 3 ? 'Sesuai harapan.' : 'Perlu pendampingan lebih lanjut.');
    }
    if (['disetujui', 'diterbitkan'].includes(rd.status)) {
      const fileName = `rapor-${code}-SIS-${String(rd.si + 1).padStart(4, '0')}.pdf`;
      const reportKey = `reports/${fileName}`;
      const { buildReportPDF } = require('./pdf');
      const studentRow = await db.prepare('SELECT * FROM students WHERE id=?').get(sid);
      const periodRow = await db.prepare('SELECT * FROM report_periods WHERE id=?').get(rd.period);
      const tutorRow = await db.prepare('SELECT full_name FROM tutors WHERE id=?').get(cls.tutor_id);
      const gradesRows = await db.prepare(`SELECT sub.name AS subject, initial_score AS initial, task_score AS task, practice_score AS practice, final_score AS final, initial_condition AS initialCondition, notes FROM assessments a JOIN subjects sub ON sub.id=a.subject_id WHERE a.student_id=? AND a.period_id=?`).all(sid, rd.period);
      await buildReportPDF({
        reportCode: code, status: rd.status,
        student: { fullName: studentRow.full_name, nis: studentRow.nis, educationLevel: studentRow.education_level, schoolGrade: studentRow.school_grade, schoolName: studentRow.school_name, program: studentRow.program || null },
        period: periodRow, className: cls.name, tutorName: tutorRow.full_name,
        attendance: { scheduled, hadir: m.hadir || 0, izin: m.izin || 0, sakit: m.sakit || 0, alpa: m.alpa || 0, percentage: scheduled ? Math.round(((m.hadir || 0) / scheduled) * 1000) / 10 : 0 },
        grades: gradesRows,
        indicators: indicators.map((ind, k) => ({ indicator: ind, score: k === 0 ? 4 : 3, note: null })),
        scaleLabels: JSON.parse(await getSettingSafe('scale_labels')),
        notes: {
          mastered: 'Sudah menguasai materi pokok dan operasi hitung dasar dengan baik.',
          improve: 'Perlu meningkatkan ketelitian pada soal cerita dan pengerjaan tugas tepat waktu.',
          difficulties: 'Kadang kesulitan memahami instruksi soal panjang.',
          positive: 'Aktif bertanya dan membantu teman saat diskusi kelompok.',
          suggestion: 'Latihan rutin 15 soal per minggu dan pendalaman materi yang belum dikuasai.',
          parent: 'Terus dukung anak dengan membiasakan belajar terjadwal di rumah.',
        },
        conclusion: 'Anak menunjukkan perkembangan positif selama periode ini dengan rata-rata kehadiran yang baik. Perlu latihan soal cerita secara rutin di rumah.',
        publishedAt: rd.status === 'diterbitkan' ? ymd(addDays(today, -1)) : null,
      }, reportKey);
      if (rd.status === 'diterbitkan') {
        await db.prepare(`UPDATE student_reports SET pdf_path=?, published_at=? WHERE id=?`).run(reportKey, ymd(addDays(today, -1)), rid);
        const ym = ymd(addDays(today, -1)).slice(0, 7);
        const arcName = `rapor-${code}-SIS-${String(rd.si + 1).padStart(4, '0')}.pdf`;
        const arcKey = `archive/${ym}/${arcName}`;
        const pdfBuf = await storage.get(reportKey);
        await storage.put(arcKey, pdfBuf, 'application/pdf');
        const docCode = await nextNumber(db, 'ARS', 'archives', 'doc_code');
        await db.prepare(
          `INSERT INTO archives (doc_code, doc_name, category, description, doc_date, year, file_name, file_path, file_type, file_size, student_id, uploaded_by, is_demo)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)`
        ).run(docCode, `Rapor ${periodRow.name} - ${studentRow.full_name}`, 'Arsip rapor',
          'Salinan PDF rapor terbit', ymd(addDays(today, -1)), today.getFullYear(), arcName, arcKey,
          'application/pdf', pdfBuf.length, sid, adminId);
      }
    }
  }

  // ========== TAGIHAN & PEMBAYARAN ==========
  const insInv = db.prepare(
    `INSERT INTO invoices (invoice_number, student_id, program, period, invoice_date, due_date, amount, discount, total, paid, status, is_demo, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)`
  );
  const insItem = db.prepare('INSERT INTO invoice_items (invoice_id, description, qty, price, subtotal) VALUES (?,?,?,?,?)');
  const insPay = db.prepare(
    `INSERT INTO payments (transaction_number, invoice_id, student_id, amount, method, paid_at, note, status, is_demo, recorded_by)
     VALUES (?,?,?,?,?,?,?,'posted',1,?)`
  );
  const insAlloc = db.prepare('INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES (?,?,?)');
  const methods = ['Tunai', 'Transfer bank', 'QRIS'];
  for (let back = 3; back >= 1; back--) {
    const d = new Date(today.getFullYear(), today.getMonth() - back, 5);
    const periodLabel = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
    const invDate = ymd(d);
    const dueDate = ymd(new Date(d.getFullYear(), d.getMonth(), 15));
    for (let si = 0; si < studentIds.length; si++) {
      const st = studentDefs[si];
      const fee = progByName[st.prog] ? progByName[st.prog].price : 400000;
      const invNo = await nextNumber(db, 'INV', 'invoices', 'invoice_number');
      const total = fee;
      const roll = rnd();
      let paid = 0, status = 'belum';
      if (roll > 0.25) { paid = total; status = 'lunas'; }
      else if (roll > 0.12) { paid = Math.round(total / 2 / 5000) * 5000; status = 'sebagian'; }
      else if (back < 3) { status = 'jatuh_tempo'; }
      const info = await insInv.run(invNo, studentIds[si], st.prog, periodLabel, invDate, dueDate, fee, 0, total, paid, status, userIds.sekretaris);
      const invId = Number(info.lastInsertRowid);
      await insItem.run(invId, `Biaya bimbel ${st.prog} periode ${periodLabel}`, 1, fee, fee);
      if (paid > 0) {
        const payDate = ymd(new Date(d.getFullYear(), d.getMonth(), between(5, 14)));
        const payNo = await nextNumber(db, 'BYR', 'payments', 'transaction_number');
        const pi = await insPay.run(payNo, invId, studentIds[si], paid, pick(methods), payDate, null, userIds.sekretaris);
        await insAlloc.run(Number(pi.lastInsertRowid), invId, paid);
      }
    }
  }

  // ========== ARSIP DOKUMEN DEMO ==========
  const insArch = db.prepare(
    `INSERT INTO archives (doc_code, doc_name, doc_number, category, description, doc_date, year, file_name, file_path, file_type, file_size, student_id, tutor_id, uploaded_by, is_demo)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`
  );
  const docDefs = [
    { name: 'Surat Edaran Kurikulum Semester Berjalan', cat: 'Surat masuk', num: 'SE/2026/101', st: null, tu: null, desc: 'Surat edaran kurikulum dari yayasan.' },
    { name: 'SK Pengangkatan Tentor Dewi Lestari', cat: 'Arsip tentor', num: 'SK/2024/017', st: null, tu: tutorA, desc: 'Surat keputusan pengangkatan tentor.' },
    { name: 'Bukti Pembayaran Operasional Listrik', cat: 'Arsip keuangan', num: null, st: null, tu: null, desc: 'Bukti pembayaran tagihan listrik bulan berjalan.' },
    { name: 'Formulir Pendaftaran Siswa Baru', cat: 'Arsip siswa', num: null, st: studentIds[0], tu: null, desc: 'Formulir pendaftaran yang telah diisi lengkap.' },
    { name: 'Rekap Absensi Kelas Mingguan', cat: 'Arsip absensi', num: null, st: null, tu: null, desc: 'Rekap absensi seluruh kelas minggu berjalan.' },
  ];
  for (const d of docDefs) {
    const ym = todayISO().slice(0, 7);
    const fname = storage.randomKey('.pdf');
    const key = `archive/${ym}/${fname}`;
    const buf = await dummyPdfBuffer(d.name, [d.desc, `Nomor: ${d.num || '-'}`, `Tanggal: ${todayISO()}`]);
    await storage.put(key, buf, 'application/pdf');
    const code = await nextNumber(db, 'ARS', 'archives', 'doc_code');
    await insArch.run(code, d.name, d.num, d.cat, d.desc, todayISO(), today.getFullYear(), fname,
      key, 'application/pdf', buf.length, d.st, d.tu, adminId);
  }

  // ========== SETTINGS ==========
  await setSetting('nama_lembaga', 'Bimbel Rumah Pintar');
  await setSetting('alamat_lembaga', 'Jl. Pendidikan No. 1, Jakarta');
  await setSetting('telepon_lembaga', '021-555-0123');
  await setSetting('metode_pembayaran', JSON.stringify(['Tunai', 'Transfer bank', 'QRIS', 'Lainnya']));
  await setSetting('indicators', JSON.stringify(['Disiplin', 'Tanggung Jawab', 'Motivasi Belajar', 'Kemandirian', 'Kerjasama']));
  await setSetting('scale_labels', JSON.stringify(['Perlu bimbingan', 'Cukup baik', 'Baik', 'Sangat baik']));
  await setSetting('kop_badan', 'BADAN USAHA MILIK DESA');
  await setSetting('kop_unit', '"ABADI SEJAHTERA KLUMPIT"');
  await setSetting('kop_lembaga', 'BIMBINGAN BELAJAR RUMAH PINTAR');
  await setSetting('kop_email', 'bumdesa_abadisejahteraklumpit@gmail.com');
  await setSetting('kop_nomor', 'AHU-00166.AH.01.33.TAHUN 2024');
  await setSetting('kop_alamat', 'Jl. Santren – Grobog RT 01 RW 02 Ds. Klumpit  +6285 800 555 885 - +6289 618 729 772 - +6287 710 270 730');
  await setSetting('ttd_mengetahui', 'BUM Desa Abadi Sejahtera Klumpit');
  await setSetting('ttd_pj', 'NOR AFNAN, S.Pd.');

  console.log('\n==============================================');
  console.log  ('  SEED SELESAI — DATA SIMULASI (DEMO)');
  console.log('==============================================');
  console.log('  Akun login (SIMULASI — ganti setelah produksi):');
  console.log('  direktur  / Direktur#2026   (Direktur)');
  console.log('  sekretaris/ Sekretaris#2026 (Sekretaris)');
  console.log('  tentor1   / Tentor#2026     (Tentor: Dewi Lestari)');
  console.log('  tentor2   / Tentor#2026     (Tentor: Rizky Pratama)');
  console.log('==============================================\n');
}

main().catch((e) => {
  console.error('Seed gagal:', e);
  process.exit(1);
});
