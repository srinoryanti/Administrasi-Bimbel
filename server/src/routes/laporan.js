'use strict';
const express = require('express');
const ExcelJS = require('exceljs');
const storage = require('../storage');
const { db, audit, todayISO } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../middleware/helpers');
const { buildTablePDF, rupiah, tgl } = require('../pdf');

const router = express.Router();
router.use(requireAuth, requireRole('sekretaris', 'direktur'));

async function studentsData() {
  return db.prepare(
    `SELECT s.nis AS 'NIS', s.full_name AS 'Nama Lengkap', s.gender AS 'JK', s.education_level AS 'Jenjang',
            s.school_grade AS 'Kelas Sekolah', s.school_name AS 'Sekolah', s.program AS 'Program',
            s.start_date AS 'Mulai Bimbel', s.status AS 'Status',
            (SELECT GROUP_CONCAT(g.guardian_name || ' (' || COALESCE(g.phone,'-') || ')', '; ') FROM student_guardians g WHERE g.student_id=s.id) AS 'Orang Tua/Wali'
     FROM students s ORDER BY s.full_name`
  ).all();
}

async function tutorsData() {
  return db.prepare(
    `SELECT t.employee_id AS 'ID Internal', t.full_name AS 'Nama', t.email AS 'Email', t.phone AS 'HP',
            t.education AS 'Pendidikan', t.expertise AS 'Keahlian', t.join_date AS 'Bergabung', t.status AS 'Status'
     FROM tutors t ORDER BY t.full_name`
  ).all();
}

async function classesData() {
  return db.prepare(
    `SELECT c.class_code AS 'Kode', c.name AS 'Kelas', c.level AS 'Jenjang', COALESCE(sub.name,'-') AS 'Mata Pelajaran',
            c.type AS 'Jenis', COALESCE(t.full_name,'-') AS 'Tentor', c.location AS 'Lokasi', c.status AS 'Status',
            (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id=c.id AND cs.status='aktif') AS 'Jumlah Siswa'
     FROM classes c LEFT JOIN subjects sub ON sub.id=c.subject_id LEFT JOIN tutors t ON t.id=c.tutor_id ORDER BY c.name`
  ).all();
}

async function attendanceData({ from, to }) {
  return db.prepare(
    `SELECT cs.session_date AS 'Tanggal', c.name AS 'Kelas', t.full_name AS 'Tentor', s.nis AS 'NIS',
            s.full_name AS 'Siswa', a.status AS 'Status', COALESCE(a.note,'') AS 'Catatan'
     FROM student_attendances a JOIN class_sessions cs ON cs.id=a.session_id
     JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=a.class_id JOIN tutors t ON t.id=cs.tutor_id
     WHERE (?='' OR cs.session_date>=?) AND (?='' OR cs.session_date<=?)
     ORDER BY cs.session_date DESC, s.full_name`
  ).all(from || '', from || '', to || '', to || '');
}

async function tutorAttendanceData({ from, to }) {
  return db.prepare(
    `SELECT ta.att_date AS 'Tanggal', t.full_name AS 'Tentor', COALESCE(c.name,'-') AS 'Kelas',
            COALESCE(ta.start_time,'-') AS 'Mulai', COALESCE(ta.end_time,'-') AS 'Selesai',
            ta.status AS 'Kehadiran', COALESCE(ta.learning_status,'-') AS 'Pelaksanaan', COALESCE(ta.note,'') AS 'Catatan'
     FROM tutor_attendances ta JOIN tutors t ON t.id=ta.tutor_id
     LEFT JOIN class_sessions cs ON cs.id=ta.session_id LEFT JOIN classes c ON c.id=cs.class_id
     WHERE (?='' OR ta.att_date>=?) AND (?='' OR ta.att_date<=?) ORDER BY ta.att_date DESC`
  ).all(from || '', from || '', to || '', to || '');
}

async function invoicesData({ from, to }) {
  return db.prepare(
    `SELECT i.invoice_number AS 'No. Tagihan', s.nis AS 'NIS', s.full_name AS 'Siswa', i.period AS 'Periode',
            i.invoice_date AS 'Tanggal', i.due_date AS 'Jatuh Tempo', i.total AS 'Total', i.paid AS 'Dibayar',
            (i.total-i.paid) AS 'Sisa', i.status AS 'Status'
     FROM invoices i JOIN students s ON s.id=i.student_id
     WHERE (?='' OR i.invoice_date>=?) AND (?='' OR i.invoice_date<=?) ORDER BY i.id DESC`
  ).all(from || '', from || '', to || '', to || '');
}

async function paymentsData({ from, to }) {
  return db.prepare(
    `SELECT p.transaction_number AS 'No. Transaksi', p.paid_at AS 'Tanggal', s.full_name AS 'Siswa',
            COALESCE(i.invoice_number,'-') AS 'Tagihan', p.amount AS 'Nominal', p.method AS 'Metode',
            COALESCE(u.full_name,'-') AS 'Petugas', p.status AS 'Status'
     FROM payments p JOIN students s ON s.id=p.student_id
     LEFT JOIN invoices i ON i.id=p.invoice_id LEFT JOIN users u ON u.id=p.recorded_by
     WHERE p.status='posted' AND (?='' OR p.paid_at>=?) AND (?='' OR p.paid_at<=?) ORDER BY p.paid_at DESC`
  ).all(from || '', from || '', to || '', to || '');
}

async function reportsData() {
  return db.prepare(
    `SELECT rp.report_code AS 'Kode', s.full_name AS 'Siswa', p.name AS 'Periode', c.name AS 'Kelas',
            t.full_name AS 'Tentor', rp.status AS 'Status', rp.hadir_count AS 'Hadir', rp.scheduled_count AS 'Terjadwal',
            rp.published_at AS 'Terbit'
     FROM student_reports rp JOIN students s ON s.id=rp.student_id JOIN report_periods p ON p.id=rp.period_id
     LEFT JOIN classes c ON c.id=rp.class_id JOIN tutors t ON t.id=rp.tutor_id ORDER BY rp.id DESC`
  ).all();
}

async function archivesData() {
  return db.prepare(
    `SELECT a.doc_code AS 'Kode', a.doc_name AS 'Nama Dokumen', a.category AS 'Kategori',
            COALESCE(a.doc_number,'-') AS 'No. Dokumen', a.doc_date AS 'Tanggal', a.year AS 'Tahun',
            a.file_name AS 'Berkas', a.version AS 'Versi', a.status AS 'Status'
     FROM archives a ORDER BY a.id DESC`
  ).all();
}

async function journalsData({ from, to }) {
  return db.prepare(
    `SELECT j.journal_date AS 'Tanggal', c.name AS 'Kelas', t.full_name AS 'Tentor', j.material AS 'Materi',
            COALESCE(j.objective,'') AS 'Tujuan', COALESCE(j.outcomes,'') AS 'Hasil', j.status AS 'Status'
     FROM teaching_journals j JOIN classes c ON c.id=j.class_id JOIN tutors t ON t.id=j.tutor_id
     WHERE (?='' OR j.journal_date>=?) AND (?='' OR j.journal_date<=?) ORDER BY j.journal_date DESC`
  ).all(from || '', from || '', to || '', to || '');
}

async function developmentData() {
  return db.prepare(
    `SELECT s.nis AS 'NIS', s.full_name AS 'Siswa', sub.name AS 'Mata Pelajaran', a.period_label AS 'Periode',
            COALESCE(a.initial_score,'-') AS 'Awal', COALESCE(a.task_score,'-') AS 'Tugas',
            COALESCE(a.practice_score,'-') AS 'Latihan', COALESCE(a.final_score,'-') AS 'Akhir', COALESCE(a.notes,'') AS 'Catatan'
     FROM assessments a JOIN students s ON s.id=a.student_id JOIN subjects sub ON sub.id=a.subject_id
     ORDER BY a.period_label DESC, s.full_name`
  ).all();
}

async function summaryData() {
  const g = async (sql, ...p) => db.prepare(sql).get(...p);
  return [
    { item: 'Siswa aktif', value: (await g(`SELECT COUNT(*) n FROM students WHERE status='aktif'`)).n },
    { item: 'Siswa cuti', value: (await g(`SELECT COUNT(*) n FROM students WHERE status='cuti'`)).n },
    { item: 'Siswa berhenti', value: (await g(`SELECT COUNT(*) n FROM students WHERE status='berhenti'`)).n },
    { item: 'Tentor aktif', value: (await g(`SELECT COUNT(*) n FROM tutors WHERE status='aktif'`)).n },
    { item: 'Kelas aktif', value: (await g(`SELECT COUNT(*) n FROM classes WHERE status='aktif'`)).n },
    { item: 'Pertemuan tercatat', value: (await g(`SELECT COUNT(*) n FROM class_sessions`)).n },
    { item: 'Absensi terisi', value: (await g(`SELECT COUNT(*) n FROM student_attendances`)).n },
    { item: 'Jurnal mengajar', value: (await g(`SELECT COUNT(*) n FROM teaching_journals`)).n },
    { item: 'Rapor diterbitkan', value: (await g(`SELECT COUNT(*) n FROM student_reports WHERE status='diterbitkan'`)).n },
    { item: 'Rapor belum selesai', value: (await g(`SELECT COUNT(*) n FROM student_reports WHERE status!='diterbitkan'`)).n },
    { item: 'Total pemasukan', value: rupiah((await g(`SELECT COALESCE(SUM(amount),0) n FROM payments WHERE status='posted'`)).n) },
    { item: 'Tagihan belum lunas', value: (await g(`SELECT COUNT(*) n FROM invoices WHERE status IN ('belum','sebagian','jatuh_tempo')`)).n },
    { item: 'Nilai tunggakan', value: rupiah((await g(`SELECT COALESCE(SUM(total-paid),0) n FROM invoices WHERE status='jatuh_tempo'`)).n) },
    { item: 'Dokumen arsip', value: (await g(`SELECT COUNT(*) n FROM archives`)).n },
  ];
}

const REPORT_TYPES = {
  siswa: { title: 'Data Siswa', fn: studentsData },
  siswa_baru: { title: 'Data Siswa Baru', fn: async () => db.prepare(`SELECT nis AS 'NIS', full_name AS 'Nama', start_date AS 'Mulai', program AS 'Program', school_name AS 'Sekolah', status AS 'Status' FROM students ORDER BY start_date DESC`).all() },
  tentor: { title: 'Data Tentor', fn: tutorsData },
  kelas: { title: 'Data Kelas', fn: classesData },
  absensi_siswa: { title: 'Absensi Siswa', fn: attendanceData },
  absensi_tentor: { title: 'Absensi Tentor', fn: tutorAttendanceData },
  aktivitas_pembelajaran: { title: 'Aktivitas Pembelajaran (Jurnal)', fn: journalsData },
  perkembangan: { title: 'Perkembangan & Nilai Siswa', fn: developmentData },
  rapor_terbit: { title: 'Rapor Diterbitkan', fn: async () => (await reportsData()).filter((r) => r.Status === 'diterbitkan') },
  rapor_pending: { title: 'Rapor Belum Selesai', fn: async () => (await reportsData()).filter((r) => r.Status !== 'diterbitkan') },
  tagihan: { title: 'Tagihan Siswa', fn: invoicesData },
  pembayaran: { title: 'Pembayaran', fn: paymentsData },
  tunggakan: { title: 'Tunggakan', fn: async () => db.prepare(`SELECT i.invoice_number AS 'No. Tagihan', s.full_name AS 'Siswa', i.period AS 'Periode', i.due_date AS 'Jatuh Tempo', (i.total-i.paid) AS 'Sisa', i.status AS 'Status' FROM invoices i JOIN students s ON s.id=i.student_id WHERE i.status IN ('sebagian','jatuh_tempo') ORDER BY i.due_date`).all() },
  pemasukan_bulanan: { title: 'Pemasukan Per Bulan', fn: async () => db.prepare(`SELECT substr(paid_at,1,7) AS 'Bulan', SUM(amount) AS 'Total Pemasukan', COUNT(*) AS 'Jumlah Transaksi' FROM payments WHERE status='posted' GROUP BY 1 ORDER BY 1 DESC`).all() },
  arsip: { title: 'Daftar Arsip Dokumen', fn: archivesData },
  ringkasan: { title: 'Ringkasan Aktivitas Bimbel', fn: summaryData },
};

router.get('/types', (req, res) => {
  res.json({ data: Object.keys(REPORT_TYPES).map((k) => ({ key: k, title: REPORT_TYPES[k].title })) });
});

router.get('/:type', asyncHandler(async (req, res) => {
  const t = REPORT_TYPES[req.params.type];
  if (!t) throw notFound('Jenis laporan tidak dikenal.');
  const rows = await t.fn({ from: req.query.from || '', to: req.query.to || '' });
  res.json({ data: rows, title: t.title });
}));

router.get('/:type/excel', asyncHandler(async (req, res) => {
  const t = REPORT_TYPES[req.params.type];
  if (!t) throw notFound('Jenis laporan tidak dikenal.');
  const rows = await t.fn({ from: req.query.from || '', to: req.query.to || '' });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistem Informasi Bimbel Rumah Pintar';
  const ws = wb.addWorksheet(t.title);
  const headers = rows.length ? Object.keys(rows[0]) : ['Keterangan'];
  const lastCol = Math.max(1, headers.length);
  ws.mergeCells(1, 1, 1, lastCol);
  ws.getCell('A1').value = `BIMBEL RUMAH PINTAR — ${t.title.toUpperCase()}`;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1E3A5F' } };
  ws.getCell('A2').value = `Periode: ${req.query.from || 'semua'} s.d. ${req.query.to || 'semua'} • Dibuat: ${todayISO()}`;
  ws.getCell('A2').font = { size: 9, color: { argb: 'FF666666' } };
  if (rows.length) {
    ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(14, Math.min(40, h.length + 8)) }));
    const headRow = ws.getRow(4);
    headers.forEach((h, i) => {
      const c = headRow.getCell(i + 1);
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
    });
    headRow.commit();
    rows.forEach((r) => ws.addRow(r));
    // Format Rupiah untuk kolom nominal
    headers.forEach((h, i) => {
      if (/Total|Nominal|Sisa|Dibayar|Pemasukan/i.test(h)) {
        ws.getColumn(i + 1).numFmt = '"Rp" #,##0';
      }
    });
  } else {
    ws.getCell('A4').value = 'Tidak ada data untuk periode/filter yang dipilih.';
  }
  const fileName = `laporan-${req.params.type}-${todayISO()}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  await audit(req.user.id, req.user.fullName, 'EKSPOR_EXCEL', 'laporan', null, req.params.type, req.ip);
  await wb.xlsx.write(res);
  res.end();
}));

router.get('/:type/pdf', asyncHandler(async (req, res) => {
  const t = REPORT_TYPES[req.params.type];
  if (!t) throw notFound('Jenis laporan tidak dikenal.');
  const rows = await t.fn({ from: req.query.from || '', to: req.query.to || '' });
  const headers = rows.length ? Object.keys(rows[0]) : ['Keterangan'];
  const cols = headers.map((h) => ({ label: h, key: h, width: 1 }));
  const fileName = `laporan-${req.params.type}-${todayISO()}.pdf`;
  const key = `exports/${fileName}`;
  await buildTablePDF(t.title.toUpperCase(), `Periode: ${req.query.from || 'semua'} s.d. ${req.query.to || 'semua'} • Dibuat ${todayISO()}`,
    cols, rows.length ? rows : [{ Keterangan: 'Tidak ada data untuk filter ini.' }], key);
  await audit(req.user.id, req.user.fullName, 'EKSPOR_PDF', 'laporan', null, req.params.type, req.ip);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
  const s = await storage.stream(key);
  s.pipe(res);
}));

module.exports = router;
