'use strict';
const express = require('express');
const { db, audit, setSetting, getSetting } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler, badRequest } = require('../middleware/helpers');

const router = express.Router();
router.use(requireAuth);

router.get('/subjects', asyncHandler(async (req, res) => {
  const { programId = '' } = req.query;
  const params = [];
  let where = '';
  if (programId) { where = 'WHERE EXISTS (SELECT 1 FROM program_subjects ps WHERE ps.subject_id = s.id AND ps.program_id = ?)'; params.push(Number(programId)); }
  const rows = await db.prepare(
    `SELECT s.*, (SELECT json_group_array(program_id) FROM program_subjects ps WHERE ps.subject_id = s.id) AS program_ids
     FROM subjects s ${where} ORDER BY s.name`
  ).all(...params);
  res.json({ data: rows.map((r) => ({ id: r.id, code: r.code, name: r.name, programIds: JSON.parse(r.program_ids || '[]') })) });
}));

router.get('/programs', asyncHandler(async (req, res) => {
  const rows = await db.prepare('SELECT * FROM programs ORDER BY name').all();
  const data = [];
  for (const p of rows) {
    const subjects = await db.prepare(
      `SELECT s.id, s.name, s.code FROM program_subjects ps JOIN subjects s ON s.id = ps.subject_id WHERE ps.program_id = ? ORDER BY s.name`
    ).all(p.id);
    data.push({ ...p, subjects });
  }
  res.json({ data });
}));

router.post('/programs', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const { code, name, targetLevel, durationMinutes, sessionsPerMonth, price, description, status } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nama program wajib diisi.' });
  const c = code || name.replace(/[^A-Za-z]/g, '').substring(0, 3).toUpperCase() + '-' + String((await db.prepare('SELECT COUNT(*) AS n FROM programs').get()).n + 1).padStart(2, '0');
  const dur = Number(durationMinutes) || 60;
  const sesi = Number(sessionsPerMonth) || 12;
  if (dur < 15 || dur > 480) return res.status(400).json({ error: 'Durasi program harus 15–480 menit.' });
  if (sesi < 1 || sesi > 62) return res.status(400).json({ error: 'Jumlah pertemuan/bulan harus 1–62.' });
  try {
    const info = await db.prepare(`INSERT INTO programs (code, name, target_level, duration_minutes, sessions_per_month, price, description, status)
      VALUES (?,?,?,?,?,?,?,?)`).run(c, name, targetLevel || null, dur, sesi, Number(price) || 0, description || null, status || 'aktif');
    await audit(req.user.id, req.user.fullName, 'TAMBAH_PROGRAM', 'programs', Number(info.lastInsertRowid), name, req.ip);
    res.status(201).json({ message: 'Program ditambahkan.', id: Number(info.lastInsertRowid) });
  } catch (e) {
    res.status(400).json({ error: 'Kode program sudah dipakai.' });
  }
}));

router.put('/programs/:id', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const p = await db.prepare('SELECT * FROM programs WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'Program tidak ditemukan.' });
  const { code, name, targetLevel, durationMinutes, sessionsPerMonth, price, description, status } = req.body || {};
  const dur = durationMinutes === undefined ? p.duration_minutes : Number(durationMinutes);
  const sesi = sessionsPerMonth === undefined ? p.sessions_per_month : Number(sessionsPerMonth);
  if (dur < 15 || dur > 480) return res.status(400).json({ error: 'Durasi program harus 15–480 menit.' });
  if (sesi < 1 || sesi > 62) return res.status(400).json({ error: 'Jumlah pertemuan/bulan harus 1–62.' });
  try {
    await db.prepare(`UPDATE programs SET code=?, name=?, target_level=?, duration_minutes=?, sessions_per_month=?, price=?, description=?, status=?, updated_at=datetime('now','+7 hours') WHERE id=?`)
      .run(code || p.code, name ?? p.name, targetLevel === undefined ? p.target_level : (targetLevel || null), dur, sesi,
        price === undefined ? p.price : Number(price) || 0, description === undefined ? p.description : (description || null),
        status || p.status, id);
  } catch (e) {
    return res.status(400).json({ error: 'Kode program sudah dipakai.' });
  }
  await audit(req.user.id, req.user.fullName, 'UBAH_PROGRAM', 'programs', id, name ?? p.name, req.ip);
  res.json({ message: 'Program diperbarui.' });
}));

router.delete('/programs/:id', requireRole('direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const p = await db.prepare('SELECT * FROM programs WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'Program tidak ditemukan.' });
  const used = await db.prepare('SELECT 1 FROM students WHERE program_id = ? UNION SELECT 1 FROM classes WHERE program_id = ? LIMIT 1').get(id, id);
  if (used) {
    await db.prepare(`UPDATE programs SET status='nonaktif', updated_at=datetime('now','+7 hours') WHERE id=?`).run(id);
    await audit(req.user.id, req.user.fullName, 'NONAKTIF_PROGRAM', 'programs', id, p.name, req.ip);
    return res.json({ message: 'Program masih dipakai siswa/kelas — program dinonaktifkan (riwayat tetap utuh).' });
  }
  await db.prepare('DELETE FROM programs WHERE id = ?').run(id);
  await audit(req.user.id, req.user.fullName, 'HAPUS_PROGRAM', 'programs', id, p.name, req.ip);
  res.json({ message: 'Program dihapus.' });
}));

router.put('/programs/:id/subjects', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const p = await db.prepare('SELECT * FROM programs WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'Program tidak ditemukan.' });
  const { subjectIds } = req.body || {};
  if (!Array.isArray(subjectIds)) return res.status(400).json({ error: 'Daftar mata pelajaran tidak valid.' });
  const valid = await db.prepare(`SELECT id FROM subjects WHERE id IN (${subjectIds.map(() => '?').join(',') || 'NULL'})`).all(...subjectIds.map(Number));
  if (valid.length !== subjectIds.length) return res.status(400).json({ error: 'Ada mata pelajaran yang tidak ditemukan.' });
  try {
    const items = [{ sql: 'DELETE FROM program_subjects WHERE program_id = ?', params: [id] }];
    for (const sid of subjectIds) {
      items.push({ sql: 'INSERT OR IGNORE INTO program_subjects (program_id, subject_id) VALUES (?,?)', params: [id, Number(sid)] });
    }
    await db.batch(items);
  } catch (e) {
    return res.status(400).json({ error: 'Gagal menyimpan mata pelajaran program: ' + e.message });
  }
  await audit(req.user.id, req.user.fullName, 'UBAH_MAPEL_PROGRAM', 'programs', id, { program: p.name, jumlahMapel: subjectIds.length }, req.ip);
  res.json({ message: `Mata pelajaran "${p.name}" diperbarui (${subjectIds.length} mapel).` });
}));

router.post('/subjects', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const { name, code, programIds } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Nama mata pelajaran wajib diisi.' });
  const c = code || name.substring(0, 3).toUpperCase() + (await db.prepare('SELECT COUNT(*) AS n FROM subjects').get()).n;
  try {
    const info = await db.prepare('INSERT INTO subjects (code, name) VALUES (?,?)').run(c, name);
    const id = Number(info.lastInsertRowid);
    if (Array.isArray(programIds)) {
      const ins = db.prepare('INSERT OR IGNORE INTO program_subjects (program_id, subject_id) VALUES (?,?)');
      for (const pid of programIds) if (pid) await ins.run(Number(pid), id);
    }
    await audit(req.user.id, req.user.fullName, 'TAMBAH_MAPEL', 'subjects', id, name, req.ip);
    res.status(201).json({ message: 'Mata pelajaran ditambahkan.', id });
  } catch (e) {
    res.status(400).json({ error: 'Kode mata pelajaran sudah dipakai.' });
  }
}));

router.delete('/subjects/:id', requireRole('direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const used = await db.prepare('SELECT 1 FROM classes WHERE subject_id = ? LIMIT 1').get(id);
  if (used) return res.status(400).json({ error: 'Mata pelajaran masih digunakan oleh kelas.' });
  await db.prepare('DELETE FROM subjects WHERE id = ?').run(id);
  await audit(req.user.id, req.user.fullName, 'HAPUS_MAPEL', 'subjects', id, null, req.ip);
  res.json({ message: 'Mata pelajaran dihapus.' });
}));

router.get('/report-periods', asyncHandler(async (req, res) => {
  res.json({ data: await db.prepare('SELECT * FROM report_periods ORDER BY start_date DESC').all() });
}));

router.post('/report-periods', requireRole('direktur', 'sekretaris'), asyncHandler(async (req, res) => {
  const { name, startDate, endDate } = req.body || {};
  if (!name || !startDate || !endDate) return res.status(400).json({ error: 'Nama periode, tanggal mulai, dan selesai wajib diisi.' });
  try {
    const info = await db.prepare('INSERT INTO report_periods (name, start_date, end_date) VALUES (?,?,?)').run(name, startDate, endDate);
    await audit(req.user.id, req.user.fullName, 'BUAT_PERIODE_RAPOR', 'report_periods', Number(info.lastInsertRowid), name, req.ip);
    res.status(201).json({ message: 'Periode rapor dibuat.', id: Number(info.lastInsertRowid) });
  } catch (e) {
    res.status(400).json({ error: 'Nama periode sudah ada.' });
  }
}));

router.put('/report-periods/:id', requireRole('direktur', 'sekretaris'), asyncHandler(async (req, res) => {
  const { name, startDate, endDate, status } = req.body || {};
  const p = await db.prepare('SELECT * FROM report_periods WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Periode tidak ditemukan.' });
  await db.prepare('UPDATE report_periods SET name=?, start_date=?, end_date=?, status=? WHERE id=?')
    .run(name ?? p.name, startDate ?? p.start_date, endDate ?? p.end_date, status ?? p.status, p.id);
  res.json({ message: 'Periode diperbarui.' });
}));

router.get('/settings', asyncHandler(async (req, res) => {
  res.json({
    data: {
      nama_lembaga: await getSetting('nama_lembaga', 'Bimbel Rumah Pintar'),
      alamat_lembaga: await getSetting('alamat_lembaga', 'Jl. Pendidikan No. 1, Indonesia'),
      telepon_lembaga: await getSetting('telepon_lembaga', '021-000-0000'),
      scale_labels: JSON.parse(await getSetting('scale_labels', '["Perlu bimbingan","Cukup baik","Baik","Sangat baik"]')),
      indicators: JSON.parse(await getSetting('indicators', '["Disiplin","Tanggung Jawab","Motivasi Belajar","Kemandirian","Kerjasama"]')),
      metode_pembayaran: JSON.parse(await getSetting('metode_pembayaran', '["Tunai","Transfer bank","QRIS","Lainnya"]')),
      kop_badan: await getSetting('kop_badan', 'BADAN USAHA MILIK DESA'),
      kop_unit: await getSetting('kop_unit', '"ABADI SEJAHTERA KLUMPIT"'),
      kop_lembaga: await getSetting('kop_lembaga', 'BIMBINGAN BELAJAR RUMAH PINTAR'),
      kop_email: await getSetting('kop_email', 'bumdesa_abadisejahteraklumpit@gmail.com'),
      kop_nomor: await getSetting('kop_nomor', 'AHU-00166.AH.01.33.TAHUN 2024'),
      kop_alamat: await getSetting('kop_alamat', 'Jl. Santren – Grobog RT 01 RW 02 Ds. Klumpit  +6285 800 555 885 - +6289 618 729 772 - +6287 710 270 730'),
      ttd_mengetahui: await getSetting('ttd_mengetahui', 'BUM Desa Abadi Sejahtera Klumpit'),
      ttd_pj: await getSetting('ttd_pj', 'NOR AFNAN, S.Pd.'),
    },
  });
}));

router.put('/settings', requireRole('direktur'), asyncHandler(async (req, res) => {
  const allowed = ['nama_lembaga', 'alamat_lembaga', 'telepon_lembaga', 'scale_labels', 'indicators', 'metode_pembayaran',
    'kop_badan', 'kop_unit', 'kop_lembaga', 'kop_email', 'kop_nomor', 'kop_alamat', 'ttd_mengetahui', 'ttd_pj'];
  for (const [k, v] of Object.entries(req.body || {})) {
    if (allowed.includes(k)) await setSetting(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  await audit(req.user.id, req.user.fullName, 'UBAH_PENGATURAN', 'settings', null, Object.keys(req.body || {}), req.ip);
  res.json({ message: 'Pengaturan disimpan.' });
}));

module.exports = router;
