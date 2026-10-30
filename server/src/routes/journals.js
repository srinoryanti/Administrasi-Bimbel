'use strict';
const express = require('express');
const { db, audit, todayISO } = require('../db');
const { requireAuth, requireRole, isTutor } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../middleware/helpers');

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { from = '', to = '', classId = '', tutorId = '', search = '' } = req.query;
  const params = [];
  const where = [];
  if (isTutor(req.user)) { where.push('j.tutor_id = ?'); params.push(req.user.tutorId); }
  if (from) { where.push('j.journal_date >= ?'); params.push(from); }
  if (to) { where.push('j.journal_date <= ?'); params.push(to); }
  if (classId) { where.push('j.class_id = ?'); params.push(Number(classId)); }
  if (tutorId) { where.push('j.tutor_id = ?'); params.push(Number(tutorId)); }
  if (search) { where.push('(j.material LIKE ? OR c.name LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  const rows = await db.prepare(
    `SELECT j.*, c.name AS class_name, c.type, t.full_name AS tutor_name, sub.name AS subject_name,
       (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = j.class_id AND cs.status='aktif') AS student_count
     FROM teaching_journals j JOIN classes c ON c.id = j.class_id
     LEFT JOIN subjects sub ON sub.id = c.subject_id JOIN tutors t ON t.id = j.tutor_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY j.journal_date DESC, j.id DESC LIMIT 500`
  ).all(...params);
  res.json({ data: rows });
}));

router.get('/pending', asyncHandler(async (req, res) => {
  // Sesi yang sudah lewat tanpa jurnal — untuk dashboard tentor.
  const tid = req.user.role === 'tentor' ? req.user.tutorId : Number(req.query.tutorId || 0);
  if (!tid) return res.status(400).json({ error: 'Tentor tidak valid.' });
  const rows = await db.prepare(
    `SELECT cs.*, c.name AS class_name FROM class_sessions cs JOIN classes c ON c.id = cs.class_id
     WHERE cs.tutor_id = ? AND cs.status IN ('terjadwal','selesai') AND cs.session_date <= ?
       AND NOT EXISTS (SELECT 1 FROM teaching_journals j WHERE j.session_id = cs.id)
     ORDER BY cs.session_date DESC LIMIT 100`
  ).all(tid, todayISO());
  res.json({ data: rows });
}));

router.post('/', requireRole('tentor', 'sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.classId || !b.journalDate || !b.material) throw badRequest('Kelas, tanggal, dan materi wajib diisi.');
  const c = await db.prepare('SELECT * FROM classes WHERE id = ?').get(Number(b.classId));
  if (!c) throw notFound('Kelas tidak ditemukan.');
  let tutorId = c.tutor_id;
  if (isTutor(req.user)) {
    if (c.tutor_id !== req.user.tutorId) throw badRequest('Anda hanya dapat membuat jurnal untuk kelas yang Anda ampu.');
    tutorId = req.user.tutorId;
  } else if (b.tutorId) {
    tutorId = Number(b.tutorId);
  }
  if (!tutorId) throw badRequest('Kelas belum memiliki tentor pengampu.');
  const info = await db.prepare(
    `INSERT INTO teaching_journals (session_id, class_id, tutor_id, journal_date, material, objective, activities, outcomes, obstacles, assignments, next_plan, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    b.sessionId || null, c.id, tutorId, b.journalDate, b.material, b.objective || null, b.activities || null,
    b.outcomes || null, b.obstacles || null, b.assignments || null, b.nextPlan || null, b.status || 'terisi'
  );
  await audit(req.user.id, req.user.fullName, 'BUAT_JURNAL', 'teaching_journals', Number(info.lastInsertRowid), { kelas: c.name, materi: b.material }, req.ip);
  res.status(201).json({ message: 'Jurnal mengajar tersimpan.', id: Number(info.lastInsertRowid) });
}));

router.put('/:id', requireRole('tentor', 'sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const j = await db.prepare('SELECT * FROM teaching_journals WHERE id = ?').get(id);
  if (!j) throw notFound('Jurnal tidak ditemukan.');
  const c = await db.prepare('SELECT * FROM classes WHERE id = ?').get(j.class_id);
  if (isTutor(req.user) && c.tutor_id !== req.user.tutorId) throw badRequest('Bukan jurnal kelas Anda.');
  const b = req.body || {};
  await db.prepare(
    `UPDATE teaching_journals SET journal_date=?, material=?, objective=?, activities=?, outcomes=?, obstacles=?, assignments=?, next_plan=?, status=?, updated_at=datetime('now','+7 hours') WHERE id=?`
  ).run(
    b.journalDate ?? j.journal_date, b.material ?? j.material, b.objective ?? j.objective, b.activities ?? j.activities,
    b.outcomes ?? j.outcomes, b.obstacles ?? j.obstacles, b.assignments ?? j.assignments, b.nextPlan ?? j.next_plan,
    b.status ?? j.status, id
  );
  await audit(req.user.id, req.user.fullName, 'UBAH_JURNAL', 'teaching_journals', id, null, req.ip);
  res.json({ message: 'Jurnal diperbarui.' });
}));

router.delete('/:id', requireRole('direktur', 'sekretaris'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  await db.prepare('DELETE FROM teaching_journals WHERE id = ?').run(id);
  await audit(req.user.id, req.user.fullName, 'HAPUS_JURNAL', 'teaching_journals', id, null, req.ip);
  res.json({ message: 'Jurnal dihapus.' });
}));

module.exports = router;
