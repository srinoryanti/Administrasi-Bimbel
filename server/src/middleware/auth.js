'use strict';
const jwt = require('jsonwebtoken');
const { db } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'rp-dev-secret-ganti-di-produksi-8f3a2b';
const JWT_EXPIRES = '12h';
const COOKIE_NAME = 'rp_token';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role_code, name: user.full_name, tutor_id: user.tutor_id ?? null },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function extractToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

// Express tidak meng-await middleware, jadi bungkus async agar error masuk next().
function requireAuth(req, res, next) {
  requireAuthInner(req, res, next).catch(next);
}

async function requireAuthInner(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Sesi belum login. Silakan login terlebih dahulu.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await db.prepare(
      `SELECT u.id, u.username, u.email, u.full_name, u.tutor_id, u.is_active, u.must_change_password,
              r.code AS role_code, r.name AS role_name
       FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`
    ).get(payload.id);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Akun tidak aktif atau tidak ditemukan. Hubungi pengelola.' });
    }
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name,
      role: user.role_code,
      roleName: user.role_name,
      tutorId: user.tutor_id,
      mustChangePassword: !!user.must_change_password,
    };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sesi login berakhir. Silakan login kembali.' });
  }
}

// Hak akses berbasis peran — diterapkan di setiap endpoint.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Belum login.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Akses ditolak. Peran ${req.user.roleName} tidak memiliki hak untuk tindakan ini.` });
    }
    next();
  };
}

const isAdmin = (u) => u && (u.role === 'direktur' || u.role === 'sekretaris');
const isDirector = (u) => u && u.role === 'direktur';
const isTutor = (u) => u && u.role === 'tentor';

module.exports = { signToken, setAuthCookie, clearAuthCookie, requireAuth, requireRole, isAdmin, isDirector, isTutor, JWT_SECRET, COOKIE_NAME };
