'use strict';
const express = require('express');
const { db, audit, todayISO, nextNumber } = require('../db');
const { requireAuth, requireRole, isAdmin, isTutor } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../middleware/helpers');

const router = express.Router();
router.use(requireAuth);

function mapStudent(r) {
  if (!r) return null;
  return {
    id: r.id, nis: r.nis, fullName: r.full_name, birthPlace: r.birth_place, birthDate: r.birth_date,
    gender: r.gender, educationLevel: r.education_level, schoolGrade: r.school_grade, schoolName: r.school_name,
    address: r.address, program: r.program, programId: r.program_id, startDate: r.start_date, status: r.status, photoPath: r.photo_path,
    isDemo: !!r.is_demo, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// Daftar siswa — tentor hanya melihat siswa di kelas yang diampunya.
router.get('/', asyncHandler(async (req, res) => {
  const { search = '', status = '', level = '', program = '' } = req.query;
  const params = [];
  let joinMy = '';
  let where = [];
  if (isTutor(req.user)) {
    joinMy = `JOIN class_students cs ON cs.student_id = s.id AND cs.status = 'aktif'
              JOIN classes c ON c.id = cs.class_id AND c.tutor_id = ?`;
    params.push(req.user.tutorId);
  }
  if (search) { where.push('(s.full_name LIKE ? OR s.nis LIKE ? OR s.school_name LIKE ?)'); const s = `%${search}%`; params.push(s, s, s); }
  if (status) { where.push('s.status = ?'); params.push(status); }
  if (level) { where.push('s.education_level = ?'); params.push(level); }
  if (program) { where.push('s.program LIKE ?'); params.push(`%${program}%`); }
  const sql = `SELECT DISTINCT s.*, (SELECT g.guardian_name FROM student_guardians g WHERE g.student_id = s.id LIMIT 1) AS guardian_name,
    (SELECT g.phone FROM student_guardians g WHERE g.student_id = s.id LIMIT 1) AS guardian_phone
    FROM students s ${joinMy} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY s.full_name`;
  const rows = await db.prepare(sql).all(...params);
  res.json({ data: rows.map((r) => ({ ...mapStudent(r), guardianName: r.guardian_name, guardianPhone: r.guardian_phone })) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const s = await db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  if (!s) throw notFound('Siswa tidak ditemukan.');
  if (isTutor(req.user)) {
    const owned = await db.prepare(
      `SELECT 1 FROM class_students cs JOIN classes c ON c.id = cs.class_id
       WHERE cs.student_id = ? AND c.tutor_id = ? AND cs.status='aktif' LIMIT 1`
    ).get(id, req.user.tutorId);
    if (!owned) throw badRequest('Anda tidak memiliki akses ke data siswa ini.');
  }
  const guardians = await db.prepare('SELECT * FROM student_guardians WHERE student_id = ?').all(id);
  res.json({ data: { ...mapStudent(s), guardians } });
}));

// Detail siswa: relasi kelas, mata pelajaran, tentor
router.get('/:id/relations', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const classes = await db.prepare(
    `SELECT cs.*, c.name AS class_name, c.class_code, c.level, c.type, c.status AS class_status, t.full_name AS tutor_name
     FROM class_students cs JOIN classes c ON c.id = cs.class_id
     LEFT JOIN tutors t ON t.id = c.tutor_id WHERE cs.student_id = ? ORDER BY cs.id DESC`
  ).all(id);
  const subjects = await db.prepare(
    `SELECT ss.*, sub.name AS subject_name, sub.code AS subject_code, t.full_name AS tutor_name
     FROM student_subjects ss JOIN subjects sub ON sub.id = ss.subject_id
     LEFT JOIN tutors t ON t.id = ss.tutor_id WHERE ss.student_id = ?`
  ).all(id);
  res.json({ classes, subjects });
}));

// Sinkronkan kolom teks `program` dari master program agar laporan/tagihan/PDF tetap jalan.
async function resolveProgram(b) {
  if (!('programId' in b) && !('program' in b)) return {};
  if (b.programId) {
    const pid = Number(b.programId);
    const p = await db.prepare('SELECT name FROM programs WHERE id = ?').get(pid);
    if (p) return { programId: pid, program: p.name };
    return { programId: null, program: b.program ?? null };
  }
  if ('programId' in b) return { programId: null, program: b.program ?? null };
  return { program: b.program ?? null };
}

router.post('/', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.fullName) throw badRequest('Nama lengkap siswa wajib diisi.');
  const prog = await resolveProgram(b);
  const nis = await nextNumber(db, 'SIS', 'students', 'nis');
  const info = await db.prepare(
    `INSERT INTO students (nis, full_name, birth_place, birth_date, gender, education_level, school_grade, school_name, address, program, program_id, start_date, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    nis, b.fullName, b.birthPlace || null, b.birthDate || null, b.gender || null, b.educationLevel || null,
    b.schoolGrade || null, b.schoolName || null, b.address || null, prog.program ?? null,
    prog.programId ?? null, b.startDate || todayISO(), b.status || 'aktif'
  );
  const id = Number(info.lastInsertRowid);
  if (b.guardianName) {
    await db.prepare('INSERT INTO student_guardians (student_id, guardian_name, relation, phone, occupation) VALUES (?,?,?,?,?)')
      .run(id, b.guardianName, b.guardianRelation || 'Orang Tua', b.guardianPhone || null, b.guardianOccupation || null);
  }
  await audit(req.user.id, req.user.fullName, 'TAMBAH_SISWA', 'students', id, { nis, nama: b.fullName }, req.ip);
  res.status(201).json({ message: 'Siswa berhasil ditambahkan.', id, nis });
}));

router.put('/:id', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const s = await db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  if (!s) throw notFound('Siswa tidak ditemukan.');
  const b = req.body || {};
  const prog = await resolveProgram(b);
  await db.prepare(
    `UPDATE students SET full_name=?, birth_place=?, birth_date=?, gender=?, education_level=?, school_grade=?,
      school_name=?, address=?, program=?, program_id=?, start_date=?, status=?, updated_at=datetime('now','+7 hours') WHERE id=?`
  ).run(
    b.fullName ?? s.full_name, b.birthPlace ?? s.birth_place, b.birthDate ?? s.birth_date, b.gender ?? s.gender,
    b.educationLevel ?? s.education_level, b.schoolGrade ?? s.school_grade, b.schoolName ?? s.school_name,
    b.address ?? s.address, 'program' in prog ? prog.program : s.program,
    'programId' in prog ? prog.programId : s.program_id,
    b.startDate ?? s.start_date, b.status ?? s.status, id
  );
  if (b.guardianName !== undefined) {
    await db.prepare('DELETE FROM student_guardians WHERE student_id = ?').run(id);
    if (b.guardianName) {
      await db.prepare('INSERT INTO student_guardians (student_id, guardian_name, relation, phone, occupation) VALUES (?,?,?,?,?)')
        .run(id, b.guardianName, b.guardianRelation || 'Orang Tua', b.guardianPhone || null, b.guardianOccupation || null);
    }
  }
  await audit(req.user.id, req.user.fullName, 'UBAH_SISWA', 'students', id, { nama: b.fullName || s.full_name }, req.ip);
  res.json({ message: 'Data siswa berhasil diperbarui.' });
}));

// Siswa dengan riwayat transaksi tidak dihapus permanen — hanya dinonaktifkan/diarsipkan.
router.delete('/:id', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const s = await db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  if (!s) throw notFound('Siswa tidak ditemukan.');
  const hasHistory =
    (await db.prepare(`SELECT 1 FROM student_attendances WHERE student_id = ? LIMIT 1`).get(id)) ||
    (await db.prepare(`SELECT 1 FROM invoices WHERE student_id = ? LIMIT 1`).get(id)) ||
    (await db.prepare(`SELECT 1 FROM student_reports WHERE student_id = ? LIMIT 1`).get(id)) ||
    (await db.prepare(`SELECT 1 FROM assessments WHERE student_id = ? LIMIT 1`).get(id));
  if (hasHistory) {
    await db.prepare(`UPDATE students SET status='berhenti', updated_at=datetime('now','+7 hours') WHERE id=?`).run(id);
    await audit(req.user.id, req.user.fullName, 'ARSIP_SISWA', 'students', id, 'Siswa memiliki riwayat — dinonaktifkan, bukan dihapus', req.ip);
    return res.json({ message: 'Siswa memiliki riwayat transaksi/pembelajaran. Data dinonaktifkan (diarsipkan), bukan dihapus permanen.' });
  }
  await db.prepare('DELETE FROM student_guardians WHERE student_id = ?').run(id);
  await db.prepare('DELETE FROM students WHERE id = ?').run(id);
  await audit(req.user.id, req.user.fullName, 'HAPUS_SISWA', 'students', id, { nis: s.nis, nama: s.full_name }, req.ip);
  res.json({ message: 'Data siswa berhasil dihapus permanen (belum memiliki riwayat transaksi).' });
}));

module.exports = router;
module.exports.mapStudent = mapStudent;
