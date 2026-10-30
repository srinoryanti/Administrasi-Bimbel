'use strict';
const path = require('path');
const PDFDocument = require('pdfkit');
const storage = require('./storage');
const { getSetting } = require('./db');

// Parameter terakhir build*PDF adalah storage key (mis. `reports/rapor-X.pdf`).
// Kompatibilitas: pemanggil lama (seed.js) mengirim path absolut di dalam server/uploads —
// normalkan menjadi key relatif agar lokal tetap menulis di lokasi yang sama.
const __dirname_ = typeof __dirname !== 'undefined' ? __dirname : '.';
const UPLOADS_DIR = path.join(__dirname_, '..', 'uploads');
function targetKey(target) {
  if (path.isAbsolute(target)) {
    const rel = path.relative(UPLOADS_DIR, target);
    if (rel && !rel.startsWith('..')) return rel.split(path.sep).join('/');
  }
  return target;
}

function collectToStorage(doc, key) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', async () => {
      try {
        await storage.put(key, Buffer.concat(chunks), 'application/pdf');
        resolve(key);
      } catch (e) {
        reject(e);
      }
    });
    doc.end();
  });
}

const NAVY = '#1e3a5f';
const LIGHT = '#e8eef5';
const GRAY = '#666666';

// Kop surat resmi (bisa diubah lewat pengaturan)
const KOP_DEFAULTS = {
  kop_badan: 'BADAN USAHA MILIK DESA',
  kop_unit: '"ABADI SEJAHTERA KLUMPIT"',
  kop_lembaga: 'BIMBINGAN BELAJAR RUMAH PINTAR',
  kop_email: 'bumdesa_abadisejahteraklumpit@gmail.com',
  kop_nomor: 'AHU-00166.AH.01.33.TAHUN 2024',
  kop_alamat: 'Jl. Santren – Grobog RT 01 RW 02 Ds. Klumpit  +6285 800 555 885 - +6289 618 729 772 - +6287 710 270 730',
  ttd_mengetahui: 'BUM Desa Abadi Sejahtera Klumpit',
  ttd_pj: 'NOR AFNAN, S.Pd.',
};
const kop = (k) => getSetting(k, KOP_DEFAULTS[k]);

function rupiah(n) {
  const v = Number(n || 0);
  return 'Rp ' + v.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function tgl(d) {
  if (!d) return '-';
  const s = String(d).slice(0, 10).split('-');
  return s.length === 3 ? `${s[2]}-${s[1]}-${s[0]}` : String(d);
}

function header(doc, title, subtitle) {
  doc.rect(0, 0, doc.page.width, 92).fill(NAVY);
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(18).text('BIMBEL RUMAH PINTAR', 40, 24);
  doc.font('Helvetica').fontSize(10).fill('#cfe0f2');
  doc.text('Sistem Informasi Manajemen Bimbel', 40, 48);
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(12).text(title, 40, 66);
  if (subtitle) doc.font('Helvetica').fontSize(9).fill('#cfe0f2').text(subtitle, 40, 80);
  doc.fill('#000000');
  doc.y = 112;
}

function footer(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // turunkan margin bawah sementara agar teks footer tidak memicu auto page break
    doc.page.margins.bottom = 8;
    doc.fontSize(8).fill(GRAY)
      .text(`Dicetak: ${tgl(new Date().toISOString().slice(0, 10))} • Bimbel Rumah Pintar • Halaman ${i - range.start + 1} dari ${range.count}`,
        40, doc.page.height - 34, { align: 'center', width: doc.page.width - 80 });
  }
}

function table(doc, columns, rows, opts = {}) {
  const startX = opts.x || 40;
  const startY = doc.y;
  const totalW = opts.width || doc.page.width - 80;
  const weights = columns.map((c) => c.width || 1);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / sumW) * totalW);
  const rowH = opts.rowHeight || 18;

  // header
  doc.rect(startX, startY, totalW, rowH).fill(NAVY);
  let x = startX;
  doc.fill('#ffffff').font('Helvetica-Bold').fontSize(8);
  columns.forEach((c, i) => {
    doc.text(c.label, x + 4, startY + 5, { width: widths[i] - 8, ellipsis: true, lineBreak: false });
    x += widths[i];
  });

  let y = startY + rowH;
  doc.fontSize(8);
  rows.forEach((r, ri) => {
    if (y + rowH > doc.page.height - 60) {
      doc.addPage();
      y = 40;
      doc.rect(startX, y, totalW, rowH).fill(NAVY);
      let hx = startX;
      doc.fill('#ffffff').font('Helvetica-Bold').fontSize(8);
      columns.forEach((c, i) => {
        doc.text(c.label, hx + 4, y + 5, { width: widths[i] - 8, ellipsis: true, lineBreak: false });
        hx += widths[i];
      });
      y += rowH;
    }
    if (ri % 2 === 0) doc.rect(startX, y, totalW, rowH).fill(LIGHT);
    doc.fill('#000000').font('Helvetica').fontSize(8);
    let cx = startX;
    columns.forEach((c, i) => {
      const val = typeof c.value === 'function' ? c.value(r) : r[c.key];
      doc.text(val === null || val === undefined || val === '' ? '-' : String(val), cx + 4, y + 5, {
        width: widths[i] - 8, ellipsis: true, lineBreak: false,
      });
      cx += widths[i];
    });
    y += rowH;
    doc.moveTo(startX, y).lineTo(startX + totalW, y).strokeColor('#d0d7e2').lineWidth(0.5).stroke();
  });
  doc.y = y + 12;
  doc.x = startX;
}

function kv(doc, pairs, startY) {
  let y = startY;
  doc.font('Helvetica').fontSize(9);
  for (const [k, v] of pairs) {
    doc.fill(GRAY).text(k + ':', 40, y, { width: 150 });
    doc.fill('#000000').text(v || '-', 200, y, { width: doc.page.width - 240 });
    y = doc.y + 2;
    if (y > doc.page.height - 60) { doc.addPage(); y = 40; }
  }
  return y + 8;
}

function sectionTitle(doc, text) {
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(11).fill(NAVY).text(text);
  doc.moveTo(40, doc.y + 2).lineTo(doc.page.width - 40, doc.y + 2).strokeColor(NAVY).lineWidth(1).stroke();
  doc.moveDown(0.5);
  doc.fill('#000000');
}

/* ========== Format Laporan Perkembangan Belajar (kop resmi) ========== */
const KATA = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan', 'Sepuluh', 'Sebelas', 'Dua Belas'];

function kelasLabel(g) {
  if (g === null || g === undefined || g === '') return '-';
  const s = String(g);
  const m = s.match(/^(\d+)$/) || s.match(/kelas\s*(\d+)/i);
  if (m) { const n = Number(m[1]); return `${n} (${KATA[n] || n})`; }
  return s;
}

function periodMeta(period) {
  const d = new Date(`${period.start_date || ''}T00:00:00`);
  const dt = isNaN(d) ? new Date() : d;
  const m = dt.getMonth() + 1;
  const y = dt.getFullYear();
  return {
    semester: m >= 7 ? 'I (SATU)' : 'II (DUA)',
    tahunAjaran: m >= 7 ? `${y}/${y + 1}` : `${y - 1}/${y}`,
  };
}

function drawKop(doc) {
  const W = doc.page.width;
  let y = 32;
  const center = (text, font, size, gap) => {
    doc.font(font).fontSize(size).fill('#000000').text(text, 40, y, { width: W - 80, align: 'center' });
    y = doc.y + gap;
  };
  center(kop('kop_badan'), 'Helvetica-Bold', 10, 1);
  center(kop('kop_unit'), 'Helvetica-Bold', 15, 1);
  center(kop('kop_lembaga'), 'Helvetica-Bold', 11, 4);
  center(`email : ${kop('kop_email')}`, 'Helvetica', 9, 1);
  center(`Nomor : ${kop('kop_nomor')}`, 'Helvetica', 9, 6);
  doc.moveTo(40, y).lineTo(W - 40, y).strokeColor('#000000').lineWidth(1.2).stroke();
  y += 5;
  doc.font('Helvetica').fontSize(8.5).fill('#000000').text(kop('kop_alamat'), 40, y, { width: W - 80, align: 'center' });
  y = doc.y + 5;
  doc.moveTo(40, y).lineTo(W - 40, y).strokeColor('#000000').lineWidth(1.2).stroke();
  doc.y = y + 16;
}

function secHead(doc, text) {
  if (doc.y + 44 > doc.page.height - 56) { doc.addPage(); doc.y = 40; }
  doc.font('Helvetica-Bold').fontSize(11).fill(NAVY).text(text, 40, doc.y, { width: doc.page.width - 80 });
  const yy = doc.y + 3;
  doc.moveTo(40, yy).lineTo(doc.page.width - 40, yy).strokeColor(NAVY).lineWidth(1).stroke();
  doc.y = yy + 9;
  doc.fill('#000000');
}

function reportTable(doc, columns, rows, opts = {}) {
  const x = opts.x || 40;
  const totalW = opts.width || doc.page.width - 80;
  const weights = columns.map((c) => c.width || 1);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / sumW) * totalW);
  const fs = opts.fontSize || 8;
  const pad = 4;
  const headerH = 16;
  let y = doc.y;

  const drawHeader = () => {
    doc.rect(x, y, totalW, headerH).fill(NAVY);
    let cx = x;
    doc.fill('#ffffff').font('Helvetica-Bold').fontSize(fs);
    columns.forEach((c, i) => {
      doc.text(c.label, cx + pad, y + 4, { width: widths[i] - 2 * pad, lineBreak: true });
      cx += widths[i];
    });
    doc.fill('#000000');
    y += headerH;
  };

  drawHeader();
  rows.forEach((r, ri) => {
    const vals = columns.map((c) => {
      const v = typeof c.value === 'function' ? c.value(r) : r[c.key];
      return v === null || v === undefined || v === '' ? '-' : String(v);
    });
    doc.font('Helvetica').fontSize(fs);
    const h = Math.max(...vals.map((v, i) => doc.heightOfString(v, { width: widths[i] - 2 * pad })), 12) + 7;
    if (y + h > doc.page.height - 56) {
      doc.addPage();
      y = 40;
      drawHeader();
      doc.font('Helvetica').fontSize(fs);
    }
    if (ri % 2 === 0) doc.rect(x, y, totalW, h).fill(LIGHT);
    doc.fill('#000000').font('Helvetica').fontSize(fs);
    let cx = x;
    vals.forEach((v, i) => {
      doc.text(v, cx + pad, y + 3, { width: widths[i] - 2 * pad, lineGap: 1 });
      cx += widths[i];
    });
    y += h;
    doc.moveTo(x, y).lineTo(x + totalW, y).strokeColor('#c8d2e0').lineWidth(0.5).stroke();
  });
  doc.y = y + 12;
  doc.x = x;
}

function idLine(doc, y, x, w, k, v) {
  doc.font('Helvetica-Bold').fontSize(9.5);
  const h1 = doc.heightOfString(k, { width: 84 });
  const txt = ` : ${v || '-'}`;
  doc.font('Helvetica').fontSize(9.5);
  const h2 = doc.heightOfString(txt, { width: w - 84 });
  doc.font('Helvetica-Bold').fill('#000000').text(k, x, y, { width: 84 });
  doc.font('Helvetica').text(txt, x + 84, y, { width: w - 84 });
  return Math.max(h1, h2);
}

function noteNarrative(data) {
  const L = [
    ['Materi yang sudah dikuasai', data.notes.mastered],
    ['Materi yang perlu ditingkatkan', data.notes.improve],
    ['Kesulitan yang dihadapi siswa', data.notes.difficulties],
    ['Perkembangan positif', data.notes.positive],
    ['Saran untuk pembelajaran selanjutnya', data.notes.suggestion],
    ['Catatan tambahan untuk orang tua', data.notes.parent],
  ].filter(([, v]) => v && String(v).trim());
  return L;
}

function signBlock(doc, data) {
  if (doc.y + 140 > doc.page.height - 56) { doc.addPage(); doc.y = 40; }
  const W = doc.page.width - 80;
  const colW = W / 2 - 16;
  const lx = 40;
  const rx = 40 + W / 2 + 16;
  const y0 = doc.y + 26;
  doc.font('Helvetica').fontSize(9.5).fill('#000000');
  doc.text('Mengetahui;', lx, y0, { width: colW });
  doc.text(kop('ttd_mengetahui'), lx, y0 + 16, { width: colW });
  doc.text('Tentor Pembimbing', rx, y0 + 16, { width: colW });
  const nameY = y0 + 74;
  doc.moveTo(lx + 20, nameY).lineTo(lx + colW - 20, nameY).strokeColor('#94a3b8').lineWidth(0.5).stroke();
  doc.moveTo(rx + 20, nameY).lineTo(rx + colW - 20, nameY).strokeColor('#94a3b8').lineWidth(0.5).stroke();
  doc.font('Helvetica-Bold').text(kop('ttd_pj'), lx, nameY + 6, { width: colW, align: 'center' });
  doc.font('Helvetica').text(data.tutorName || '-', rx, nameY + 6, { width: colW, align: 'center' });
  doc.y = nameY + 30;
}

function buildReportPDF(data, target) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
      const key = targetKey(target);
      const W = doc.page.width - 80;
      const meta = periodMeta(data.period);

      // 1. Kop surat resmi
      drawKop(doc);

      // Judul
      doc.font('Helvetica-Bold').fontSize(13).fill('#000000')
        .text('LAPORAN PERKEMBANGAN BELAJAR SISWA', 40, doc.y, { width: W, align: 'center' });
      const ty = doc.y + 3;
      doc.moveTo(40, ty).lineTo(doc.page.width - 40, ty).strokeColor('#000000').lineWidth(0.8).stroke();
      doc.y = ty + 5;
      doc.font('Helvetica').fontSize(9).fill(GRAY)
        .text(`Periode: ${data.period.name}`, 40, doc.y, { width: W, align: 'center' });
      doc.y += 8;

      // Identitas (2 kolom)
      const colW = W / 2 - 10;
      const colX = [40, 40 + W / 2 + 10];
      const idRows = [
        [['NAMA', data.student.fullName], ['KELAS', kelasLabel(data.student.schoolGrade)]],
        [['PROGRAM', data.student.program || data.className || '-'], ['SEMESTER', meta.semester]],
        [['SEKOLAH', data.student.schoolName || '-'], ['TAHUN AJARAN', meta.tahunAjaran]],
      ];
      let y = doc.y;
      for (const row of idRows) {
        let h = 0;
        row.forEach((cell, i) => { h = Math.max(h, idLine(doc, y, colX[i], colW, cell[0], cell[1])); });
        y += h + 7;
      }
      doc.y = y + 6;

      // 2. Hasil belajar akademik
      secHead(doc, 'HASIL BELAJAR AKADEMIK');
      reportTable(doc, [
        { label: 'Mata Pelajaran', key: 'subject', width: 22 },
        { label: 'Kondisi Awal Masuk', key: 'kondisi', width: 33 },
        { label: 'Ketercapaian', key: 'ketercapaian', width: 45 },
      ], data.grades.map((g) => ({
        subject: g.subject,
        kondisi: g.initialCondition || '-',
        ketercapaian: g.notes || (g.final != null ? `Nilai akhir ${g.final} dari 100.` : '-'),
      })), { fontSize: 8.5 });

      // 3. Penilaian non-akademik
      secHead(doc, 'PENILAIAN NON-AKADEMIK (SIKAP DAN KETERAMPILAN)');
      reportTable(doc, [
        { label: 'Aspek yang Dinilai', key: 'aspek', width: 30 },
        { label: 'Catatan', key: 'catatan', width: 70 },
      ], data.indicators.map((i) => {
        const label = i.score ? (data.scaleLabels[i.score - 1] || '-') : null;
        const catatan = label ? `${label}.${i.note ? ` ${i.note}` : ''}` : (i.note || '-');
        return { aspek: i.indicator, catatan };
      }), { fontSize: 8.5 });

      // 4. Rekap kehadiran
      secHead(doc, 'REKAP KEHADIRAN');
      const a = data.attendance;
      const tidakHadir = (a.izin || 0) + (a.sakit || 0) + (a.alpa || 0);
      reportTable(doc, [
        { label: 'Total Pertemuan', key: 'total', width: 2 },
        { label: 'Hadir', key: 'hadir', width: 1 },
        { label: 'Tidak Hadir', key: 'tidak', width: 1.4 },
        { label: 'Keterangan', key: 'ket', width: 4 },
      ], [{
        total: a.scheduled, hadir: a.hadir, tidak: tidakHadir,
        ket: tidakHadir === 0
          ? `Hadir ${a.percentage}% — tidak ada ketidakhadiran.`
          : `Hadir ${a.percentage}% • Izin ${a.izin || 0} • Sakit ${a.sakit || 0} • Alpa ${a.alpa || 0}`,
      }], { fontSize: 8.5 });

      // 5. Catatan tentor & rekomendasi
      secHead(doc, 'CATATAN TUTOR PENGAMPU DAN REKOMENDASI');
      const notes = noteNarrative(data);
      if (data.conclusion && data.conclusion.trim()) {
        doc.font('Helvetica').fontSize(9).fill('#000000')
          .text(data.conclusion, 40, doc.y, { width: W, align: 'justify', lineGap: 2 });
        doc.y += 4;
      }
      if (notes.length) {
        for (const [k, v] of notes) {
          if (doc.y + 30 > doc.page.height - 56) { doc.addPage(); doc.y = 40; }
          const ny = doc.y;
          doc.font('Helvetica-Bold').fontSize(8.5).fill('#000000').text(`${k}:`, 40, ny, { width: 164 });
          const h1 = doc.y - ny;
          doc.font('Helvetica').text(String(v), 208, ny, { width: doc.page.width - 40 - 208, lineGap: 1 });
          const h2 = doc.y - ny;
          doc.y = ny + Math.max(h1, h2) + 4;
        }
      }
      if ((!data.conclusion || !data.conclusion.trim()) && !notes.length) {
        doc.font('Helvetica').fontSize(9).fill(GRAY).text('(Belum diisi)', 40, doc.y, { width: W });
      }
      doc.fill('#000000');

      // 6. Tanda tangan
      signBlock(doc, data);

      footer(doc);
      collectToStorage(doc, key).then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

function buildReceiptPDF(p, target) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const key = targetKey(target);
    header(doc, 'KUITANSI PEMBAYARAN', `No. Transaksi: ${p.transactionNumber}`);
    doc.y = 120;
    kv(doc, [
      ['No. Transaksi', p.transactionNumber],
      ['No. Tagihan', p.invoiceNumber],
      ['Tanggal Pembayaran', tgl(p.paidAt)],
      ['Nama Siswa', `${p.studentName} (${p.nis})`],
      ['Program', p.program || '-'],
      ['Periode Tagihan', p.period],
      ['Metode Pembayaran', p.method],
      ['Nominal', rupiah(p.amount)],
      ['Terbilang', p.terbilang],
      ['Catatan', p.note || '-'],
      ['Dicatat oleh', p.recorder],
    ], doc.y);
    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(12).fill(NAVY).text(`Total Diterima: ${rupiah(p.amount)}`, 40, doc.y, { align: 'right' });
    doc.fill('#000000').font('Helvetica').fontSize(9);
    doc.moveDown(2);
    doc.text('Pembayaran yang telah dicatat tidak dapat dihapus tanpa prosedur koreksi resmi.', 40, doc.y, { italic: true });
    footer(doc);
    collectToStorage(doc, key).then(resolve, reject);
  });
}

function buildTablePDF(title, subtitle, columns, rows, target) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, layout: 'landscape' });
    const key = targetKey(target);
    header(doc, title, subtitle);
    doc.y = 112;
    table(doc, columns.map((c) => ({ label: c.label, key: c.key, width: c.width || 1 })), rows);
    footer(doc);
    collectToStorage(doc, key).then(resolve, reject);
  });
}

const ONES = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
function terbilang(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n < 12) return ONES[n] || 'nol';
  if (n < 20) return terbilang(n - 10) + ' belas';
  if (n < 100) return terbilang(Math.floor(n / 10)) + ' puluh ' + terbilang(n % 10);
  if (n < 200) return 'seratus ' + terbilang(n - 100);
  if (n < 1000) return terbilang(Math.floor(n / 100)) + ' ratus ' + terbilang(n % 100);
  if (n < 2000) return 'seribu ' + terbilang(n - 1000);
  if (n < 1e6) return terbilang(Math.floor(n / 1000)) + ' ribu ' + terbilang(n % 1000);
  if (n < 1e9) return terbilang(Math.floor(n / 1e6)) + ' juta ' + terbilang(n % 1e6);
  return terbilang(Math.floor(n / 1e9)) + ' miliar ' + terbilang(n % 1e9);
}

module.exports = { buildReportPDF, buildReceiptPDF, buildTablePDF, rupiah, tgl, terbilang };
