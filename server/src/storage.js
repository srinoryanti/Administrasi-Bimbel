'use strict';
// Lapisan penyimpanan berkas (arsip, PDF rapor/kuitansi).
// Dua backend:
//   - Produksi (Render, filesystem hilang tiap deploy) -> Backblaze B2 (S3-compatible).
//   - Lokal (dev)                                      -> filesystem server/uploads.
// API: put(key, buffer, contentType) / get(key) / exists(key) / delete(key) / stream(key)

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

const useB2 = !!(process.env.B2_KEY_ID && process.env.B2_KEY && process.env.B2_BUCKET);

let s3 = null;
let B2_BUCKET = null;

if (useB2) {
  // Lazy-load SDK agar tidak membebani startup lokal bila tidak dipakai.
  const { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  s3 = new S3Client({
    region: process.env.B2_REGION || 'us-west-002',
    endpoint: process.env.B2_ENDPOINT || `https://s3.${process.env.B2_REGION || 'us-west-002'}.backblazeb2.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.B2_KEY_ID,
      secretAccessKey: process.env.B2_KEY,
    },
  });
  B2_BUCKET = process.env.B2_BUCKET;
  module.exports._cmds = { PutObjectCommand, HeadObjectCommand, DeleteObjectCommand };
}

function localPathFor(key) {
  // Cegah path traversal: hanya izinkan karakter aman.
  const safe = key.replace(/[^A-Za-z0-9/._-]/g, '_');
  return path.join(UPLOADS_DIR, safe);
}

async function put(key, buffer, contentType = 'application/octet-stream') {
  if (useB2) {
    const { PutObjectCommand } = module.exports._cmds;
    await s3.send(new PutObjectCommand({
      Bucket: B2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));
    return key;
  }
  const full = localPathFor(key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  return key;
}

async function exists(key) {
  if (useB2) {
    const { HeadObjectCommand } = module.exports._cmds;
    try {
      await s3.send(new HeadObjectCommand({ Bucket: B2_BUCKET, Key: key }));
      return true;
    } catch (e) {
      if (e && (e.$metadata?.httpStatusCode === 404 || e.name === 'NotFound')) return false;
      throw e;
    }
  }
  return fs.existsSync(localPathFor(key));
}

async function get(key) {
  if (useB2) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const res = await s3.send(new GetObjectCommand({ Bucket: B2_BUCKET, Key: key }));
    const chunks = [];
    for await (const chunk of res.Body) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  return fs.readFileSync(localPathFor(key));
}

async function stream(key) {
  // Mengembalikan stream untuk di-pipe ke res.
  if (useB2) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const res = await s3.send(new GetObjectCommand({ Bucket: B2_BUCKET, Key: key }));
    return res.Body;
  }
  return fs.createReadStream(localPathFor(key));
}

async function remove(key) {
  if (useB2) {
    const { DeleteObjectCommand } = module.exports._cmds;
    await s3.send(new DeleteObjectCommand({ Bucket: B2_BUCKET, Key: key }));
    return;
  }
  const full = localPathFor(key);
  if (fs.existsSync(full)) fs.unlinkSync(full);
}

// Util: nama kunci acak aman untuk unggahan.
function randomKey(ext = '') {
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
}

module.exports = { put, get, exists, stream, remove, randomKey, useB2, UPLOADS_DIR };
