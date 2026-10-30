'use strict';
const express = require('express');
const storage = require('../storage');
const { db, audit, nextNumber, todayISO, nowJakarta } = require('../db');
const { requireAuth, requireRole, isTutor } = require('../middleware/auth');
const { asyncHandler, badRequest, notFound } = require('../middleware/helpers');
const { buildReceiptPDF, terbilang } = require('../pdf');

const router = express.Router();
router.use(requireAuth);

async function refreshInvoiceStatus(invoiceId) {
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv || inv.status === 'batal') return inv;
  const paidSum = (await db.prepare(
    `SELECT COALESCE(SUM(pa.amount),0) AS n FROM payment_allocations pa
     JOIN payments p ON p.id = pa.payment_id WHERE pa.invoice_id = ? AND p.status = 'posted'`
  ).get(invoiceId)).n;
  let status = 'belum';
  if (paidSum <= 0) status = inv.due_date && inv.due_date < todayISO() ? 'belum' : 'belum';
  else if (paidSum >= inv.total) status = 'lunas';
  else status = 'sebagian';
  if (inv.due_date && inv.due_date < todayISO() && status !== 'lunas') status = 'jatuh_tempo';
  await db.prepare('UPDATE invoices SET paid = ?, status = ?, updated_at = datetime(\'now\',\'+7 hours\') WHERE id = ?')
    .run(paidSum, status, invoiceId);
  return await db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
}

function mapInvoice(r) {
  return {
    id: r.id, invoiceNumber: r.invoice_number, studentId: r.student_id, studentName: r.student_name, nis: r.nis,
    program: r.program, period: r.period, invoiceDate: r.invoice_date, dueDate: r.due_date,
    amount: r.amount, discount: r.discount, total: r.total, paid: r.paid, remaining: Math.max(0, r.total - r.paid),
    status: r.status, note: r.note, isDemo: !!r.is_demo,
  };
}

// ===== Tagihan =====
router.get('/invoices', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const { search = '', status = '', period = '', studentId = '', from = '', to = '' } = req.query;
  const params = [];
  const where = [];
  if (search) { where.push('(s.full_name LIKE ? OR i.invoice_number LIKE ? OR s.nis LIKE ?)'); const s = `%${search}%`; params.push(s, s, s); }
  if (status) { where.push('i.status = ?'); params.push(status); }
  if (period) { where.push('i.period = ?'); params.push(period); }
  if (studentId) { where.push('i.student_id = ?'); params.push(Number(studentId)); }
  if (from) { where.push('i.invoice_date >= ?'); params.push(from); }
  if (to) { where.push('i.invoice_date <= ?'); params.push(to); }
  const rows = await db.prepare(
    `SELECT i.*, s.full_name AS student_name, s.nis FROM invoices i JOIN students s ON s.id = i.student_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.id DESC LIMIT 800`
  ).all(...params);
  res.json({ data: rows.map(mapInvoice) });
}));

router.get('/invoices/:id', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const r = await db.prepare(
    `SELECT i.*, s.full_name AS student_name, s.nis FROM invoices i JOIN students s ON s.id = i.student_id WHERE i.id = ?`
  ).get(id);
  if (!r) return res.status(404).json({ error: 'Tagihan tidak ditemukan.' });
  const items = await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(id);
  const pays = await db.prepare(
    `SELECT p.*, u.full_name AS recorder FROM payments p LEFT JOIN users u ON u.id = p.recorded_by
     WHERE p.invoice_id = ? AND p.status='posted' ORDER BY p.paid_at DESC`
  ).all(id);
  res.json({ data: { ...mapInvoice(r), items, payments: pays } });
}));

router.post('/invoices', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.studentId || !b.period || !b.invoiceDate) throw badRequest('Siswa, periode, dan tanggal tagihan wajib diisi.');
  const student = await db.prepare('SELECT * FROM students WHERE id = ?').get(Number(b.studentId));
  if (!student) throw notFound('Siswa tidak ditemukan.');
  const items = Array.isArray(b.items) && b.items.length ? b.items : [{ description: `Biaya bimbel ${b.program || student.program || ''} periode ${b.period}`, qty: 1, price: b.amount || 0 }];
  const amount = items.reduce((a, it) => a + Number(it.qty || 1) * Number(it.price || 0), 0);
  const discount = Number(b.discount || 0);
  const total = amount - discount;
  if (total < 0) throw badRequest('Diskon melebihi jumlah tagihan.');
  const invoiceNumber = await nextNumber(db, 'INV', 'invoices', 'invoice_number');
  const info = await db.prepare(
    `INSERT INTO invoices (invoice_number, student_id, program, period, invoice_date, due_date, amount, discount, total, status, note, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,'belum',?,?)`
  ).run(invoiceNumber, student.id, b.program || student.program || null, b.period, b.invoiceDate, b.dueDate || null, amount, discount, total, b.note || null, req.user.id);
  const invId = Number(info.lastInsertRowid);
  for (const it of items) {
    const qty = Number(it.qty || 1), price = Number(it.price || 0);
    await db.prepare('INSERT INTO invoice_items (invoice_id, description, qty, price, subtotal) VALUES (?,?,?,?,?)')
      .run(invId, it.description || 'Biaya bimbel', qty, price, qty * price);
  }
  await audit(req.user.id, req.user.fullName, 'BUAT_TAGIHAN', 'invoices', invId, { invoiceNumber, siswa: student.full_name, total }, req.ip);
  res.status(201).json({ message: 'Tagihan dibuat.', id: invId, invoiceNumber });
}));

router.put('/invoices/:id', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!inv) throw notFound('Tagihan tidak ditemukan.');
  if (inv.paid > 0) throw badRequest('Tagihan yang sudah menerima pembayaran tidak dapat diubah. Buat nota koreksi bila perlu.');
  const b = req.body || {};
  const amount = b.amount ?? inv.amount, discount = b.discount ?? inv.discount;
  await db.prepare(
    `UPDATE invoices SET program=?, period=?, invoice_date=?, due_date=?, amount=?, discount=?, total=?, note=?,
      updated_at=datetime('now','+7 hours') WHERE id=?`
  ).run(b.program ?? inv.program, b.period ?? inv.period, b.invoiceDate ?? inv.invoice_date, b.dueDate ?? inv.due_date,
    amount, discount, amount - discount, b.note ?? inv.note, id);
  await audit(req.user.id, req.user.fullName, 'UBAH_TAGIHAN', 'invoices', id, null, req.ip);
  res.json({ message: 'Tagihan diperbarui.' });
}));

router.delete('/invoices/:id', requireRole('direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
  if (!inv) throw notFound('Tagihan tidak ditemukan.');
  if (inv.paid > 0) throw badRequest('Tagihan dengan riwayat pembayaran tidak dapat dihapus. Batalkan statusnya sebagai gantinya.');
  await db.prepare(`UPDATE invoices SET status='batal', updated_at=datetime('now','+7 hours') WHERE id=?`).run(id);
  await audit(req.user.id, req.user.fullName, 'BATALKAN_TAGIHAN', 'invoices', id, inv.invoice_number, req.ip);
  res.json({ message: 'Tagihan dibatalkan.' });
}));

// ===== Pembayaran =====
router.get('/payments', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const { search = '', method = '', from = '', to = '', status = '' } = req.query;
  const params = [];
  const where = [];
  if (search) { where.push('(s.full_name LIKE ? OR p.transaction_number LIKE ? OR i.invoice_number LIKE ?)'); const s = `%${search}%`; params.push(s, s, s); }
  if (method) { where.push('p.method = ?'); params.push(method); }
  if (from) { where.push('p.paid_at >= ?'); params.push(from); }
  if (to) { where.push('p.paid_at <= ?'); params.push(to); }
  if (status) { where.push('p.status = ?'); params.push(status); }
  const rows = await db.prepare(
    `SELECT p.*, s.full_name AS student_name, s.nis, i.invoice_number, u.full_name AS recorder
     FROM payments p JOIN students s ON s.id = p.student_id
     LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN users u ON u.id = p.recorded_by
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC LIMIT 800`
  ).all(...params);
  res.json({ data: rows });
}));

router.post('/payments', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.invoiceId || !b.amount || !b.paidAt || !b.method) throw badRequest('Tagihan, nominal, tanggal, dan metode wajib diisi.');
  const amount = Number(b.amount);
  if (amount <= 0) throw badRequest('Nominal pembayaran harus lebih dari nol.');
  const inv = await db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(b.invoiceId));
  if (!inv) throw notFound('Tagihan tidak ditemukan.');
  if (inv.status === 'batal') throw badRequest('Tagihan berstatus batal.');
  if (inv.status === 'lunas') throw badRequest('Tagihan sudah lunas.');
  if (amount > inv.total - inv.paid + 0.5) throw badRequest(`Nominal melebihi sisa tagihan (sisa Rp ${Math.max(0, inv.total - inv.paid).toLocaleString('id-ID')}).`);

  // Atomik: db.batch menjalankan seluruh statement dalam satu transaksi.
  // nextNumber tidak termasuk batch agar pembacaan nomor urut tetap konsisten.
  const transactionNumber = await nextNumber(db, 'BYR', 'payments', 'transaction_number');
  const [payResult] = await db.batch([
    {
      sql: `INSERT INTO payments (transaction_number, invoice_id, student_id, amount, method, paid_at, note, recorded_by)
            VALUES (?,?,?,?,?,?,?,?)`,
      params: [transactionNumber, inv.id, inv.student_id, amount, b.method, b.paidAt, b.note || null, req.user.id],
    },
  ]);
  const payId = Number(payResult.lastInsertRowid);
  await db.prepare('INSERT INTO payment_allocations (payment_id, invoice_id, amount) VALUES (?,?,?)').run(payId, inv.id, amount);
  await refreshInvoiceStatus(inv.id);
  await audit(req.user.id, req.user.fullName, 'CATAT_PEMBAYARAN', 'payments', payId, { transaksi: transactionNumber, nominal: amount, tagihan: inv.invoice_number }, req.ip);
  res.status(201).json({ message: `Pembayaran ${transactionNumber} tercatat. Sisa tagihan diperbarui otomatis.`, id: payId, transactionNumber });
}));

// Pembatalan pembayaran hanya direktur, dengan alasan — tidak menghapus data.
router.post('/payments/:id/cancel', requireRole('direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const p = await db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
  if (!p) throw notFound('Pembayaran tidak ditemukan.');
  if (p.status === 'dibatalkan') throw badRequest('Pembayaran sudah dibatalkan.');
  const reason = (req.body && req.body.reason) || '';
  if (!reason) throw badRequest('Pembatalan wajib disertai alasan (dicatat dalam audit log).');
  await db.prepare(`UPDATE payments SET status='dibatalkan', note = COALESCE(note,'') || ' || DIBATALKAN: ' || ? WHERE id=?`).run(reason, id);
  if (p.invoice_id) await refreshInvoiceStatus(p.invoice_id);
  await audit(req.user.id, req.user.fullName, 'BATALKAN_PEMBAYARAN', 'payments', id, { transaksi: p.transaction_number, alasan: reason }, req.ip);
  res.json({ message: 'Pembayaran dibatalkan dan saldo tagihan dihitung ulang. Riwayat transaksi tetap tersimpan.' });
}));

router.get('/payments/:id/receipt', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const p = await db.prepare(
    `SELECT p.*, s.full_name AS student_name, s.nis, i.invoice_number, i.program, i.period, u.full_name AS recorder
     FROM payments p JOIN students s ON s.id = p.student_id
     LEFT JOIN invoices i ON i.id = p.invoice_id LEFT JOIN users u ON u.id = p.recorded_by WHERE p.id = ?`
  ).get(id);
  if (!p) throw notFound('Pembayaran tidak ditemukan.');
  const fileName = `kuitansi-${p.transaction_number}.pdf`;
  const key = `receipts/${fileName}`;
  if (!(await storage.exists(key))) {
    await buildReceiptPDF({
      transactionNumber: p.transaction_number, invoiceNumber: p.invoice_number || '-',
      paidAt: p.paid_at, studentName: p.student_name, nis: p.nis, program: p.program,
      period: p.period || '-', method: p.method, amount: p.amount, note: p.note,
      recorder: p.recorder || '-', terbilang: terbilang(p.amount).replace(/^./, (c) => c.toUpperCase()) + ' rupiah',
    }, key);
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
  const s = await storage.stream(key);
  s.pipe(res);
}));

// ===== Ringkasan keuangan =====
router.get('/summary', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const { from = '', to = '' } = req.query;
  const params = [];
  const conds = ["p.status='posted'"];
  if (from) { conds.push('p.paid_at >= ?'); params.push(from); }
  if (to) { conds.push('p.paid_at <= ?'); params.push(to); }
  const w = 'WHERE ' + conds.join(' AND ');
  const income = await db.prepare(
    `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS n FROM payments p ${w}`
  ).get(...params);
  const byMethod = await db.prepare(
    `SELECT method, SUM(amount) AS total FROM payments p ${w} GROUP BY method`
  ).all(...params);
  const outstanding = await db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total - paid),0) AS total FROM invoices WHERE status IN ('belum','sebagian','jatuh_tempo')`
  ).get();
  const overdue = await db.prepare(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total - paid),0) AS total FROM invoices WHERE status='jatuh_tempo'`
  ).get();
  res.json({
    data: {
      totalIncome: income.total, paymentCount: income.n, byMethod,
      outstandingCount: outstanding.n, outstandingTotal: outstanding.total,
      overdueCount: overdue.n, overdueTotal: overdue.total,
    },
  });
}));

router.get('/income-monthly', requireRole('sekretaris', 'direktur'), asyncHandler(async (req, res) => {
  const rows = await db.prepare(
    `SELECT substr(paid_at,1,7) AS month, SUM(amount) AS total FROM payments WHERE status='posted'
     GROUP BY month ORDER BY month DESC LIMIT 12`
  ).all();
  res.json({ data: rows.reverse() });
}));

module.exports = router;
