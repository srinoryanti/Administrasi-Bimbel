#!/usr/bin/env node
'use strict';
// Terapkan skema (termasuk migrasi kolom) + data default ke Cloudflare D1.
// Butuh env: D1_ACCOUNT_ID, D1_API_TOKEN, D1_DATABASE_ID.
// Pakai: npm run seed:d1   (opsional: --schema-only, --dry-run tidak berlaku di sini)
const path = require('path');
try {
  const dotenv = require(path.join(__dirname, '..', 'server', 'node_modules', 'dotenv'));
  dotenv.config({ path: path.join(__dirname, '..', 'server', '.env') });
  dotenv.config();
} catch (_) {
  /* tanpa dotenv: andalkan env dari shell/CI */
}

const { db, initSchema, setSetting } = require('../server/src/db');

if (db.backend !== 'd1') {
  console.error('Env D1 belum lengkap (D1_ACCOUNT_ID, D1_API_TOKEN, D1_DATABASE_ID).');
  process.exit(1);
}

(async () => {
  console.log('Menerapkan skema + migrasi kolom (idempoten)...');
  await initSchema();

  console.log('Memastikan roles & pengaturan default...');
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM roles').get()).n;
  if (n === 0) {
    await db.batch([
      { sql: "INSERT INTO roles (code, name) VALUES ('direktur','Direktur/Pengelola')", params: [] },
      { sql: "INSERT INTO roles (code, name) VALUES ('sekretaris','Sekretaris/Admin')", params: [] },
      { sql: "INSERT INTO roles (code, name) VALUES ('tentor','Tentor')", params: [] },
    ]);
    console.log('Roles default dibuat.');
  } else {
    console.log(`Roles sudah ada (${n}). Lewati.`);
  }
  if (!(await db.prepare('SELECT 1 FROM settings WHERE key=?').get('nama_lembaga'))) {
    await setSetting('nama_lembaga', 'Bimbel Rumah Pintar');
    console.log('Pengaturan default dibuat.');
  }

  console.log('Skema D1 siap. Untuk data (lokal → D1) jalankan: npm run migrate:d1');
  await db.close();
  process.exit(0);
})().catch((e) => {
  console.error('seed-d1 gagal:', e.message);
  process.exit(1);
});
