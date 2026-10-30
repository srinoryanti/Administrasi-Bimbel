'use strict';
const express = require('express');
const { db, audit } = require('../db');
const { requireAuth, requireRole, isTutor, isAdmin } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../middleware/helpers');

const router = express.Router();
router.use(requireAuth);

const STATUS_SISWA = ['hadir', 'izin', 'sakit', 'alpa'];
const STATUS_TENTOR = ['hadir', 'izin', 'sakit', 'tidak_hadir'];

// ===== Absensi siswa per pertemuan =====
router.get('/sessions/:sessionId/students', asyncHandler(async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const session = await db.prepare(
    `SELECT cs.*, c.name AS class_name, t.full_name AS tutor_name FROM class_sessions cs
     JOIN classes c ON c.id = cs.class_id JOIN tutors t ON t.id = cs.tutor_id WHERE cs.id = ?`
  ).get(sessionId);
  if (!session) throw notFound('Pertemuan tidak ditemukan.');
  if (isTutor(req.user) && session.tutor_id !== req.user.tutorId) throw badRequest('Anda hanya dapat mengabsen kelas yang Anda ampu.');
  const students = await db.prepare(
    `SELECT s.id, s.nis, s.full_name, s.school_grade, a.status, a.note, a.updated_at AS attendance_updated_at
     FROM class_students cs JOIN students s ON s.id = cs.student_id AND s.status = 'aktif'
     LEFT JOIN student_attendances a ON a.student_id = s.id AND a.session_id = ?
     WHERE cs.class_id = ? AND cs.status = 'aktif' ORDER BY s.full_name`
  ).all(sessionId, session.class_id);
  res.json({
    session: {
      id: session.id, classId: session.class_id, className: session.class_name, tutorName: session.tutor_name,
      date: session.session_date, startTime: session.start_time, endTime: session.end_time, status: session.status, topic: session.topic,
    },
    data: students,
  });
}));

router.post('/sessions/:sessionId/attendance', requireRole('tentor', 'sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const session = await db.prepare('SELECT * FROM class_sessions WHERE id = ?').get(sessionId);
  if (!session) throw notFound('Pertemuan tidak ditemukan.');
  if (isTutor(req.user) && session.tutor_id !== req.user.tutorId) throw badRequest('Anda hanya dapat mengabsen kelas yang Anda ampu.');
  if (session.status === 'batal') throw badRequest('Pertemuan dibatalkan — absensi tidak dapat diisi. Ubah status pertemuan bila perlu.');
  const { records } = req.body || {};
  if (!Array.isArray(records) || !records.length) throw badRequest('Data absensi kosong.');
  for (const r of records) {
    if (!STATUS_SISWA.includes(r.status)) throw badRequest(`Status absensi tidak valid: ${r.status}`);
    const enrolled = await db.prepare(`SELECT 1 FROM class_students WHERE class_id=? AND student_id=? AND status='aktif'`).get(session.class_id, r.studentId);
    if (!enrolled) throw badRequest('Hanya siswa yang terdaftar di kelas ini yang dapat diabsen.');
  }
  const upsert = db.prepare(
    `INSERT INTO student_attendances (session_id, student_id, class_id, status, note, recorded_by, change_note)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(session_id, student_id) DO UPDATE SET
       status = CASE WHEN student_attendances.status = excluded.status THEN student_attendances.status ELSE excluded.status END,
       note = COALESCE(excluded.note, student_attendances.note),
       change_note = CASE WHEN student_attendances.status = excluded.status THEN student_attendances.change_note
                          ELSE 'Dikoreksi dari ' || student_attendances.status || ' menjadi ' || excluded.status END,
       recorded_by = excluded.recorded_by,
       updated_at = datetime('now','+7 hours')`
  );
  let n = 0;
  for (const r of records) { await upsert.run(sessionId, r.studentId, session.class_id, r.status, r.note || null, req.user.id, null); n++; }
  if (session.status === 'terjadwal') {
    await db.prepare(`UPDATE class_sessions SET status='selesai', updated_at=datetime('now','+7 hours') WHERE id=?`).run(sessionId);
  }
  await audit(req.user.id, req.user.fullName, 'ISI_ABSENSI_SISWA', 'class_sessions', sessionId, { kelas: session.class_id, jumlah: n }, req.ip);
  res.json({ message: `Absensi ${n} siswa tersimpan.` });
}));

// Koreksi absensi dengan catatan perubahan wajib
router.put('/attendance/:id', requireRole('sekretaris', 'direktur', 'tentor'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const a = await db.prepare('SELECT * FROM student_attendances WHERE id = ?').get(id);
  if (!a) throw notFound('Data absensi tidak ditemukan.');
  const session = await db.prepare('SELECT * FROM class_sessions WHERE id = ?').get(a.session_id);
  if (isTutor(req.user) && session.tutor_id !== req.user.tutorId) throw badRequest('Bukan kelas tanggung jawab Anda.');
  const { status, note, changeNote } = req.body || {};
  if (status && !STATUS_SISWA.includes(status)) throw badRequest('Status tidak valid.');
  if (status && status !== a.status && !changeNote) throw badRequest('Koreksi status absensi wajib disertai catatan perubahan.');
  await db.prepare(`UPDATE student_attendances SET status=COALESCE(?,status), note=COALESCE(?,note), change_note=COALESCE(?,change_note),
    recorded_by=?, updated_at=datetime('now','+7 hours') WHERE id=?`)
    .run(status || null, note ?? null, changeNote || null, req.user.id, id);
  await audit(req.user.id, req.user.fullName, 'KOREKSI_ABSENSI', 'student_attendances', id, { dari: a.status, ke: status || a.status, catatan: changeNote }, req.ip);
  res.json({ message: 'Absensi dikoreksi dan perubahan tercatat.' });
}));

// Rekap absensi siswa dengan filter
router.get('/recap', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const { from = '', to = '', classId = '', studentId = '', tutorId = '', status = '', search = '' } = req.query;
  const params = [];
  const where = [];
  if (from) { where.push('cs.session_date >= ?'); params.push(from); }
  if (to) { where.push('cs.session_date <= ?'); params.push(to); }
  if (classId) { where.push('cs.class_id = ?'); params.push(Number(classId)); }
  if (studentId) { where.push('a.student_id = ?'); params.push(Number(studentId)); }
  if (tutorId) { where.push('cs.tutor_id = ?'); params.push(Number(tutorId)); }
  if (status) { where.push('a.status = ?'); params.push(status); }
  if (search) { where.push('(s.full_name LIKE ? OR s.nis LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  const rows = await db.prepare(
    `SELECT a.*, s.full_name AS student_name, s.nis, c.name AS class_name, t.full_name AS tutor_name,
            cs.session_date, cs.start_time, cs.end_time
     FROM student_attendances a
     JOIN students s ON s.id = a.student_id
     JOIN class_sessions cs ON cs.id = a.session_id
     JOIN classes c ON c.id = a.class_id
     JOIN tutors t ON t.id = cs.tutor_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY cs.session_date DESC, s.full_name LIMIT 2000`
  ).all(...params);
  res.json({ data: rows });
}));

// Ringkasan persentase kehadiran per siswa
router.get('/summary', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const { from = '', to = '', classId = '' } = req.query;
  const params = [];
  const where = [];
  if (from) { where.push('cs.session_date >= ?'); params.push(from); }
  if (to) { where.push('cs.session_date <= ?'); params.push(to); }
  if (classId) { where.push('a.class_id = ?'); params.push(Number(classId)); }
  const rows = await db.prepare(
    `SELECT s.id, s.nis, s.full_name,
       SUM(CASE WHEN a.status='hadir' THEN 1 ELSE 0 END) AS hadir,
       SUM(CASE WHEN a.status='izin' THEN 1 ELSE 0 END) AS izin,
       SUM(CASE WHEN a.status='sakit' THEN 1 ELSE 0 END) AS sakit,
       SUM(CASE WHEN a.status='alpa' THEN 1 ELSE 0 END) AS alpa,
       COUNT(*) AS total
     FROM student_attendances a JOIN students s ON s.id = a.student_id
     JOIN class_sessions cs ON cs.id = a.session_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     GROUP BY s.id ORDER BY s.full_name`
  ).all(...params);
  res.json({
    data: rows.map((r) => ({
      ...r,
      percentage: r.total ? Math.round((r.hadir / r.total) * 1000) / 10 : 0,
    })),
  });
}));

// ===== Absensi tentor =====
router.get('/tutor', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const { from = '', to = '', tutorId = '', status = '' } = req.query;
  const params = [];
  const where = [];
  if (from) { where.push('ta.att_date >= ?'); params.push(from); }
  if (to) { where.push('ta.att_date <= ?'); params.push(to); }
  if (tutorId) { where.push('ta.tutor_id = ?'); params.push(Number(tutorId)); }
  if (status) { where.push('ta.status = ?'); params.push(status); }
  const rows = await db.prepare(
    `SELECT ta.*, t.full_name AS tutor_name, c.name AS class_name
     FROM tutor_attendances ta JOIN tutors t ON t.id = ta.tutor_id
     LEFT JOIN class_sessions cs ON cs.id = ta.session_id LEFT JOIN classes c ON c.id = cs.class_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ta.att_date DESC, ta.start_time LIMIT 1000`
  ).all(...params);
  res.json({ data: rows });
}));

router.post('/tutor', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const { tutorId, sessionId, attDate, startTime, endTime, status, learningStatus, note } = req.body || {};
  if (!tutorId || !attDate || !status) throw badRequest('Tentor, tanggal, dan status wajib diisi.');
  if (!STATUS_TENTOR.includes(status)) throw badRequest('Status kehadiran tentor tidak valid.');
  if (learningStatus && !['dilaksanakan', 'sebagian', 'dibatalkan', 'dijadwalkan_ulang'].includes(learningStatus)) {
    throw badRequest('Status pelaksanaan pembelajaran tidak valid.');
  }
  // Kelas dibatalkan/diundur tidak dihitung alpa — validasi aturan bisnis.
  if (learningStatus === 'dibatalkan' && status === 'tidak_hadir') {
    throw badRequest('Kelas dibatalkan tidak boleh ditandai tentor tidak hadir. Gunakan status izin/sakit atau catatan pembatalan.');
  }
  const existing = await db.prepare(`SELECT id FROM tutor_attendances WHERE tutor_id=? AND att_date=? AND start_time IS ?`).get(tutorId, attDate, startTime || null);
  if (existing) throw badRequest('Absensi tentor untuk tanggal dan jam tersebut sudah tercatat.');
  const info = await db.prepare(
    `INSERT INTO tutor_attendances (tutor_id, session_id, att_date, start_time, end_time, status, learning_status, note, recorded_by)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(tutorId, sessionId || null, attDate, startTime || null, endTime || null, status, learningStatus || null, note || null, req.user.id);
  await audit(req.user.id, req.user.fullName, 'ABSENSI_TENTOR', 'tutor_attendances', Number(info.lastInsertRowid), { tutorId, status }, req.ip);
  res.status(201).json({ message: 'Absensi tentor tercatat.' });
}));

router.put('/tutor/:id', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const t = await db.prepare('SELECT * FROM tutor_attendances WHERE id = ?').get(id);
  if (!t) throw notFound('Data tidak ditemukan.');
  const { status, learningStatus, note } = req.body || {};
  if (status && !STATUS_TENTOR.includes(status)) throw badRequest('Status tidak valid.');
  await db.prepare(`UPDATE tutor_attendances SET status=COALESCE(?,status), learning_status=COALESCE(?,learning_status), note=COALESCE(?,note),
    updated_at=datetime('now','+7 hours') WHERE id=?`).run(status || null, learningStatus || null, note ?? null, id);
  await audit(req.user.id, req.user.fullName, 'UBAH_ABSENSI_TENTOR', 'tutor_attendances', id, { status }, req.ip);
  res.json({ message: 'Absensi tentor diperbarui.' });
}));

router.delete('/tutor/:id', requireRole('direktur'), asyncHandler(async (req, res) => {
  await db.prepare('DELETE FROM tutor_attendances WHERE id = ?').run(Number(req.params.id));
  await audit(req.user.id, req.user.fullName, 'HAPUS_ABSENSI_TENTOR', 'tutor_attendances', Number(req.params.id), null, req.ip);
  res.json({ message: 'Data absensi tentor dihapus.' });
}));

module.exports = router;
