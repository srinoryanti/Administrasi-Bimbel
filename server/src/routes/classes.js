'use strict';
const express = require('express');
const { db, audit, todayISO, nextNumber } = require('../db');
const { requireAuth, requireRole, isTutor } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../middleware/helpers');

const router = express.Router();
router.use(requireAuth);

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function toMin(t) {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

function addMinutes(t, mins) {
  const total = (toMin(t) + Number(mins)) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function programOf(classId) {
  return (await db.prepare(
    `SELECT p.* FROM classes c JOIN programs p ON p.id = c.program_id WHERE c.id = ?`
  ).get(Number(classId))) || null;
}

// Durasi jam selesai otomatis dari durasi program bila endTime tidak dikirim.
async function autoEndTime(classId, startTime, endTime) {
  if (endTime) return endTime;
  const p = await programOf(classId);
  if (p && startTime) return addMinutes(startTime, p.duration_minutes);
  return endTime;
}

// Deteksi bentrokan jadwal: satu tabrakan pada tentor ATAU kelas di hari & rentang jam yang sama.
async function findConflicts({ classId, tutorId, dayOfWeek, startTime, endTime, excludeId }) {
  const s = toMin(startTime), e = toMin(endTime);
  if (!(s < e)) return ['Jam selesai harus setelah jam mulai.'];
  const rows = await db.prepare(
    `SELECT s.*, c.name AS class_name, t.full_name AS tutor_name FROM schedules s
     JOIN classes c ON c.id = s.class_id JOIN tutors t ON t.id = s.tutor_id
     WHERE s.day_of_week = ? AND s.status = 'aktif'${excludeId ? ' AND s.id != ?' : ''}`
  ).all(...(excludeId ? [dayOfWeek, excludeId] : [dayOfWeek]));
  const conflicts = [];
  for (const r of rows) {
    const rs = toMin(r.start_time), re = toMin(r.end_time);
    if (s < re && e > rs) {
      if (Number(r.tutor_id) === Number(tutorId)) {
        conflicts.push(`Bentrok jadwal tentor ${r.tutor_name}: mengajar "${r.class_name}" pukul ${r.start_time}–${r.end_time} (${HARI[dayOfWeek]}).`);
      }
      if (Number(r.class_id) === Number(classId)) {
        conflicts.push(`Bentrok jadwal kelas "${r.class_name}": sudah terisi pukul ${r.start_time}–${r.end_time} (${HARI[dayOfWeek]}).`);
      }
    }
  }
  return conflicts;
}

router.get('/classes', asyncHandler(async (req, res) => {
  const { search = '', status = '', type = '', level = '', tutorId = '' } = req.query;
  const params = [];
  const where = [];
  if (isTutor(req.user)) { where.push('c.tutor_id = ?'); params.push(req.user.tutorId); }
  if (search) { where.push('(c.name LIKE ? OR c.class_code LIKE ?)'); const s = `%${search}%`; params.push(s, s); }
  if (status) { where.push('c.status = ?'); params.push(status); }
  if (type) { where.push('c.type = ?'); params.push(type); }
  if (level) { where.push('c.level = ?'); params.push(level); }
  if (tutorId) { where.push('c.tutor_id = ?'); params.push(Number(tutorId)); }
  const rows = await db.prepare(
    `SELECT c.*, sub.name AS subject_name, t.full_name AS tutor_name, p.name AS program_name,
       p.duration_minutes AS program_duration, p.sessions_per_month AS program_sessions,
       (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id AND cs.status='aktif') AS student_count,
       (SELECT GROUP_CONCAT(s.day_of_week || ' ' || s.start_time || '-' || s.end_time, ', ') FROM schedules s WHERE s.class_id = c.id AND s.status='aktif') AS schedule_summary
     FROM classes c LEFT JOIN subjects sub ON sub.id = c.subject_id LEFT JOIN tutors t ON t.id = c.tutor_id
     LEFT JOIN programs p ON p.id = c.program_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.name`
  ).all(...params);
  res.json({
    data: rows.map((r) => ({
      id: r.id, classCode: r.class_code, name: r.name, level: r.level, subjectId: r.subject_id, subjectName: r.subject_name,
      programId: r.program_id, programName: r.program_name, programDuration: r.program_duration, programSessions: r.program_sessions,
      type: r.type, tutorId: r.tutor_id, tutorName: r.tutor_name, location: r.location, capacity: r.capacity,
      status: r.status, studentCount: r.student_count, isDemo: !!r.is_demo, scheduleSummary: r.schedule_summary,
    })),
  });
}));

router.get('/classes/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const c = await db.prepare(
    `SELECT c.*, sub.name AS subject_name, t.full_name AS tutor_name, p.name AS program_name,
       p.duration_minutes AS program_duration, p.sessions_per_month AS program_sessions
     FROM classes c LEFT JOIN subjects sub ON sub.id = c.subject_id LEFT JOIN tutors t ON t.id = c.tutor_id
     LEFT JOIN programs p ON p.id = c.program_id WHERE c.id = ?`
  ).get(id);
  if (!c) return res.status(404).json({ error: 'Kelas tidak ditemukan.' });
  const students = await db.prepare(
    `SELECT cs.joined_at, cs.status AS enroll_status, s.id, s.nis, s.full_name, s.school_grade, s.status
     FROM class_students cs JOIN students s ON s.id = cs.student_id WHERE cs.class_id = ? ORDER BY s.full_name`
  ).all(id);
  const schedules = await db.prepare(
    `SELECT s.*, t.full_name AS tutor_name FROM schedules s LEFT JOIN tutors t ON t.id = s.tutor_id
     WHERE s.class_id = ? ORDER BY s.day_of_week, s.start_time`
  ).all(id);
  res.json({
    data: {
      id: c.id, classCode: c.class_code, name: c.name, level: c.level, subjectId: c.subject_id, subjectName: c.subject_name,
      programId: c.program_id, programName: c.program_name, programDuration: c.program_duration, programSessions: c.program_sessions,
      type: c.type, tutorId: c.tutor_id, tutorName: c.tutor_name, location: c.location, capacity: c.capacity,
      status: c.status, isDemo: !!c.is_demo,
      students: students.map((s) => ({ id: s.id, nis: s.nis, fullName: s.full_name, schoolGrade: s.school_grade, status: s.status, joinedAt: s.joined_at, enrollStatus: s.enroll_status })),
      schedules: schedules.map((s) => ({
        id: s.id, dayOfWeek: s.day_of_week, dayName: HARI[s.day_of_week], startTime: s.start_time, endTime: s.end_time,
        location: s.location, status: s.status, tutorId: s.tutor_id, tutorName: s.tutor_name,
      })),
    },
  });
}));

router.post('/classes', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.name) throw badRequest('Nama kelas wajib diisi.');
  if (b.subjectId && b.programId) {
    const total = (await db.prepare('SELECT COUNT(*) AS n FROM program_subjects WHERE program_id = ?').get(b.programId)).n;
    const ok = !total || (await db.prepare('SELECT 1 FROM program_subjects WHERE program_id = ? AND subject_id = ?').get(b.programId, b.subjectId));
    if (!ok) throw badRequest('Mata pelajaran tidak sesuai dengan program kelas yang dipilih.');
  }
  const classCode = await nextNumber(db, 'KLS', 'classes', 'class_code');
  const info = await db.prepare(
    `INSERT INTO classes (class_code, name, level, program_id, subject_id, type, tutor_id, location, capacity, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(classCode, b.name, b.level || null, b.programId || null, b.subjectId || null, b.type || 'kelompok', b.tutorId || null, b.location || null, b.capacity || 20, b.status || 'aktif');
  const id = Number(info.lastInsertRowid);
  if (b.schedule) {
    const { dayOfWeek, startTime, location } = b.schedule;
    const endTime = await autoEndTime(id, startTime, b.schedule.endTime);
    if (!b.tutorId) throw badRequest('Kelas dengan jadwal memerlukan tentor pengampu.');
    if (!endTime) throw badRequest('Jam selesai wajib diisi (atau pilih program agar dihitung otomatis).');
    const conflicts = await findConflicts({ classId: id, tutorId: b.tutorId, dayOfWeek, startTime, endTime });
    if (conflicts.length) throw badRequest(conflicts.join(' '));
    await db.prepare('INSERT INTO schedules (class_id, tutor_id, day_of_week, start_time, end_time, location) VALUES (?,?,?,?,?,?)')
      .run(id, b.tutorId, dayOfWeek, startTime, endTime, location || b.location || null);
  }
  if (Array.isArray(b.studentIds) && b.studentIds.length) {
    for (const sid of b.studentIds) {
      await db.prepare(`INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at) VALUES (?,?,?)`).run(id, sid, todayISO());
      const subj = b.subjectId;
      if (subj) await db.prepare(`INSERT OR IGNORE INTO student_subjects (student_id, subject_id, class_id, tutor_id, joined_at) VALUES (?,?,?,?,?)`).run(sid, subj, id, b.tutorId || null, todayISO());
    }
  }
  await audit(req.user.id, req.user.fullName, 'BUAT_KELAS', 'classes', id, { classCode, nama: b.name }, req.ip);
  res.status(201).json({ message: 'Kelas berhasil dibuat.', id, classCode });
}));

router.put('/classes/:id', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const c = await db.prepare('SELECT * FROM classes WHERE id = ?').get(id);
  if (!c) throw notFound('Kelas tidak ditemukan.');
  const b = req.body || {};
  const newProgramId = b.programId !== undefined ? (b.programId || null) : c.program_id;
  const newSubjectId = b.subjectId !== undefined ? (b.subjectId || null) : c.subject_id;
  if (newSubjectId && newProgramId) {
    const total = (await db.prepare('SELECT COUNT(*) AS n FROM program_subjects WHERE program_id = ?').get(newProgramId)).n;
    const ok = !total || (await db.prepare('SELECT 1 FROM program_subjects WHERE program_id = ? AND subject_id = ?').get(newProgramId, newSubjectId));
    if (!ok) throw badRequest('Mata pelajaran tidak sesuai dengan program kelas yang dipilih.');
  }
  await db.prepare(
    `UPDATE classes SET name=?, level=?, program_id=?, subject_id=?, type=?, tutor_id=?, location=?, capacity=?, status=?, updated_at=datetime('now','+7 hours') WHERE id=?`
  ).run(b.name ?? c.name, b.level ?? c.level, b.programId !== undefined ? (b.programId || null) : c.program_id,
    b.subjectId ?? c.subject_id, b.type ?? c.type,
    b.tutorId !== undefined ? (b.tutorId || null) : c.tutor_id, b.location ?? c.location,
    b.capacity ?? c.capacity, b.status ?? c.status, id);
  await audit(req.user.id, req.user.fullName, 'UBAH_KELAS', 'classes', id, b.name || c.name, req.ip);
  res.json({ message: 'Kelas diperbarui.' });
}));

router.delete('/classes/:id', requireRole('direktur', 'sekretaris'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const c = await db.prepare('SELECT * FROM classes WHERE id = ?').get(id);
  if (!c) throw notFound('Kelas tidak ditemukan.');
  const hasSessions = await db.prepare('SELECT 1 FROM class_sessions WHERE class_id = ? LIMIT 1').get(id);
  if (hasSessions) {
    await db.prepare(`UPDATE classes SET status='nonaktif', updated_at=datetime('now','+7 hours') WHERE id=?`).run(id);
    await audit(req.user.id, req.user.fullName, 'ARSIP_KELAS', 'classes', id, c.name, req.ip);
    return res.json({ message: 'Kelas memiliki riwayat pertemuan sehingga dinonaktifkan, bukan dihapus permanen.' });
  }
  await db.prepare('DELETE FROM classes WHERE id = ?').run(id);
  await audit(req.user.id, req.user.fullName, 'HAPUS_KELAS', 'classes', id, c.name, req.ip);
  res.json({ message: 'Kelas dihapus.' });
}));

// Anggota kelas
router.post('/classes/:id/students', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const c = await db.prepare('SELECT * FROM classes WHERE id = ?').get(id);
  if (!c) throw notFound('Kelas tidak ditemukan.');
  const { studentId } = req.body || {};
  if (!studentId) throw badRequest('Pilih siswa.');
  await db.prepare(`INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at) VALUES (?,?,?)`).run(id, studentId, todayISO());
  await db.prepare(`UPDATE class_students SET status='aktif' WHERE class_id=? AND student_id=?`).run(id, studentId);
  if (c.subject_id) {
    await db.prepare(`INSERT OR IGNORE INTO student_subjects (student_id, subject_id, class_id, tutor_id, joined_at) VALUES (?,?,?,?,?)`)
      .run(studentId, c.subject_id, id, c.tutor_id, todayISO());
  }
  await audit(req.user.id, req.user.fullName, 'TAMBAH_SISWA_KE_KELAS', 'classes', id, { studentId }, req.ip);
  res.json({ message: 'Siswa ditambahkan ke kelas.' });
}));

router.delete('/classes/:classId/students/:studentId', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  await db.prepare(`UPDATE class_students SET status='keluar' WHERE class_id=? AND student_id=?`).run(Number(req.params.classId), Number(req.params.studentId));
  await audit(req.user.id, req.user.fullName, 'KELUARKAN_SISWA_DARI_KELAS', 'classes', Number(req.params.classId), { studentId: req.params.studentId }, req.ip);
  res.json({ message: 'Siswa dikeluarkan dari kelas.' });
}));

// Cek bentrokan jadwal (endpoint eksplisit untuk form)
router.post('/schedules/check', asyncHandler(async (req, res) => {
  const { classId, tutorId, dayOfWeek, startTime, endTime, excludeId } = req.body || {};
  if (!tutorId || dayOfWeek === undefined || !startTime || !endTime) return res.status(400).json({ error: 'Data jadwal tidak lengkap.' });
  const conflicts = await findConflicts({ classId, tutorId: Number(tutorId), dayOfWeek: Number(dayOfWeek), startTime, endTime, excludeId: excludeId || null });
  res.json({ conflicts, ok: conflicts.length === 0 });
}));

router.post('/schedules', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const { classId, tutorId, dayOfWeek, startTime, location } = req.body || {};
  const c = await db.prepare('SELECT * FROM classes WHERE id = ?').get(Number(classId));
  if (!c) throw notFound('Kelas tidak ditemukan.');
  const endTime = await autoEndTime(classId, startTime, req.body.endTime);
  if (!tutorId || dayOfWeek === undefined || !startTime || !endTime) throw badRequest('Lengkapi tentor, hari, dan jam.');
  const conflicts = await findConflicts({ classId: Number(classId), tutorId: Number(tutorId), dayOfWeek: Number(dayOfWeek), startTime, endTime });
  if (conflicts.length) throw badRequest(conflicts.join(' '));
  const info = await db.prepare('INSERT INTO schedules (class_id, tutor_id, day_of_week, start_time, end_time, location) VALUES (?,?,?,?,?,?)')
    .run(Number(classId), Number(tutorId), Number(dayOfWeek), startTime, endTime, location || c.location || null);
  await audit(req.user.id, req.user.fullName, 'BUAT_JADWAL', 'schedules', Number(info.lastInsertRowid), { kelas: c.name, hari: HARI[dayOfWeek] }, req.ip);
  res.status(201).json({ message: `Jadwal berhasil ditambahkan (selesai ${endTime}${req.body.endTime ? '' : ' — otomatis dari durasi program'}).` });
}));

router.put('/schedules/:id', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const s = await db.prepare('SELECT * FROM schedules WHERE id = ?').get(id);
  if (!s) throw notFound('Jadwal tidak ditemukan.');
  const { tutorId, dayOfWeek, startTime, location, status } = req.body || {};
  const endTime = await autoEndTime(s.class_id, startTime || s.start_time, req.body.endTime);
  const conflicts = await findConflicts({
    classId: s.class_id, tutorId: Number(tutorId || s.tutor_id), dayOfWeek: Number(dayOfWeek ?? s.day_of_week),
    startTime: startTime || s.start_time, endTime, excludeId: id,
  });
  if (conflicts.length) throw badRequest(conflicts.join(' '));
  await db.prepare('UPDATE schedules SET tutor_id=?, day_of_week=?, start_time=?, end_time=?, location=?, status=? WHERE id=?')
    .run(Number(tutorId || s.tutor_id), Number(dayOfWeek ?? s.day_of_week), startTime || s.start_time, endTime, location ?? s.location, status || s.status, id);
  await audit(req.user.id, req.user.fullName, 'UBAH_JADWAL', 'schedules', id, null, req.ip);
  res.json({ message: 'Jadwal diperbarui.' });
}));

router.delete('/schedules/:id', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM schedules WHERE id = ?').run(Number(req.params.id));
  await audit(req.user.id, req.user.fullName, 'HAPUS_JADWAL', 'schedules', Number(req.params.id), null, req.ip);
  res.json({ message: 'Jadwal dihapus.' });
}));

// Kalender jadwal
router.get('/schedules', asyncHandler(async (req, res) => {
  const { tutorId = '', classId = '' } = req.query;
  const params = [];
  const where = [];
  if (isTutor(req.user)) { where.push('s.tutor_id = ?'); params.push(req.user.tutorId); }
  if (tutorId) { where.push('s.tutor_id = ?'); params.push(Number(tutorId)); }
  if (classId) { where.push('s.class_id = ?'); params.push(Number(classId)); }
  const rows = await db.prepare(
    `SELECT s.*, c.name AS class_name, c.type, c.level, sub.name AS subject_name, t.full_name AS tutor_name
     FROM schedules s JOIN classes c ON c.id = s.class_id
     LEFT JOIN subjects sub ON sub.id = c.subject_id LEFT JOIN tutors t ON t.id = s.tutor_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.day_of_week, s.start_time`
  ).all(...params);
  res.json({ data: rows.map((r) => ({ ...r, dayName: HARI[r.day_of_week] })) });
}));

// ===== Pertemuan (class_sessions) =====
router.get('/sessions', asyncHandler(async (req, res) => {
  const { from = '', to = '', classId = '', tutorId = '', status = '' } = req.query;
  const params = [];
  const where = [];
  if (isTutor(req.user)) { where.push('cs.tutor_id = ?'); params.push(req.user.tutorId); }
  if (from) { where.push('cs.session_date >= ?'); params.push(from); }
  if (to) { where.push('cs.session_date <= ?'); params.push(to); }
  if (classId) { where.push('cs.class_id = ?'); params.push(Number(classId)); }
  if (tutorId) { where.push('cs.tutor_id = ?'); params.push(Number(tutorId)); }
  if (status) { where.push('cs.status = ?'); params.push(status); }
  const rows = await db.prepare(
    `SELECT cs.*, c.name AS class_name, c.type, t.full_name AS tutor_name, sub.name AS subject_name,
       (SELECT COUNT(*) FROM class_students x WHERE x.class_id = cs.class_id AND x.status='aktif') AS student_count,
       (SELECT COUNT(*) FROM student_attendances a WHERE a.session_id = cs.id) AS attendance_filled,
       (SELECT COUNT(*) FROM teaching_journals j WHERE j.session_id = cs.id) AS journal_count
     FROM class_sessions cs JOIN classes c ON c.id = cs.class_id
     LEFT JOIN subjects sub ON sub.id = c.subject_id JOIN tutors t ON t.id = cs.tutor_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY cs.session_date DESC, cs.start_time ASC LIMIT 800`
  ).all(...params);
  res.json({ data: rows });
}));

// Generate pertemuan dari jadwal pada rentang tanggal.
// Mode bulan: { month: 'YYYY-MM' } → generate dari awal ke akhir bulan, DIBATASI kuota
// pertemuan/bulan tiap program (mis. Reguler A 12×, Reguler B 24×), lalu laporkan capaian.
router.post('/sessions/generate', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const { from, to, month } = req.body || {};
  let start = from, end = to;
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest('Format bulan harus YYYY-MM.');
    const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    start = `${month}-01`;
    end = `${month}-${String(last).padStart(2, '0')}`;
  }
  if (!start || !end) throw badRequest('Rentang tanggal atau bulan wajib diisi.');
  if (start > end) throw badRequest('Tanggal mulai harus sebelum tanggal selesai.');
  const dayDiff = (new Date(end) - new Date(start)) / 86400000;
  if (dayDiff > 92) throw badRequest('Rentang generate maksimal 92 hari (3 bulan).');
  const schedules = await db.prepare(
    `SELECT s.*, c.name AS class_name, p.sessions_per_month AS quota
     FROM schedules s JOIN classes c ON c.id = s.class_id
     LEFT JOIN programs p ON p.id = c.program_id
     WHERE s.status='aktif' AND c.status='aktif'`
  ).all();
  const ins = db.prepare(`INSERT OR IGNORE INTO class_sessions (schedule_id, class_id, tutor_id, session_date, start_time, end_time, created_by) VALUES (?,?,?,?,?,?,?)`);

  // Kuota per kelas (hanya untuk mode bulan): sisa = kuota - yang sudah ada di bulan itu.
  const remaining = new Map();
  if (month) {
    for (const s of schedules) {
      if (remaining.has(Number(s.class_id))) continue;
      const used = (await db.prepare(
        `SELECT COUNT(*) AS n FROM class_sessions WHERE class_id = ? AND session_date >= ? AND session_date <= ? AND status != 'batal'`
      ).get(Number(s.class_id), start, end)).n;
      remaining.set(Number(s.class_id), s.quota ? Math.max(0, Number(s.quota) - used) : Infinity);
    }
  }

  let created = 0;
  const [sy, sm] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
  const d = new Date(Date.UTC(sy, sm - 1, Number(start.slice(8, 10))));
  const endDate = new Date(Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, Number(end.slice(8, 10))));
  while (d <= endDate) {
    const dow = d.getUTCDay();
    const dateStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    for (const s of schedules) {
      if (Number(s.day_of_week) !== dow) continue;
      const cid = Number(s.class_id);
      if (month && (remaining.get(cid) ?? Infinity) <= 0) continue;
      const r = await ins.run(s.id, s.class_id, s.tutor_id, dateStr, s.start_time, s.end_time, req.user.id);
      const n = Number(r.changes);
      if (n && month) remaining.set(cid, (remaining.get(cid) ?? Infinity) - n);
      created += n;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  await audit(req.user.id, req.user.fullName, 'GENERATE_PERTEMUAN', 'class_sessions', null, { start, end, month: month || null, created }, req.ip);
  const quotaNote = month ? ` (kuota program/bulan dipatuhi)` : '';
  res.json({ message: `Berhasil membuat ${created} pertemuan${month ? ` bulan ${month}` : ''}${quotaNote}.`, created });
}));

// Rekap target vs aktual pertemuan bulanan per kelas (kuota program).
router.get('/sessions/quota', asyncHandler(async (req, res) => {
  const month = req.query.month;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Parameter bulan (YYYY-MM) wajib diisi.' });
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const start = `${month}-01`, end = `${month}-${String(last).padStart(2, '0')}`;
  const rows = await db.prepare(
    `SELECT c.id, c.class_code, c.name, c.status, p.name AS program_name, p.sessions_per_month AS target,
       (SELECT COUNT(*) FROM class_sessions cs WHERE cs.class_id = c.id AND cs.session_date >= ? AND cs.session_date <= ? AND cs.status != 'batal') AS actual
     FROM classes c LEFT JOIN programs p ON p.id = c.program_id
     WHERE c.status = 'aktif' AND p.id IS NOT NULL
     ORDER BY c.name`
  ).all(start, end);
  res.json({
    data: rows.map((r) => ({
      classId: r.id, classCode: r.class_code, name: r.name, programName: r.program_name,
      target: Number(r.target), actual: Number(r.actual),
      remaining: Math.max(0, Number(r.target) - Number(r.actual)),
      achieved: Number(r.actual) >= Number(r.target),
    })),
    month, start, end,
  });
}));

router.put('/sessions/:id/status', requireRole('sekretaris', 'direktur', 'tentor'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const s = await db.prepare('SELECT * FROM class_sessions WHERE id = ?').get(id);
  if (!s) throw notFound('Pertemuan tidak ditemukan.');
  if (isTutor(req.user) && s.tutor_id !== req.user.tutorId) throw badRequest('Ini bukan kelas tanggung jawab Anda.');
  const { status, topic } = req.body || {};
  if (!['terjadwal', 'selesai', 'batal', 'diundur'].includes(status)) throw badRequest('Status tidak valid.');
  await db.prepare(`UPDATE class_sessions SET status=?, topic=COALESCE(?, topic), updated_at=datetime('now','+7 hours') WHERE id=?`)
    .run(status, topic || null, id);
  await audit(req.user.id, req.user.fullName, 'UBAH_STATUS_PERTEMUAN', 'class_sessions', id, { status }, req.ip);
  res.json({ message: 'Status pertemuan diperbarui.' });
}));

module.exports = router;
module.exports.HARI = HARI;
