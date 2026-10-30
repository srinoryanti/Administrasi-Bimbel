#!/usr/bin/env node
'use strict';
// Sinkronkan data dari SQLite lokal (server/data/bimbel.db) ke Cloudflare D1.
// Prasyarat: skema sudah ada di D1 (jalankan `npm run seed:d1`).
// Pakai:
//   node scripts/migrate-to-d1.js --dry-run   # hanya tampilkan jumlah baris
//   node scripts/migrate-to-d1.js             # migrasi penuh
//   node scripts/migrate-to-d1.js --force     # tetap jalan walau target terisi data
// Env: D1_ACCOUNT_ID, D1_API_TOKEN, D1_DATABASE_ID (+ DB_PATH bila DB lokal di luar default).
const path = require('path');
const fs = require('fs');

// dotenv diinstal di server/ (root tidak punya node_modules) — resolve langsung ke sana.
try {
  const dotenv = require(path.join(__dirname, '..', 'server', 'node_modules', 'dotenv'));
  dotenv.config({ path: path.join(__dirname, '..', 'server', '.env') });
  dotenv.config();
} catch (_) {
  /* tanpa dotenv: andalkan env dari shell/CI */
}

const { createLocalDb } = require('../server/src/drivers/local');
const { createD1Db } = require('../server/src/drivers/d1');

const accountId = process.env.D1_ACCOUNT_ID;
const apiToken = process.env.D1_API_TOKEN;
const databaseId = process.env.D1_DATABASE_ID;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const chunkSize = Number(process.env.D1_CHUNK_SIZE || 25);

if (!dryRun && (!accountId || !apiToken || !databaseId)) {
  console.error('Env D1_ACCOUNT_ID, D1_API_TOKEN, dan D1_DATABASE_ID wajib diisi (atau pakai --dry-run).');
  process.exit(1);
}

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'server', 'data', 'bimbel.db');
if (!fs.existsSync(DB_PATH)) {
  console.error(`Database lokal tidak ditemukan: ${DB_PATH}`);
  console.error('Jalankan dulu seed lokal: npm run seed  (atau set DB_PATH).');
  process.exit(1);
}

// Urutan insert mengikuti dependensi foreign key (induk sebelum anak).
const TABLE_ORDER = [
  'roles',
  'tutors',
  'programs',
  'subjects',
  'students',
  'users',
  'program_subjects',
  'student_guardians',
  'classes',
  'class_students',
  'student_subjects',
  'schedules',
  'class_sessions',
  'student_attendances',
  'tutor_attendances',
  'teaching_journals',
  'report_periods',
  'assessments',
  'student_reports',
  'report_details',
  'archives',
  'archive_versions',
  'invoices',
  'invoice_items',
  'payments',
  'payment_allocations',
  'audit_logs',
  'settings',
];

// Tabel yang boleh ditempati sebagian (seed-d1 sudah membuat roles; settings default ada).
const CONFLICT_OK = new Set(['roles', 'settings']);

function columnsOf(rows) {
  if (!rows.length) return [];
  return Object.keys(rows[0]);
}

async function main() {
  const local = createLocalDb(DB_PATH);
  const d1 = dryRun ? null : createD1Db({ accountId, apiToken, databaseId });

  const localTables = new Set(
    (await local.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).map((r) => r.name)
  );

  const plan = [];
  for (const table of TABLE_ORDER) {
    if (!localTables.has(table)) {
      console.warn(`  lewati ${table}: tidak ada di DB lokal.`);
      continue;
    }
    const rows = await local.prepare(`SELECT * FROM ${table}`).all();
    plan.push({ table, rows });
  }

  // Tabel di DB lokal yang tidak terdaftar (mis. tabel sistem / tabel baru).
  for (const t of localTables) {
    if (t.startsWith('sqlite_') || TABLE_ORDER.includes(t)) continue;
    console.warn(`  peringatan: tabel "${t}" tidak termasuk daftar migrasi — tambahkan ke TABLE_ORDER bila perlu.`);
  }

  const total = plan.reduce((n, p) => n + p.rows.length, 0);
  console.log(`DB sumber : ${DB_PATH}`);
  console.log(`Total baris: ${total} pada ${plan.length} tabel.`);
  for (const p of plan) console.log(`  - ${p.table.padEnd(22)} ${p.rows.length}`);

  if (dryRun) {
    console.log('\n[dry-run] Tidak ada yang dikirim ke D1.');
    await local.close();
    return;
  }

  if (!force) {
    const probe = await d1.prepare('SELECT COUNT(*) AS n FROM students').get();
    if (probe && Number(probe.n) > 0) {
      console.error(`\nD1 sudah berisi ${probe.n} siswa. Gunakan --force untuk menimpa (INSERT OR IGNORE), atau kosongkan dulu tabelnya.`);
      await local.close();
      process.exit(1);
    }
  }

  await d1.exec(require('../server/src/db').SCHEMA);

  let sent = 0;
  for (const { table, rows } of plan) {
    if (!rows.length) continue;
    const cols = columnsOf(rows);
    const orIgnore = CONFLICT_OK.has(table) ? ' OR IGNORE' : '';
    const sql = `INSERT${orIgnore} INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    const items = rows.map((r) => ({ sql, params: cols.map((c) => normalize(r[c])) }));

    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      await d1.batch(chunk);
      sent += chunk.length;
      process.stdout.write(`\r  ${table}: ${Math.min(i + chunkSize, items.length)}/${items.length}   `);
    }
    process.stdout.write('\n');
  }

  const check = await d1.prepare('SELECT COUNT(*) AS n FROM students').get();
  console.log(`\nSelesai. ${sent} baris terkirim. Verifikasi: D1 students = ${check && check.n}`);
  await local.close();
  await d1.close();
}

function normalize(v) {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
  if (Buffer.isBuffer(v)) return v.toString('base64');
  if (typeof v === 'bigint') return Number(v);
  return v;
}

main().catch((e) => {
  console.error('\nmigrate-to-d1 gagal:', e.message);
  process.exit(1);
});
