'use strict';
const path = require('path');
const { createLocalDb } = require('./drivers/local');
const { createD1Db, createD1BindingDb } = require('./drivers/d1');

// Pilih driver dari env:
// - Cloudflare Workers: binding D1 (globalThis.__CF_D1__, diset entry worker) → binding driver.
// - Produksi (REST)    : set D1_ACCOUNT_ID/D1_API_TOKEN/D1_DATABASE_ID → driver D1 (REST).
// - Lokal (dev)        : tanpa env D1 → node:sqlite file (server/data/bimbel.db).
const d1Binding = globalThis.__CF_D1__ || null;
const useD1 = !!(process.env.D1_ACCOUNT_ID && process.env.D1_API_TOKEN && process.env.D1_DATABASE_ID);

let DB_PATH;
if (d1Binding) {
  DB_PATH = null; // Workers: lewat binding D1, file SQLite tidak dipakai.
} else {
  const DATA_DIR = path.join(typeof __dirname !== 'undefined' ? __dirname : '.', '..', 'data');
  DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'bimbel.db');
}

const db = d1Binding
  ? createD1BindingDb(d1Binding)
  : useD1
    ? createD1Db({
        accountId: process.env.D1_ACCOUNT_ID,
        apiToken: process.env.D1_API_TOKEN,
        databaseId: process.env.D1_DATABASE_ID,
      })
    : createLocalDb(DB_PATH);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  tutor_id INTEGER REFERENCES tutors(id) ON DELETE SET NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role_id);

CREATE TABLE IF NOT EXISTS tutors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  id_number TEXT,
  email TEXT UNIQUE,
  phone TEXT,
  address TEXT,
  education TEXT,
  expertise TEXT,
  join_date TEXT,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','nonaktif')),
  photo_path TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours'))
);

CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  target_level TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  sessions_per_month INTEGER NOT NULL DEFAULT 12,
  price REAL NOT NULL DEFAULT 0,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','nonaktif')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours'))
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nis TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  birth_place TEXT,
  birth_date TEXT,
  gender TEXT CHECK (gender IN ('L','P')),
  education_level TEXT,
  school_grade TEXT,
  school_name TEXT,
  address TEXT,
  program TEXT,
  program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
  start_date TEXT,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','cuti','berhenti')),
  photo_path TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours'))
);
CREATE INDEX IF NOT EXISTS idx_students_name ON students(full_name);
CREATE INDEX IF NOT EXISTS idx_students_status ON students(status);

CREATE TABLE IF NOT EXISTS student_guardians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  guardian_name TEXT NOT NULL,
  relation TEXT,
  phone TEXT,
  occupation TEXT
);
CREATE INDEX IF NOT EXISTS idx_guardians_student ON student_guardians(student_id);

CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS program_subjects (
  program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (program_id, subject_id)
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  level TEXT,
  program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  type TEXT NOT NULL DEFAULT 'kelompok' CHECK (type IN ('privat','kelompok')),
  tutor_id INTEGER REFERENCES tutors(id) ON DELETE SET NULL,
  location TEXT,
  capacity INTEGER DEFAULT 20,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','selesai','nonaktif')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours'))
);

CREATE TABLE IF NOT EXISTS class_students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  joined_at TEXT,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','keluar')),
  UNIQUE (class_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_cs_class ON class_students(class_id);
CREATE INDEX IF NOT EXISTS idx_cs_student ON class_students(student_id);

CREATE TABLE IF NOT EXISTS student_subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  tutor_id INTEGER REFERENCES tutors(id) ON DELETE SET NULL,
  joined_at TEXT,
  UNIQUE (student_id, subject_id)
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  tutor_id INTEGER NOT NULL REFERENCES tutors(id) ON DELETE RESTRICT,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  location TEXT,
  valid_from TEXT,
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','nonaktif')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours'))
);
CREATE INDEX IF NOT EXISTS idx_sched_class ON schedules(class_id);
CREATE INDEX IF NOT EXISTS idx_sched_tutor ON schedules(tutor_id);

CREATE TABLE IF NOT EXISTS class_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  tutor_id INTEGER NOT NULL REFERENCES tutors(id) ON DELETE RESTRICT,
  session_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  topic TEXT,
  status TEXT NOT NULL DEFAULT 'terjadwal' CHECK (status IN ('terjadwal','selesai','batal','diundur')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  UNIQUE (class_id, session_date, start_time)
);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON class_sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_sessions_class ON class_sessions(class_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tutor ON class_sessions(tutor_id);

CREATE TABLE IF NOT EXISTS student_attendances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('hadir','izin','sakit','alpa')),
  note TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  change_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  UNIQUE (session_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_att_student ON student_attendances(student_id);
CREATE INDEX IF NOT EXISTS idx_att_class ON student_attendances(class_id);

CREATE TABLE IF NOT EXISTS tutor_attendances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tutor_id INTEGER NOT NULL REFERENCES tutors(id) ON DELETE CASCADE,
  session_id INTEGER REFERENCES class_sessions(id) ON DELETE SET NULL,
  schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
  att_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  status TEXT NOT NULL CHECK (status IN ('hadir','izin','sakit','tidak_hadir')),
  learning_status TEXT CHECK (learning_status IN ('dilaksanakan','sebagian','dibatalkan','dijadwalkan_ulang')),
  note TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  UNIQUE (tutor_id, att_date, start_time)
);
CREATE INDEX IF NOT EXISTS idx_tatt_tutor ON tutor_attendances(tutor_id);

CREATE TABLE IF NOT EXISTS teaching_journals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES class_sessions(id) ON DELETE SET NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  tutor_id INTEGER NOT NULL REFERENCES tutors(id) ON DELETE RESTRICT,
  journal_date TEXT NOT NULL,
  material TEXT NOT NULL,
  objective TEXT,
  activities TEXT,
  outcomes TEXT,
  obstacles TEXT,
  assignments TEXT,
  next_plan TEXT,
  status TEXT NOT NULL DEFAULT 'terisi' CHECK (status IN ('draf','terisi')),
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours'))
);
CREATE INDEX IF NOT EXISTS idx_journal_tutor ON teaching_journals(tutor_id);
CREATE INDEX IF NOT EXISTS idx_journal_class ON teaching_journals(class_id);

CREATE TABLE IF NOT EXISTS report_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','tutup'))
);

CREATE TABLE IF NOT EXISTS assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  period_id INTEGER REFERENCES report_periods(id) ON DELETE SET NULL,
  period_label TEXT NOT NULL,
  initial_score REAL,
  task_score REAL,
  practice_score REAL,
  final_score REAL,
  notes TEXT,
  initial_condition TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  UNIQUE (student_id, subject_id, period_label)
);
CREATE INDEX IF NOT EXISTS idx_assess_student ON assessments(student_id);

CREATE TABLE IF NOT EXISTS student_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_code TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  period_id INTEGER NOT NULL REFERENCES report_periods(id) ON DELETE RESTRICT,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  tutor_id INTEGER NOT NULL REFERENCES tutors(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'draf' CHECK (status IN ('draf','menunggu','revisi','disetujui','diterbitkan')),
  scheduled_count INTEGER DEFAULT 0,
  hadir_count INTEGER DEFAULT 0,
  izin_count INTEGER DEFAULT 0,
  sakit_count INTEGER DEFAULT 0,
  alpa_count INTEGER DEFAULT 0,
  notes_mastered TEXT,
  notes_improve TEXT,
  notes_difficulties TEXT,
  notes_positive TEXT,
  notes_suggestion TEXT,
  notes_parent TEXT,
  conclusion TEXT,
  check_note TEXT,
  submitted_at TEXT,
  checked_at TEXT,
  approved_at TEXT,
  published_at TEXT,
  pdf_path TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  UNIQUE (student_id, period_id)
);
CREATE INDEX IF NOT EXISTS idx_reports_student ON student_reports(student_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON student_reports(status);

CREATE TABLE IF NOT EXISTS report_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES student_reports(id) ON DELETE CASCADE,
  indicator TEXT NOT NULL,
  score INTEGER CHECK (score BETWEEN 1 AND 4),
  note TEXT,
  UNIQUE (report_id, indicator)
);

CREATE TABLE IF NOT EXISTS archives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_code TEXT NOT NULL UNIQUE,
  doc_name TEXT NOT NULL,
  doc_number TEXT,
  category TEXT NOT NULL,
  description TEXT,
  doc_date TEXT,
  year INTEGER,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','diarsipkan')),
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  tutor_id INTEGER REFERENCES tutors(id) ON DELETE SET NULL,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours'))
);
CREATE INDEX IF NOT EXISTS idx_archives_cat ON archives(category);
CREATE INDEX IF NOT EXISTS idx_archives_name ON archives(doc_name);

CREATE TABLE IF NOT EXISTS archive_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archive_id INTEGER NOT NULL REFERENCES archives(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  note TEXT,
  replaced_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  program TEXT,
  period TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  amount REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  paid REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'belum' CHECK (status IN ('belum','sebagian','lunas','jatuh_tempo','batal')),
  note TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours'))
);
CREATE INDEX IF NOT EXISTS idx_inv_student ON invoices(student_id);
CREATE INDEX IF NOT EXISTS idx_inv_status ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  price REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_number TEXT NOT NULL UNIQUE,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'tunai',
  paid_at TEXT NOT NULL,
  note TEXT,
  proof_path TEXT,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','dibatalkan')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours'))
);
CREATE INDEX IF NOT EXISTS idx_pay_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_pay_student ON payments(student_id);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  UNIQUE (payment_id, invoice_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+7 hours'))
);
`;

// Migrasi ringan: tambah kolom bila belum ada (idempoten, aman dijalankan tiap boot).
// Keduanya (SQLite lokal & D1) mendukung PRAGMA table_info — pakai itu agar migrasi
// berjalan di Render tanpa information_schema (tidak ada di D1).
async function columnExists(table, name) {
  try {
    const cols = await db.prepare(`PRAGMA table_info(${table})`).all();
    if (Array.isArray(cols) && cols.length) return cols.some((c) => c.name === name);
  } catch (e) {
    console.error('PRAGMA table_info gagal, fallback information_schema:', e.message);
  }
  const rows = await db
    .prepare(`SELECT 1 FROM information_schema.columns WHERE table_name = ? AND column_name = ?`)
    .get(table, name);
  return !!rows;
}

async function ensureColumn(table, ddl) {
  const name = ddl.match(/^(\w+)/)[1];
  if (!(await columnExists(table, name))) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

// Jalankan skema + migrasi kolom sekali saat boot. Idempoten.
async function initSchema() {
  await db.exec(SCHEMA);
  try {
    await ensureColumn('students', 'program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL');
    await ensureColumn('classes', 'program_id INTEGER REFERENCES programs(id) ON DELETE SET NULL');
    await ensureColumn('assessments', 'initial_condition TEXT');
  } catch (e) {
    console.error('migrasi kolom gagal:', e.message);
  }
}

function nowJakarta() {
  // Waktu sekarang dalam zona Asia/Jakarta, format ISO-like
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }))
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

function todayISO() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })).toISOString().slice(0, 10);
}

async function nextNumber(db_, prefix, table, column) {
  const ym = todayISO().slice(0, 7).replace('-', '');
  const like = `${prefix}-${ym}-%`;
  const row = await db_.prepare(`SELECT ${column} AS v FROM ${table} WHERE ${column} LIKE ? ORDER BY ${column} DESC LIMIT 1`).get(like);
  let seq = 1;
  if (row && row.v) {
    const parts = String(row.v).split('-');
    const n = parseInt(parts[parts.length - 1], 10);
    if (!Number.isNaN(n)) seq = n + 1;
  }
  return `${prefix}-${ym}-${String(seq).padStart(4, '0')}`;
}

async function getSetting(key, fallback = null) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  await db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now','+7 hours'))
    ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = datetime('now','+7 hours')`)
    .run(key, String(value));
}

async function audit(userId, userName, action, entity, entityId, detail, ip) {
  try {
    await db.prepare(`INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, detail, ip)
      VALUES (?,?,?,?,?,?,?)`)
      .run(userId ?? null, userName ?? null, action, entity ?? null, entityId ?? null,
        detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null, ip ?? null);
  } catch (e) {
    console.error('audit log gagal:', e.message);
  }
}

module.exports = { db, SCHEMA, initSchema, nowJakarta, todayISO, nextNumber, getSetting, setSetting, audit, DB_PATH };
