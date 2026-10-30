'use strict';
// Skrip pembuat akun awal direktur secara aman.
// Pakai: npm run create-admin  (env: ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD)
const path = require('path');
const bcrypt = require('bcryptjs');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  require('dotenv').config();
} catch (_) { /* opsional */ }

const { db, initSchema } = require('./db');

async function main() {
  await initSchema();
  const username = (process.env.ADMIN_USERNAME || 'direktur').toLowerCase();
  const email = process.env.ADMIN_EMAIL || null;
  let password = process.env.ADMIN_PASSWORD;
  const generated = !password;
  if (!password) {
    password = require('crypto').randomBytes(12).toString('base64url');
  }

  const role = await db.prepare(`SELECT * FROM roles WHERE code='direktur'`).get();
  if (!role) {
    await db.exec(`INSERT INTO roles (code, name) VALUES ('direktur','Direktur/Pengelola'),('sekretaris','Sekretaris/Admin'),('tentor','Tentor')`);
  }
  const r = await db.prepare(`SELECT * FROM roles WHERE code='direktur'`).get();
  const existing = await db.prepare('SELECT id FROM users WHERE lower(username)=?').get(username);
  if (existing) {
    console.log(`Akun "${username}" sudah ada di database. Jika lupa password, hapus barisnya di tabel users lalu jalankan ulang, atau gunakan aplikasi (reset manual via DB).`);
    process.exit(0);
  }
  await db.prepare(`INSERT INTO users (role_id, username, email, password_hash, full_name, must_change_password) VALUES (?,?,?,?,?,1)`)
    .run(r.id, username, email, bcrypt.hashSync(password, 10), 'Direktur Pengelola');
  console.log('==============================================');
  console.log('  AKUN DIREKTUR AWAL BERHASIL DIBUAT');
  console.log(`  Username : ${username}`);
  console.log(`  Password : ${password}`);
  if (generated) console.log('  (password dibuat acak — catat sekarang, akan diminta diganti saat login)');
  console.log('==============================================');
}

main().catch((e) => {
  console.error('Gagal membuat akun direktur:', e);
  process.exit(1);
});
