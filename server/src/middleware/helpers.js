'use strict';
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function errorHandler(err, req, res, _next) {
  console.error('[ERROR]', req.method, req.path, err.message);
  if (err && err.code && String(err.code).startsWith('SQLITE_CONSTRAINT')) {
    return res.status(400).json({ error: 'Data bentrok atau melanggar aturan relasi database (duplikat / rujukan tidak valid).' });
  }
  const status = err.status || 500;
  res.status(status).json({ error: err.message || 'Terjadi kesalahan pada server.' });
}

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

function notFound(msg) {
  const e = new Error(msg || 'Data tidak ditemukan.');
  e.status = 404;
  return e;
}

module.exports = { asyncHandler, errorHandler, badRequest, notFound };
