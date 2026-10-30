'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, audit } = require('../db');
const { requireAuth, requireRole, isDirector } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../middleware/helpers');

const router = express.Router();
router.use(requireAuth);

// Daftar pengguna — direktur melihat semua; sekretaris melihat daftar terbatas (tanpa ubah).
router.get('/', requireRole('direktur', 'sekretaris'), asyncHandler(async (req, res) => {
  const rows = await db.prepare(
    `SELECT u.id, u.username, u.email, u.full_name, u.is_active, u.must_change_password, u.last_login_at, u.created_at,
            r.code AS role_code, r.name AS role_name, t.full_name AS tutor_name
     FROM users u JOIN roles r ON r.id = u.role_id
     LEFT JOIN tutors t ON t.id = u.tutor_id
     ORDER BY u.id`
  ).all();
  res.json({ data: rows });
}));

router.get('/roles', asyncHandler(async (req, res) => {
  res.json({ data: await db.prepare('SELECT * FROM roles ORDER BY id').all() });
}));

router.post('/', requireRole('direktur'), asyncHandler(async (req, res) => {
  const { username, email, password, fullName, roleCode, tutorId, isActive } = req.body || {};
  if (!username || !password || !fullName || !roleCode) throw badRequest('Username, nama lengkap, password, dan peran wajib diisi.');
  if (String(password).length < 6) throw badRequest('Password minimal 6 karakter.');
  const role = await db.prepare('SELECT * FROM roles WHERE code = ?').get(roleCode);
  if (!role) throw badRequest('Peran tidak dikenal.');
  if (roleCode === 'tentor' && !tutorId) throw badRequest('Akun tentor harus ditautkan ke data tentor.');
  const hash = bcrypt.hashSync(password, 10);
  const info = await db.prepare(
    `INSERT INTO users (role_id, tutor_id, username, email, password_hash, full_name, is_active, must_change_password)
     VALUES (?,?,?,?,?,?,?,1)`
  ).run(role.id, tutorId || null, String(username).trim().toLowerCase(), email || null, hash, fullName, isActive === false ? 0 : 1);
  await audit(req.user.id, req.user.fullName, 'BUAT_AKUN', 'users', Number(info.lastInsertRowid), { username, roleCode }, req.ip);
  res.status(201).json({ message: 'Akun berhasil dibuat.', id: Number(info.lastInsertRowid) });
}));

router.put('/:id', requireRole('direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw notFound('Akun tidak ditemukan.');
  const { email, fullName, roleCode, tutorId, isActive, password } = req.body || {};
  const role = roleCode ? await db.prepare('SELECT * FROM roles WHERE code = ?').get(roleCode) : null;
  if (roleCode && !role) throw badRequest('Peran tidak dikenal.');
  await db.prepare(
    `UPDATE users SET role_id = ?, tutor_id = ?, email = ?, full_name = ?, is_active = ?,
      password_hash = COALESCE(?, password_hash), must_change_password = CASE WHEN ? IS NOT NULL THEN 1 ELSE must_change_password END,
      updated_at = datetime('now','+7 hours')
     WHERE id = ?`
  ).run(
    role ? role.id : user.role_id,
    tutorId !== undefined ? (tutorId || null) : user.tutor_id,
    email !== undefined ? email : user.email,
    fullName || user.full_name,
    isActive === undefined ? user.is_active : (isActive ? 1 : 0),
    password ? bcrypt.hashSync(password, 10) : null,
    password || null,
    id
  );
  await audit(req.user.id, req.user.fullName, 'UBAH_AKUN', 'users', id, { fullName, roleCode, isActive }, req.ip);
  res.json({ message: 'Akun berhasil diperbarui.' });
}));

router.post('/:id/reset-password', requireRole('direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw notFound('Akun tidak ditemukan.');
  const newPassword = req.body && req.body.newPassword ? String(req.body.newPassword) : 'RumahPintar123';
  if (newPassword.length < 6) throw badRequest('Password minimal 6 karakter.');
  await db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = datetime('now','+7 hours') WHERE id = ?`)
    .run(bcrypt.hashSync(newPassword, 10), id);
  await audit(req.user.id, req.user.fullName, 'RESET_PASSWORD', 'users', id, 'Password direset oleh direktur', req.ip);
  res.json({ message: 'Password berhasil direset. Pengguna akan diminta mengganti password saat login berikutnya.' });
}));

router.delete('/:id', requireRole('direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) throw badRequest('Tidak dapat menonaktifkan akun yang sedang digunakan.');
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw notFound('Akun tidak ditemukan.');
  await db.prepare('UPDATE users SET is_active = 0, updated_at = datetime(\'now\',\'+7 hours\') WHERE id = ?').run(id);
  await audit(req.user.id, req.user.fullName, 'NONAKTIFKAN_AKUN', 'users', id, null, req.ip);
  res.json({ message: 'Akun dinonaktifkan.' });
}));

router.get('/audit-logs', requireRole('direktur'), asyncHandler(async (req, res) => {
  const { search = '', limit = 200 } = req.query;
  let sql = `SELECT * FROM audit_logs`;
  const params = [];
  if (search) {
    sql += ` WHERE user_name LIKE ? OR action LIKE ? OR entity LIKE ? OR detail LIKE ?`;
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  sql += ` ORDER BY id DESC LIMIT ?`;
  params.push(Math.min(Number(limit) || 200, 1000));
  res.json({ data: await db.prepare(sql).all(...params) });
}));

module.exports = router;
