'use strict';
// Lapisan penyimpanan berkas (arsip).
// Dua backend:
//   - Produksi (Cloudflare Workers / server tanpa filesystem permanen) -> Backblaze B2
//     (S3-compatible API, ditandatangani SigV4 via Web Crypto — tanpa AWS SDK agar bundle muat).
//   - Lokal (dev) -> filesystem server/uploads.
// API: put(key, buffer, contentType) / get(key) / exists(key) / remove(key)

const path = require('path');
const fs = require('fs');

const __dirname_ = typeof __dirname !== 'undefined' ? __dirname : '.';
const UPLOADS_DIR = path.join(__dirname_, '..', 'uploads');

const useB2 = !!(process.env.B2_KEY_ID && process.env.B2_KEY && process.env.B2_BUCKET);

// ---------- SigV4 untuk endpoint S3-compatible Backblaze B2 ----------
const te = new TextEncoder();

function toHex(u8) {
  let s = '';
  for (const b of u8) s += b.toString(16).padStart(2, '0');
  return s;
}

async function hmacSha256(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const bytes = typeof data === 'string' ? te.encode(data) : data;
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
}

async function sha256Hex(data) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

// RFC3986 (AWS): encode semua kecuali unreserved A-Za-z0-9-._~
function awsEncode(str) {
  return encodeURIComponent(str).replace(
    /[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

async function b2Fetch(method, key, { body = null, contentType = null } = {}) {
  const region = process.env.B2_REGION || 'us-east-005';
  const bucket = process.env.B2_BUCKET;
  const host = `s3.${region}.backblazeb2.com`;
  const canonicalUri = `/${awsEncode(bucket)}/${String(key).split('/').map(awsEncode).join('/')}`;

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const payload = body
    ? (body instanceof Uint8Array ? body : new Uint8Array(body))
    : new Uint8Array(0);
  const payloadHash = await sha256Hex(payload);

  const signHeaders = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) signHeaders['content-type'] = contentType;

  const sorted = Object.keys(signHeaders).sort();
  const canonicalHeaders = sorted.map((n) => `${n}:${String(signHeaders[n]).trim()}\n`).join('');
  const signedHeaders = sorted.join(';');

  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(te.encode(canonicalRequest)),
  ].join('\n');

  const kDate = await hmacSha256(te.encode('AWS4' + process.env.B2_KEY), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, 's3');
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const headers = { ...signHeaders };
  delete headers.host; // runtime yang mengisi Host (nilainya sama dengan yang ditandatangani)
  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${process.env.B2_KEY_ID}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(`https://${host}${canonicalUri}`, {
    method,
    headers,
    body: body || undefined,
  });
}
// ---------------------------------------------------------------

function localPathFor(key) {
  const safe = key.replace(/[^A-Za-z0-9/._-]/g, '_');
  return path.join(UPLOADS_DIR, safe);
}

// Di Cloudflare Workers filesystem bersifat read-only — unggahan hanya mungkin lewat B2.
function ensureBackend() {
  if (useB2) return;
  if (typeof process !== 'undefined' && process.env && process.env.CF_WORKER) {
    const err = new Error(
      'Penyimpanan B2 belum dikonfigurasi untuk Workers. Set B2_KEY_ID, B2_KEY, dan B2_BUCKET ' +
      '(wrangler secret put) agar unggahan berfungsi.'
    );
    err.status = 503;
    throw err;
  }
}

async function put(key, buffer, contentType = 'application/octet-stream') {
  ensureBackend();
  if (useB2) {
    const res = await b2Fetch('PUT', key, { body: buffer, contentType });
    if (!res.ok) throw new Error(`Gagal unggah "${key}" ke B2: HTTP ${res.status} ${await res.text()}`);
    return key;
  }
  const full = localPathFor(key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  return key;
}

async function exists(key) {
  ensureBackend();
  if (useB2) {
    const res = await b2Fetch('HEAD', key);
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    throw new Error(`Gagal memeriksa "${key}" di B2: HTTP ${res.status}`);
  }
  return fs.existsSync(localPathFor(key));
}

async function get(key) {
  ensureBackend();
  if (useB2) {
    const res = await b2Fetch('GET', key);
    if (!res.ok) throw new Error(`Gagal mengunduh "${key}" dari B2: HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    return typeof Buffer !== 'undefined' ? Buffer.from(ab) : new Uint8Array(ab);
  }
  return fs.readFileSync(localPathFor(key));
}

async function remove(key) {
  ensureBackend();
  if (useB2) {
    const res = await b2Fetch('DELETE', key);
    if (!res.ok && res.status !== 404) throw new Error(`Gagal menghapus "${key}" di B2: HTTP ${res.status}`);
    return;
  }
  const full = localPathFor(key);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

// Util: nama kunci acak aman untuk unggahan.
function randomKey(ext = '') {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return `${Date.now()}-${toHex(b)}${ext}`;
}

module.exports = { put, get, exists, remove, randomKey, useB2, UPLOADS_DIR };
