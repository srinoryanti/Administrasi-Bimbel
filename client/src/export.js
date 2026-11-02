import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';

const NAVY = [30, 58, 95];
const LIGHT = [232, 238, 245];
const GRAY = [102, 102, 102];

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

async function loadKop() {
  try {
    const res = await fetch('/api/catalog/settings', { credentials: 'include' });
    if (res.ok) {
      const d = await res.json();
      return { ...KOP_DEFAULTS, ...(d.data || d) };
    }
  } catch (e) { /* fallback defaults */ }
  return KOP_DEFAULTS;
}

function todayStr() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })).toISOString().slice(0, 10);
}

function tgl(d) {
  if (!d) return '-';
  const s = String(d).slice(0, 10).split('-');
  return s.length === 3 ? `${s[2]}-${s[1]}-${s[0]}` : String(d);
}

function rupiahFmt(n) {
  const v = Number(n || 0);
  return 'Rp ' + v.toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

function headerBlock(doc, title, subtitle) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, W, 32, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('BIMBEL RUMAH PINTAR', 14, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(207, 224, 242);
  doc.text('Sistem Informasi Manajemen Bimbel', 14, 17);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text(title, 14, 24);
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(207, 224, 242);
    doc.text(subtitle, 14, 29);
  }
  doc.setTextColor(0, 0, 0);
}

function footerBlock(doc) {
  const pageCount = doc.internal.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(`Dicetak: ${tgl(todayStr())} • Bimbel Rumah Pintar • Halaman ${i} dari ${pageCount}`, W / 2, H - 8, { align: 'center' });
  }
  doc.setTextColor(0, 0, 0);
}

// ================= EXCEL =================
export function exportExcel(title, subtitle, rows) {
  const wb = XLSX.utils.book_new();
  const headers = rows.length ? Object.keys(rows[0]) : ['Keterangan'];
  const aoa = [
    [`BIMBEL RUMAH PINTAR — ${title.toUpperCase()}`],
    [subtitle],
    [],
    headers,
    ...rows.map((r) => headers.map((h) => r[h])),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(14, Math.min(40, h.length + 8)) }));
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
  XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 31));
  XLSX.writeFile(wb, `laporan-${title.toLowerCase().replace(/\s+/g, '-')}-${todayStr()}.xlsx`);
}

// ================= TABLE PDF (Laporan umum) =================
export async function exportTablePdf(typeKey, title, subtitle, rows) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const headers = rows.length ? Object.keys(rows[0]) : ['Keterangan'];
  headerBlock(doc, title.toUpperCase(), subtitle);
  const body = rows.length
    ? rows.map((r) => headers.map((h) => (r[h] === null || r[h] === undefined || r[h] === '' ? '-' : String(r[h]))))
    : [['Tidak ada data untuk filter ini.']];
  autoTable(doc, {
    startY: 40,
    head: [headers],
    body,
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: NAVY, textColor: 255 },
    alternateRowStyles: { fillColor: LIGHT },
    margin: { left: 14, right: 14 },
  });
  footerBlock(doc);
  doc.save(`laporan-${typeKey}-${todayStr()}.pdf`);
}

// ================= RAPOR PDF =================
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

export async function exportRaporPdf(payload, { save = true } = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const kop = await loadKop();
  const W = doc.internal.pageSize.getWidth();
  const pageW = W - 28; // margin 14 each side

  // Kop surat
  let y = 14;
  const center = (text, style, size, gap) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(0, 0, 0);
    doc.text(text, 14, y, { maxWidth: pageW, align: 'center' });
    y += gap;
  };
  center(kop.kop_badan, 'bold', 10, 5);
  center(kop.kop_unit, 'bold', 15, 5);
  center(kop.kop_lembaga, 'bold', 11, 6);
  center(`email : ${kop.kop_email}`, 'normal', 9, 5);
  center(`Nomor : ${kop.kop_nomor}`, 'normal', 9, 8);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.5);
  doc.line(14, y, W - 14, y);
  y += 3;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(kop.kop_alamat, 14, y, { maxWidth: pageW, align: 'center' });
  y += doc.splitTextToSize(kop.kop_alamat, pageW).length * 4 + 3;
  doc.line(14, y, W - 14, y);
  y += 8;

  // Judul
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('LAPORAN PERKEMBANGAN BELAJAR SISWA', W / 2, y, { align: 'center', maxWidth: pageW });
  y += 2;
  doc.line(14, y, W - 14, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GRAY);
  doc.text(`Periode: ${payload.period.name}`, W / 2, y, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 6;

  const meta = periodMeta(payload.period);
  const colW = pageW / 2 - 4;
  const idRows = [
    [['NAMA', payload.student.fullName], ['KELAS', kelasLabel(payload.student.schoolGrade)]],
    [['PROGRAM', payload.student.program || payload.className || '-'], ['SEMESTER', meta.semester]],
    [['SEKOLAH', payload.student.schoolName || '-'], ['TAHUN AJARAN', meta.tahunAjaran]],
  ];
  for (const row of idRows) {
    let maxH = 5;
    row.forEach((cell, i) => {
      const x = 14 + i * (colW + 8);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9.5);
      doc.text(cell[0], x, y, { maxWidth: 30 });
      doc.setFont('helvetica', 'normal');
      const valLines = doc.splitTextToSize(`: ${cell[1] || '-'}`, colW - 30);
      doc.text(valLines, x + 30, y);
      maxH = Math.max(maxH, valLines.length * 4.5);
    });
    y += maxH + 2;
  }
  y += 3;

  // 2. Hasil belajar akademik
  const secHead = (text) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...NAVY);
    doc.text(text, 14, y);
    y += 1.5;
    doc.setDrawColor(...NAVY);
    doc.line(14, y, W - 14, y);
    y += 5;
    doc.setTextColor(0, 0, 0);
  };
  secHead('HASIL BELAJAR AKADEMIK');
  autoTable(doc, {
    startY: y,
    head: [['Mata Pelajaran', 'Kondisi Awal Masuk', 'Ketercapaian']],
    body: payload.grades.map((g) => [
      g.subject,
      g.initialCondition || '-',
      g.notes || (g.final != null ? `Nilai akhir ${g.final} dari 100.` : '-'),
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: NAVY, textColor: 255 },
    alternateRowStyles: { fillColor: LIGHT },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 6;

  secHead('PENILAIAN NON-AKADEMIK (SIKAP DAN KETERAMPILAN)');
  autoTable(doc, {
    startY: y,
    head: [['Aspek yang Dinilai', 'Catatan']],
    body: payload.indicators.map((i) => {
      const label = i.score ? (payload.scaleLabels[i.score - 1] || '-') : null;
      const catatan = label ? `${label}.${i.note ? ` ${i.note}` : ''}` : (i.note || '-');
      return [i.indicator, catatan];
    }),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: NAVY, textColor: 255 },
    alternateRowStyles: { fillColor: LIGHT },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 6;

  secHead('REKAP KEHADIRAN');
  const a = payload.attendance;
  const tidakHadir = (a.izin || 0) + (a.sakit || 0) + (a.alpa || 0);
  autoTable(doc, {
    startY: y,
    head: [['Total Pertemuan', 'Hadir', 'Tidak Hadir', 'Keterangan']],
    body: [[
      a.scheduled, a.hadir, tidakHadir,
      tidakHadir === 0
        ? `Hadir ${a.percentage}% — tidak ada ketidakhadiran.`
        : `Hadir ${a.percentage}% • Izin ${a.izin || 0} • Sakit ${a.sakit || 0} • Alpa ${a.alpa || 0}`,
    ]],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: NAVY, textColor: 255 },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 6;

  secHead('CATATAN TUTOR PENGAMPU DAN REKOMENDASI');
  if (payload.conclusion && payload.conclusion.trim()) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(payload.conclusion, 14, y, { maxWidth: pageW });
    y += doc.splitTextToSize(payload.conclusion, pageW).length * 4.5 + 2;
  }
  const notePairs = [
    ['Materi yang sudah dikuasai', payload.notes.mastered],
    ['Materi yang perlu ditingkatkan', payload.notes.improve],
    ['Kesulitan yang dihadapi siswa', payload.notes.difficulties],
    ['Perkembangan positif', payload.notes.positive],
    ['Saran untuk pembelajaran selanjutnya', payload.notes.suggestion],
    ['Catatan tambahan untuk orang tua', payload.notes.parent],
  ].filter(([, v]) => v && String(v).trim());
  if (notePairs.length) {
    for (const [k, v] of notePairs) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text(`${k}:`, 14, y, { maxWidth: 55 });
      doc.setFont('helvetica', 'normal');
      const vLines = doc.splitTextToSize(String(v), pageW - 60);
      doc.text(vLines, 70, y);
      y += Math.max(5, vLines.length * 4) + 1.5;
    }
  }
  if ((!payload.conclusion || !payload.conclusion.trim()) && !notePairs.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text('(Belum diisi)', 14, y);
    doc.setTextColor(0, 0, 0);
  }
  y += 12;

  // Tanda tangan
  const colSign = pageW / 2 - 8;
  const lx = 14, rx = 14 + pageW / 2 + 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Mengetahui;', lx, y, { maxWidth: colSign });
  doc.text(kop.ttd_mengetahui, lx, y + 6, { maxWidth: colSign });
  doc.text('Tentor Pembimbing', rx, y + 6, { maxWidth: colSign });
  const nameY = y + 28;
  doc.setDrawColor(148, 163, 184);
  doc.line(lx + 8, nameY, lx + colSign - 8, nameY);
  doc.line(rx + 8, nameY, rx + colSign - 8, nameY);
  doc.setFont('helvetica', 'bold');
  doc.text(kop.ttd_pj, lx + colSign / 2, nameY + 3, { align: 'center', maxWidth: colSign });
  doc.setFont('helvetica', 'normal');
  doc.text(payload.tutorName || '-', rx + colSign / 2, nameY + 3, { align: 'center', maxWidth: colSign });

  footerBlock(doc);
  const filename = `rapor-${payload.reportCode}-${payload.student.nis}.pdf`;
  if (save) { doc.save(filename); return null; }
  return doc.output('blob');
}

// ================= KUITANSI PDF =================
export async function exportKuitansiPdf(p) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  headerBlock(doc, 'KUITANSI PEMBAYARAN', `No. Transaksi: ${p.transactionNumber}`);
  let y = 46;
  const pairs = [
    ['No. Transaksi', p.transactionNumber],
    ['No. Tagihan', p.invoiceNumber],
    ['Tanggal Pembayaran', tgl(p.paidAt)],
    ['Nama Siswa', `${p.studentName} (${p.nis})`],
    ['Program', p.program || '-'],
    ['Periode Tagihan', p.period],
    ['Metode Pembayaran', p.method],
    ['Nominal', rupiahFmt(p.amount)],
    ['Terbilang', p.terbilang],
    ['Catatan', p.note || '-'],
    ['Dicatat oleh', p.recorder],
  ];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  for (const [k, v] of pairs) {
    doc.setTextColor(...GRAY);
    doc.text(`${k}:`, 14, y, { maxWidth: 50 });
    doc.setTextColor(0, 0, 0);
    doc.text(v || '-', 64, y, { maxWidth: W - 80 });
    y += 6;
  }
  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...NAVY);
  doc.text(`Total Diterima: ${rupiahFmt(p.amount)}`, W - 14, y, { align: 'right' });
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  y += 10;
  doc.text('Pembayaran yang telah dicatat tidak dapat dihapus tanpa prosedur koreksi resmi.', 14, y);
  footerBlock(doc);
  doc.save(`kuitansi-${p.transactionNumber}.pdf`);
}

// ================= UTIL lain =================
const ONES = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
export function terbilang(n) {
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

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
