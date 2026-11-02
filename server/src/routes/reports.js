'use strict';
const express = require('express');
const { db, audit, nextNumber, getSetting } = require('../db');
const { requireAuth, requireRole, isTutor } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../middleware/helpers');

const router = express.Router();
router.use(requireAuth);

const INDICATORS = async () => JSON.parse(await getSetting('indicators',
  '["Disiplin","Tanggung Jawab","Motivasi Belajar","Kemandirian","Kerjasama"]'));
const SCALE = async () => JSON.parse(await getSetting('scale_labels',
  '["Perlu bimbingan","Cukup baik","Baik","Sangat baik"]'));

async function attendanceRecap(studentId, period) {
  // Hitung berdasarkan pertemuan kelas siswa pada periode — status batal tidak dihitung terjadwal.
  const scheduled = (await db.prepare(
    `SELECT COUNT(*) AS n FROM class_sessions cs
     JOIN class_students csm ON csm.class_id = cs.class_id AND csm.student_id = ? AND csm.status = 'aktif'
     WHERE cs.session_date BETWEEN ? AND ? AND cs.status != 'batal'`
  ).get(studentId, period.start_date, period.end_date)).n;
  const rows = await db.prepare(
    `SELECT a.status, COUNT(*) AS n FROM student_attendances a
     JOIN class_sessions cs ON cs.id = a.session_id
     WHERE a.student_id = ? AND cs.session_date BETWEEN ? AND ? GROUP BY a.status`
  ).all(studentId, period.start_date, period.end_date);
  const m = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  const hadir = m.hadir || 0;
  return {
    scheduled,
    hadir,
    izin: m.izin || 0,
    sakit: m.sakit || 0,
    alpa: m.alpa || 0,
    percentage: scheduled ? Math.round((hadir / scheduled) * 1000) / 10 : 0,
  };
}

async function reportPayload(id) {
  const r = await db.prepare(
    `SELECT rp.*, s.full_name AS student_name, s.nis, s.education_level, s.school_grade, s.school_name, s.program,
            p.name AS period_name, p.start_date, p.end_date, c.name AS class_name, t.full_name AS tutor_name
     FROM student_reports rp
     JOIN students s ON s.id = rp.student_id
     JOIN report_periods p ON p.id = rp.period_id
     LEFT JOIN classes c ON c.id = rp.class_id
     JOIN tutors t ON t.id = rp.tutor_id
     WHERE rp.id = ?`
  ).get(id);
  if (!r) return null;
  const details = await db.prepare('SELECT * FROM report_details WHERE report_id = ?').all(id);
  const grades = await db.prepare(
    `SELECT a.*, sub.name AS subject_name FROM assessments a JOIN subjects sub ON sub.id = a.subject_id
     WHERE a.student_id = ? AND a.period_id = ?`
  ).all(r.student_id, r.period_id);
  const indicators = (await INDICATORS()).map((ind) => {
    const d = details.find((x) => x.indicator === ind);
    return { indicator: ind, score: d ? d.score : null, note: d ? d.note : null };
  });
  return {
    id: r.id, reportCode: r.report_code, status: r.status,
    student: {
      id: r.student_id, fullName: r.student_name, nis: r.nis,
      educationLevel: r.education_level, schoolGrade: r.school_grade, schoolName: r.school_name,
      program: r.program || null,
    },
    period: { id: r.period_id, name: r.period_name, start_date: r.start_date, end_date: r.end_date },
    className: r.class_name, tutorName: r.tutor_name, tutorId: r.tutor_id,
    attendance: {
      scheduled: r.scheduled_count, hadir: r.hadir_count, izin: r.izin_count,
      sakit: r.sakit_count, alpa: r.alpa_count,
      percentage: r.scheduled_count ? Math.round((r.hadir_count / r.scheduled_count) * 1000) / 10 : 0,
    },
    grades: grades.map((g) => ({
      subject: g.subject_name, initial: g.initial_score, task: g.task_score,
      practice: g.practice_score, final: g.final_score, notes: g.notes,
      initialCondition: g.initial_condition || null,
    })),
    indicators,
    scaleLabels: await SCALE(),
    notes: {
      mastered: r.notes_mastered, improve: r.notes_improve, difficulties: r.notes_difficulties,
      positive: r.notes_positive, suggestion: r.notes_suggestion, parent: r.notes_parent,
    },
    conclusion: r.conclusion, checkNote: r.check_note,
    submittedAt: r.submitted_at, checkedAt: r.checked_at, approvedAt: r.approved_at, publishedAt: r.published_at,
  };
}

router.get('/', asyncHandler(async (req, res) => {
  const { status = '', periodId = '', studentId = '', search = '' } = req.query;
  const params = [];
  const where = [];
  if (isTutor(req.user)) { where.push('rp.tutor_id = ?'); params.push(req.user.tutorId); }
  if (status) { where.push('rp.status = ?'); params.push(status); }
  if (periodId) { where.push('rp.period_id = ?'); params.push(Number(periodId)); }
  if (studentId) { where.push('rp.student_id = ?'); params.push(Number(studentId)); }
  if (search) { where.push('(s.full_name LIKE ? OR s.nis LIKE ? OR rp.report_code LIKE ?)'); const s = `%${search}%`; params.push(s, s, s); }
  const rows = await db.prepare(
    `SELECT rp.id, rp.report_code, rp.status, rp.updated_at, rp.published_at, rp.submitted_at,
            s.full_name AS student_name, s.nis, p.name AS period_name, c.name AS class_name, t.full_name AS tutor_name
     FROM student_reports rp JOIN students s ON s.id = rp.student_id
     JOIN report_periods p ON p.id = rp.period_id
     LEFT JOIN classes c ON c.id = rp.class_id JOIN tutors t ON t.id = rp.tutor_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY rp.id DESC LIMIT 500`
  ).all(...params);
  res.json({ data: rows });
}));

// Kandidat rapor: siswa aktif + periode yang belum punya rapor
router.get('/candidates', requireRole('tentor', 'sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const periodId = Number(req.query.periodId || 0);
  if (!periodId) return res.status(400).json({ error: 'Pilih periode.' });
  let sql = `
    SELECT s.id, s.nis, s.full_name, s.school_grade, c.id AS class_id, c.name AS class_name, c.tutor_id, t.full_name AS tutor_name
    FROM students s
    JOIN class_students cs ON cs.student_id = s.id AND cs.status='aktif'
    JOIN classes c ON c.id = cs.class_id AND c.status='aktif'
    JOIN tutors t ON t.id = c.tutor_id
    WHERE s.status='aktif' AND NOT EXISTS (SELECT 1 FROM student_reports rp WHERE rp.student_id=s.id AND rp.period_id=?)`;
  const params = [periodId];
  if (isTutor(req.user)) { sql += ' AND c.tutor_id = ?'; params.push(req.user.tutorId); }
  sql += ' ORDER BY s.full_name';
  res.json({ data: await db.prepare(sql).all(...params) });
}));

router.post('/', requireRole('tentor', 'sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const { studentId, periodId, classId, tutorId } = req.body || {};
  const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(Number(studentId));
  const period = await db.prepare('SELECT * FROM report_periods WHERE id = ?').get(Number(periodId));
  if (!student) throw notFound('Siswa tidak ditemukan.');
  if (!period) throw notFound('Periode rapor tidak ditemukan.');
  let tid = tutorId || null;
  if (isTutor(req.user)) {
    tid = req.user.tutorId;
    const owns = await db.prepare(`SELECT 1 FROM class_students cs JOIN classes c ON c.id=cs.class_id
      WHERE cs.student_id=? AND c.tutor_id=? AND cs.status='aktif' LIMIT 1`).get(student.id, tid);
    if (!owns) throw badRequest('Siswa ini bukan kelas tanggung jawab Anda.');
  }
  if (!tid && classId) {
    const c = await db.prepare('SELECT tutor_id FROM classes WHERE id=?').get(Number(classId));
    tid = c ? c.tutor_id : null;
  }
  if (!tid) throw badRequest('Rapor memerlukan tentor pengampu.');
  const recap = await attendanceRecap(student.id, period);
  const reportCode = await nextNumber(db, 'RPR', 'student_reports', 'report_code');
  const info2 = await db.prepare(
    `INSERT INTO student_reports (report_code, student_id, period_id, class_id, tutor_id, status,
      scheduled_count, hadir_count, izin_count, sakit_count, alpa_count, created_by)
     VALUES (?,?,?,?,?,'draf',?,?,?,?,?,?)`
  ).run(reportCode, student.id, period.id, classId || null, tid, recap.scheduled, recap.hadir, recap.izin, recap.sakit, recap.alpa, req.user.id);
  await audit(req.user.id, req.user.fullName, 'BUAT_RAPOR', 'student_reports', Number(info2.lastInsertRowid), { siswa: student.full_name, periode: period.name }, req.ip);
  res.status(201).json({ message: 'Draf rapor dibuat dengan rekap absensi otomatis.', id: Number(info2.lastInsertRowid) });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const payload = await reportPayload(Number(req.params.id));
  if (!payload) return res.status(404).json({ error: 'Rapor tidak ditemukan.' });
  if (isTutor(req.user) && payload.tutorId !== req.user.tutorId) {
    return res.status(403).json({ error: 'Rapor ini bukan tanggung jawab Anda.' });
  }
  res.json({ data: payload });
}));

// Isi/update isi rapor (hanya draf atau revisi)
router.put('/:id', requireRole('tentor', 'sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const r = await db.prepare('SELECT * FROM student_reports WHERE id = ?').get(id);
  if (!r) throw notFound('Rapor tidak ditemukan.');
  if (isTutor(req.user) && r.tutor_id !== req.user.tutorId) throw badRequest('Bukan rapor tanggung jawab Anda.');
  if (!['draf', 'revisi'].includes(r.status)) throw badRequest('Rapor yang sudah dikirim tidak dapat diubah langsung. Minta pengembalian untuk revisi.');
  const b = req.body || {};
  // Refresh rekap absensi agar angka selalu dari data asli
  const period = await db.prepare('SELECT * FROM report_periods WHERE id = ?').get(r.period_id);
  const recap = await attendanceRecap(r.student_id, period);
  await db.prepare(
    `UPDATE student_reports SET notes_mastered=?, notes_improve=?, notes_difficulties=?, notes_positive=?, notes_suggestion=?,
      notes_parent=?, conclusion=?, scheduled_count=?, hadir_count=?, izin_count=?, sakit_count=?, alpa_count=?,
      updated_at=datetime('now','+7 hours') WHERE id=?`
  ).run(
    b.mastered ?? r.notes_mastered, b.improve ?? r.notes_improve, b.difficulties ?? r.notes_difficulties,
    b.positive ?? r.notes_positive, b.suggestion ?? r.notes_suggestion, b.parent ?? r.notes_parent,
    b.conclusion ?? r.conclusion, recap.scheduled, recap.hadir, recap.izin, recap.sakit, recap.alpa, id
  );
  const upsert = db.prepare(
    `INSERT INTO report_details (report_id, indicator, score, note) VALUES (?,?,?,?)
     ON CONFLICT(report_id, indicator) DO UPDATE SET score = excluded.score, note = excluded.note`
  );
  if (Array.isArray(b.indicators)) {
    for (const ind of b.indicators) {
      if (ind.indicator) await upsert.run(id, ind.indicator, ind.score ?? null, ind.note || null);
    }
  }
  await audit(req.user.id, req.user.fullName, 'ISI_RAPOR', 'student_reports', id, null, req.ip);
  res.json({ message: 'Isi rapor tersimpan. Rekap absensi diperbarui otomatis dari data absensi.' });
}));

// Alur: kirim untuk pemeriksaan
router.post('/:id/submit', requireRole('tentor'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const r = await db.prepare('SELECT * FROM student_reports WHERE id = ?').get(id);
  if (!r) throw notFound('Rapor tidak ditemukan.');
  if (r.tutor_id !== req.user.tutorId) throw badRequest('Bukan rapor tanggung jawab Anda.');
  if (!['draf', 'revisi'].includes(r.status)) throw badRequest('Hanya rapor draf/revisi yang dapat dikirim.');
  const details = (await db.prepare('SELECT COUNT(*) AS n FROM report_details WHERE report_id = ? AND score IS NOT NULL').get(id)).n;
  if (details < 1) throw badRequest('Isi minimal satu indikator penilaian perkembangan sebelum mengirim.');
  const p = await reportPayload(id);
  if (!p.grades.length) {
    // Tidak mengarang nilai — hanya peringatan, tetap boleh dikirim dengan catatan belum ada data.
  }
  await db.prepare(`UPDATE student_reports SET status='menunggu', submitted_at=datetime('now','+7 hours'), updated_at=datetime('now','+7 hours') WHERE id=?`).run(id);
  await audit(req.user.id, req.user.fullName, 'KIRIM_RAPOR', 'student_reports', id, 'Menunggu pemeriksaan sekretaris', req.ip);
  res.json({ message: 'Rapor dikirim untuk pemeriksaan.' });
}));

// Sekretaris memeriksa: terima atau kembalikan untuk revisi
router.post('/:id/check', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const r = await db.prepare('SELECT * FROM student_reports WHERE id = ?').get(id);
  if (!r) throw notFound('Rapor tidak ditemukan.');
  if (r.status !== 'menunggu') throw badRequest('Hanya rapor berstatus menunggu pemeriksaan yang dapat diperiksa.');
  const { action, note } = req.body || {};
  if (action === 'revisi') {
    if (!note) throw badRequest('Pengembalian untuk revisi wajib disertai catatan.');
    await db.prepare(`UPDATE student_reports SET status='revisi', check_note=?, checked_at=datetime('now','+7 hours'), updated_at=datetime('now','+7 hours') WHERE id=?`)
      .run(note, id);
    await audit(req.user.id, req.user.fullName, 'RAPOR_REVISI', 'student_reports', id, note, req.ip);
    return res.json({ message: 'Rapor dikembalikan ke tentor untuk revisi.' });
  }
  if (action !== 'approve') throw badRequest('Aksi tidak dikenal.');
  await db.prepare(`UPDATE student_reports SET status='disetujui', check_note=?, checked_at=datetime('now','+7 hours'), updated_at=datetime('now','+7 hours') WHERE id=?`)
    .run(note || null, id);
  await audit(req.user.id, req.user.fullName, 'RAPOR_DIPERIKSA', 'student_reports', id, 'Disetujui sekretaris', req.ip);
  res.json({ message: 'Rapor disetujui sekretaris.' });
}));

// Direktur memberikan persetujuan final
router.post('/:id/approve', requireRole('direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const r = await db.prepare('SELECT * FROM student_reports WHERE id = ?').get(id);
  if (!r) throw notFound('Rapor tidak ditemukan.');
  if (r.status !== 'disetujui') throw badRequest('Rapor harus disetujui sekretaris terlebih dahulu.');
  await db.prepare(`UPDATE student_reports SET approved_at=datetime('now','+7 hours'), updated_at=datetime('now','+7 hours') WHERE id=?`).run(id);
  await audit(req.user.id, req.user.fullName, 'SETUJUI_RAPOR', 'student_reports', id, 'Persetujuan direktur', req.ip);
  res.json({ message: 'Rapor disetujui direktur dan siap diterbitkan.' });
}));

// Terbitkan — PDF digenerate di sisi klien (Cloudflare Workers tidak sanggup render PDF server-side).
router.post('/:id/publish', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const r = await db.prepare('SELECT * FROM student_reports WHERE id = ?').get(id);
  if (!r) throw notFound('Rapor tidak ditemukan.');
  if (!['disetujui', 'diterbitkan'].includes(r.status)) {
    throw badRequest('Rapor harus melalui pemeriksaan sekretaris dan persetujuan direktur sebelum diterbitkan.');
  }
  if (r.status === 'diterbitkan') throw badRequest('Rapor sudah diterbitkan.');
  await db.prepare(`UPDATE student_reports SET status='diterbitkan', published_at=datetime('now','+7 hours'), updated_at=datetime('now','+7 hours') WHERE id=?`)
    .run(id);
  await audit(req.user.id, req.user.fullName, 'TERBITKAN_RAPOR', 'student_reports', id, 'Rapor diterbitkan', req.ip);
  res.json({ message: 'Rapor diterbitkan. PDF dapat diunduh melalui tombol PDF di daftar rapor.' });
}));

module.exports = router;
