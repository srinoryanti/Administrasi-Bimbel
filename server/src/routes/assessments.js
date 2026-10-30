'use strict';
const express = require('express');
const { db, audit } = require('../db');
const { requireAuth, requireRole, isTutor } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../middleware/helpers');

const router = express.Router();
router.use(requireAuth);

// Mapel boleh dinilai untuk siswa bila terdaftar pada program siswa.
// Bila program siswa belum punya daftar mapel (junction kosong), semua mapel diizinkan.
async function subjectAllowedForStudent(studentId, subjectId) {
  const st = await db.prepare('SELECT program_id FROM students WHERE id = ?').get(studentId);
  if (!st || !st.program_id) return true;
  const total = (await db.prepare('SELECT COUNT(*) AS n FROM program_subjects WHERE program_id = ?').get(st.program_id)).n;
  if (!total) return true;
  return !!(await db.prepare('SELECT 1 FROM program_subjects WHERE program_id = ? AND subject_id = ?').get(st.program_id, subjectId));
}

// Nilai & evaluasi — satu baris per siswa + mata pelajaran + periode.
router.get('/', asyncHandler(async (req, res) => {
  const { studentId = '', subjectId = '', period = '', search = '' } = req.query;
  const params = [];
  const where = [];
  if (studentId) { where.push('a.student_id = ?'); params.push(Number(studentId)); }
  if (subjectId) { where.push('a.subject_id = ?'); params.push(Number(subjectId)); }
  if (period) { where.push('a.period_label = ?'); params.push(period); }
  if (search) { where.push('(s.full_name LIKE ? OR s.nis LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }
  const rows = await db.prepare(
    `SELECT a.*, s.full_name AS student_name, s.nis, sub.name AS subject_name, u.full_name AS creator_name
     FROM assessments a JOIN students s ON s.id = a.student_id JOIN subjects sub ON sub.id = a.subject_id
     LEFT JOIN users u ON u.id = a.created_by
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.period_label DESC, s.full_name, sub.name LIMIT 1000`
  ).all(...params);
  res.json({
    data: rows.map((r) => ({
      id: r.id, studentId: r.student_id, studentName: r.student_name, nis: r.nis, subjectId: r.subject_id,
      subjectName: r.subject_name, periodId: r.period_id, periodLabel: r.period_label,
      initialScore: r.initial_score, taskScore: r.task_score, practiceScore: r.practice_score, finalScore: r.final_score,
      initialCondition: r.initial_condition || null,
      notes: r.notes, creatorName: r.creator_name, updatedAt: r.updated_at,
    })),
  });
}));

router.post('/', requireRole('tentor', 'sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.studentId || !b.subjectId || !b.periodLabel) throw badRequest('Siswa, mata pelajaran, dan periode wajib diisi.');
  if (b.taskScore != null && (b.taskScore < 0 || b.taskScore > 100)) throw badRequest('Nilai tugas harus 0–100.');
  if (b.practiceScore != null && (b.practiceScore < 0 || b.practiceScore > 100)) throw badRequest('Nilai latihan harus 0–100.');
  if (b.finalScore != null && (b.finalScore < 0 || b.finalScore > 100)) throw badRequest('Nilai akhir harus 0–100.');
  if (!(await subjectAllowedForStudent(b.studentId, b.subjectId))) {
    const sub = await db.prepare('SELECT name FROM subjects WHERE id = ?').get(b.subjectId);
    throw badRequest(`Mapel "${sub ? sub.name : b.subjectId}" tidak termasuk mata pelajaran program siswa ini.`);
  }
  const existing = await db.prepare('SELECT * FROM assessments WHERE student_id=? AND subject_id=? AND period_label=?')
    .get(b.studentId, b.subjectId, b.periodLabel);
  if (existing) {
    // Sekretaris tidak boleh diam-diam mengubah nilai tentor — wajib melalui koreksi tercatat.
    if (req.user.role === 'sekretaris' && !b.correctionNote) {
      throw badRequest('Sekretaris tidak dapat mengubah nilai secara diam-diam. Perubahan nilai memerlukan catatan koreksi yang akan tercatat dalam audit log.');
    }
    await db.prepare(
      `UPDATE assessments SET initial_score=?, task_score=?, practice_score=?, final_score=?, notes=?,
         initial_condition=?, created_by=?, updated_at=datetime('now','+7 hours') WHERE id=?`
    ).run(b.initialScore ?? null, b.taskScore ?? null, b.practiceScore ?? null, b.finalScore ?? null, b.notes || null,
      b.initialCondition || null, req.user.id, existing.id);
    await audit(req.user.id, req.user.fullName, 'KOREKSI_NILAI', 'assessments', existing.id,
      { nilaiLama: { tugas: existing.task_score, latihan: existing.practice_score, akhir: existing.final_score },
        nilaiBaru: { tugas: b.taskScore, latihan: b.practiceScore, akhir: b.finalScore }, catatanKoreksi: b.correctionNote || null }, req.ip);
    return res.json({ message: 'Nilai diperbarui dan koreksi tercatat dalam riwayat aktivitas.', id: existing.id });
  }
  const info = await db.prepare(
    `INSERT INTO assessments (student_id, subject_id, period_id, period_label, initial_score, task_score, practice_score, final_score, notes, initial_condition, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(b.studentId, b.subjectId, b.periodId || null, b.periodLabel, b.initialScore ?? null, b.taskScore ?? null,
    b.practiceScore ?? null, b.finalScore ?? null, b.notes || null, b.initialCondition || null, req.user.id);
  await audit(req.user.id, req.user.fullName, 'BUAT_NILAI', 'assessments', Number(info.lastInsertRowid), { studentId: b.studentId, periode: b.periodLabel }, req.ip);
  res.status(201).json({ message: 'Nilai tersimpan.', id: Number(info.lastInsertRowid) });
}));

router.delete('/:id', requireRole('direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const a = await db.prepare('SELECT * FROM assessments WHERE id = ?').get(id);
  if (!a) throw notFound('Data nilai tidak ditemukan.');
  await db.prepare('DELETE FROM assessments WHERE id = ?').run(id);
  await audit(req.user.id, req.user.fullName, 'HAPUS_NILAI', 'assessments', id, a, req.ip);
  res.json({ message: 'Data nilai dihapus.' });
}));

module.exports = router;
