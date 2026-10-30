'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, audit } = require('../db');
const { signToken, setAuthCookie, clearAuthCookie, requireAuth } = require('../middleware/auth');
const { asyncHandler, badRequest } = require('../middleware/helpers');

const router = express.Router();

router.post('/login', asyncHandler(async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) throw badRequest('Email/username dan password wajib diisi.');
  const user = await db.prepare(
    `SELECT u.*, r.code AS role_code, r.name AS role_name
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE lower(u.username) = lower(?) OR lower(COALESCE(u.email,'')) = lower(?)`
  ).get(String(identifier).trim(), String(identifier).trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    await audit(null, identifier, 'LOGIN_GAGAL', 'users', null, 'Percobaan login dengan kredensial salah', req.ip);
    throw badRequest('Username/email atau password salah.');
  }
  if (!user.is_active) {
    await audit(user.id, user.full_name, 'LOGIN_DITOLAK', 'users', user.id, 'Akun nonaktif', req.ip);
    throw badRequest('Akun Anda telah dinonaktifkan. Hubungi pengelola.');
  }
  await db.prepare(`UPDATE users SET last_login_at = datetime('now','+7 hours') WHERE id = ?`).run(user.id);
  const token = signToken({ id: user.id, username: user.username, role: user.role_code, full_name: user.full_name, tutor_id: user.tutor_id });
  setAuthCookie(res, token);
  await audit(user.id, user.full_name, 'LOGIN', 'users', user.id, null, req.ip);
  res.json({
    message: 'Login berhasil.',
    user: {
      id: user.id, username: user.username, email: user.email, fullName: user.full_name,
      role: user.role_code, roleName: user.role_name, tutorId: user.tutor_id,
      mustChangePassword: !!user.must_change_password,
    },
  });
}));

router.post('/logout', requireAuth, asyncHandler(async (req, res) => {
  await audit(req.user.id, req.user.fullName, 'LOGOUT', 'users', req.user.id, null, req.ip);
  clearAuthCookie(res);
  res.json({ message: 'Berhasil logout.' });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) throw badRequest('Password lama dan password baru wajib diisi.');
  if (String(newPassword).length < 6) throw badRequest('Password baru minimal 6 karakter.');
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(oldPassword, user.password_hash)) throw badRequest('Password lama tidak sesuai.');
  const hash = bcrypt.hashSync(newPassword, 10);
  await db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now','+7 hours') WHERE id = ?`)
    .run(hash, req.user.id);
  await audit(req.user.id, req.user.fullName, 'GANTI_PASSWORD', 'users', req.user.id, null, req.ip);
  res.json({ message: 'Password berhasil diperbarui.' });
}));

module.exports = router;
