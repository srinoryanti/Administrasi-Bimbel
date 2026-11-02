'use strict';
// Middleware multipart/form-data ringan — pengganti multer untuk Cloudflare Workers.
// Hanya mendukung upload single-file (fieldname apa pun) + field teks biasa,
// cukup untuk endpoint /api/archives (upload & replace).
//
// Hasil: req.file = { originalname, mimetype, size, buffer }  (seperti multer.memoryStorage)
//        req.body = { ...fieldTeks }

function parseContentType(str) {
  const m = /^([^;]+)(?:;\s*boundary=(?:"([^"]+)"|([^;]+)))?$/i.exec(String(str || '').trim());
  if (!m) return null;
  return { type: m[1].trim().toLowerCase(), boundary: (m[2] || m[3] || '').trim() };
}

function parseDisposition(str) {
  const out = {};
  const m = /^form-data\s*;?\s*(.*)$/i.exec(String(str || '').trim());
  if (!m) return out;
  const rest = m[1];
  const nameM = /name="([^"]*)"/i.exec(rest);
  const fnM = /filename="([^"]*)"/i.exec(rest);
  if (nameM) out.name = nameM[1];
  if (fnM) out.filename = fnM[1];
  return out;
}

// Cari posisi boundary berikutnya dalam buffer (untuk delimiter awal/tengah/akhir).
function findBoundary(buf, boundary, from) {
  const needle = Buffer.from('--' + boundary);
  return buf.indexOf(needle, from);
}

function multipart({ limit = 10 * 1024 * 1024 } = {}) {
  return (req, res, next) => {
    if (req._multipartParsed) return next();
    const ct = parseContentType(req.headers['content-type']);
    if (!ct || ct.type !== 'multipart/form-data' || !ct.boundary) return next();

    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      next(err);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      try {
        const buf = Buffer.concat(chunks);
        const boundary = ct.boundary;
        let file = null;
        const body = {};

        let pos = findBoundary(buf, boundary, 0);
        while (pos !== -1) {
          // Lewati "--boundary"
          let p = pos + boundary.length + 2;
          // CRLF setelah boundary
          if (buf[p] === 13 && buf[p + 1] === 10) p += 2;
          // Cek terminator "--"
          if (buf[p] === 45 && buf[p + 1] === 45) break;

          // Baca header sampai CRLFCRLF
          const headerEnd = buf.indexOf('\r\n\r\n', p);
          if (headerEnd === -1) break;
          const headerStr = buf.slice(p, headerEnd).toString('utf8');
          let contentStart = headerEnd + 4;

          // Boundary berikutnya
          const nextBoundary = findBoundary(buf, boundary, contentStart);
          if (nextBoundary === -1) break;
          // Konten berakhir sebelum CRLF sebelum boundary
          let contentEnd = nextBoundary;
          if (buf[contentEnd - 2] === 13 && buf[contentEnd - 1] === 10) contentEnd -= 2;

          const content = buf.slice(contentStart, contentEnd);

          // Parse header Content-Disposition / Content-Type
          let fieldName = null;
          let filename = null;
          let mime = 'application/octet-stream';
          for (const line of headerStr.split('\r\n')) {
            const [rawKey, ...rawVal] = line.split(':');
            const key = rawKey.trim().toLowerCase();
            const val = rawVal.join(':').trim();
            if (key === 'content-disposition') {
              const d = parseDisposition(val);
              fieldName = d.name || null;
              filename = d.filename || null;
            } else if (key === 'content-type') {
              mime = val || mime;
            }
          }

          if (filename !== null) {
            // File part — ambil yang pertama saja (single-file upload)
            if (!file) {
              file = { originalname: filename, mimetype: mime, size: content.length, buffer: content };
            }
          } else if (fieldName) {
            body[fieldName] = content.toString('utf8');
          }

          pos = nextBoundary;
        }

        req._multipartParsed = true;
        if (file) req.file = file;
        if (Object.keys(body).length) req.body = { ...(req.body || {}), ...body };
        next();
      } catch (e) {
        next(e);
      }
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error('Berkas terlalu besar (maksimal ' + Math.round(limit / 1024 / 1024) + ' MB).');
        err.status = 413;
        fail(err);
        if (typeof req.pause === 'function') req.pause();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', onEnd);
    req.on('error', fail);
  };
}

module.exports = { multipart };
