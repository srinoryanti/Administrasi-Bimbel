'use strict';
const express = require('express');
const { db, audit, todayISO, nextNumber } = require('../db');
const { requireAuth, requireRole, isTutor } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../middleware/helpers');

const router = express.Router();
router.use(requireAuth);

function mapTutor(r) {
  if (!r) return null;
  return {
    id: r.id, employeeId: r.employee_id, fullName: r.full_name, idNumber: r.id_number, email: r.email,
    phone: r.phone, address: r.address, education: r.education, expertise: r.expertise, joinDate: r.join_date,
    status: r.status, photoPath: r.photo_path, isDemo: !!r.is_demo,
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const { search = '', status = '' } = req.query;
  const params = [];
  const where = [];
  if (isTutor(req.user)) {
    // Tentor hanya melihat dirinya sendiri di daftar (untuk referensi profil).
    where.push('t.id = ?');
    params.push(req.user.tutorId);
  }
  if (search) { where.push('(t.full_name LIKE ? OR t.employee_id LIKE ? OR t.expertise LIKE ?)'); const s = `%${search}%`; params.push(s, s, s); }
  if (status) { where.push('t.status = ?'); params.push(status); }
  const rows = await db.prepare(`SELECT t.* FROM tutors t ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.full_name`).all(...params);
  res.json({ data: rows.map(mapTutor) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const t = await db.prepare('SELECT * FROM tutors WHERE id = ?').get(id);
  if (!t) return res.status(404).json({ error: 'Tentor tidak ditemukan.' });
  if (isTutor(req.user) && req.user.tutorId !== id) return res.status(403).json({ error: 'Anda hanya dapat melihat profil sendiri.' });
  const classes = await db.prepare(
    `SELECT c.*, sub.name AS subject_name, p.name AS program_name,
       (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id AND cs.status='aktif') AS student_count
     FROM classes c LEFT JOIN subjects sub ON sub.id = c.subject_id
     LEFT JOIN programs p ON p.id = c.program_id WHERE c.tutor_id = ? ORDER BY c.name`
  ).all(id);
  const schedules = await db.prepare(
    `SELECT s.*, c.name AS class_name FROM schedules s JOIN classes c ON c.id = s.class_id
     WHERE s.tutor_id = ? ORDER BY s.day_of_week, s.start_time`
  ).all(id);
  const user = await db.prepare('SELECT id, username, email, full_name, is_active FROM users WHERE tutor_id = ?').get(id);
  res.json({ data: { ...mapTutor(t), classes, schedules, userAccount: user || null } });
}));

router.get('/:id/attendance', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.prepare(
    `SELECT * FROM tutor_attendances WHERE tutor_id = ? ORDER BY att_date DESC LIMIT 300`
  ).all(id);
  res.json({ data: rows });
}));

router.post('/', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.fullName) throw badRequest('Nama lengkap tentor wajib diisi.');
  const employeeId = await nextNumber(db, 'TTR', 'tutors', 'employee_id');
  const info = await db.prepare(
    `INSERT INTO tutors (employee_id, full_name, id_number, email, phone, address, education, expertise, join_date, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    employeeId, b.fullName, b.idNumber || null, b.email || null, b.phone || null, b.address || null,
    b.education || null, b.expertise || null, b.joinDate || todayISO(), b.status || 'aktif'
  );
  await audit(req.user.id, req.user.fullName, 'TAMBAH_TENTOR', 'tutors', Number(info.lastInsertRowid), { employeeId, nama: b.fullName }, req.ip);
  res.status(201).json({ message: 'Tentor berhasil ditambahkan.', id: Number(info.lastInsertRowid), employeeId });
}));

router.put('/:id', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const t = await db.prepare('SELECT * FROM tutors WHERE id = ?').get(id);
  if (!t) throw notFound('Tentor tidak ditemukan.');
  const b = req.body || {};
  await db.prepare(
    `UPDATE tutors SET full_name=?, id_number=?, email=?, phone=?, address=?, education=?, expertise=?, join_date=?, status=?,
      updated_at=datetime('now','+7 hours') WHERE id=?`
  ).run(
    b.fullName ?? t.full_name, b.idNumber ?? t.id_number, b.email ?? t.email, b.phone ?? t.phone,
    b.address ?? t.address, b.education ?? t.education, b.expertise ?? t.expertise,
    b.joinDate ?? t.join_date, b.status ?? t.status, id
  );
  await audit(req.user.id, req.user.fullName, 'UBAH_TENTOR', 'tutors', id, { nama: b.fullName || t.full_name }, req.ip);
  res.json({ message: 'Data tentor berhasil diperbarui.' });
}));

router.delete('/:id', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const t = await db.prepare('SELECT * FROM tutors WHERE id = ?').get(id);
  if (!t) throw notFound('Tentor tidak ditemukan.');
  const hasHistory =
    (await db.prepare(`SELECT 1 FROM class_sessions WHERE tutor_id = ? LIMIT 1`).get(id)) ||
    (await db.prepare(`SELECT 1 FROM schedules WHERE tutor_id = ? LIMIT 1`).get(id)) ||
    (await db.prepare(`SELECT 1 FROM student_reports WHERE tutor_id = ? LIMIT 1`).get(id));
  if (hasHistory) {
    await db.prepare(`UPDATE tutors SET status='nonaktif', updated_at=datetime('now','+7 hours') WHERE id=?`).run(id);
    await db.prepare(`UPDATE users SET is_active = 0 WHERE tutor_id = ?`).run(id);
    await audit(req.user.id, req.user.fullName, 'ARSIP_TENTOR', 'tutors', id, 'Tentor memiliki riwayat — dinonaktifkan', req.ip);
    return res.json({ message: 'Tentor memiliki jadwal/riwayat mengajar. Status dinonaktifkan beserta akun loginnya, bukan dihapus permanen.' });
  }
  await db.prepare('DELETE FROM tutors WHERE id = ?').run(id);
  await audit(req.user.id, req.user.fullName, 'HAPUS_TENTOR', 'tutors', id, { employeeId: t.employee_id }, req.ip);
  res.json({ message: 'Data tentor berhasil dihapus.' });
}));

module.exports = router;
