import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../auth';
import { get, post } from '../api';
import { PageHead, Tabs, Table, Modal, Field, Input, Select, Textarea, Badge, useToast, Spinner } from '../ui';
import { tgl, rupiah, today } from '../format';

const emptyInv = { studentId: '', program: '', period: '', invoiceDate: today(), dueDate: '', discount: 0, note: '', items: [{ description: '', qty: 1, price: 0 }] };
const emptyPay = { invoiceId: '', amount: '', paidAt: today(), method: 'Tunai', note: '' };

export default function Billing() {
  const toast = useToast();
  const [tab, setTab] = useState('tagihan');
  const [inv, setInv] = useState([]);
  const [pay, setPay] = useState([]);
  const [summary, setSummary] = useState(null);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ search: '', status: '', period: '' });
  const [invForm, setInvForm] = useState(null);
  const [payForm, setPayForm] = useState(null);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const { user } = useAuth();

  const load = useCallback(() => {
    setLoading(true);
    const qi = new URLSearchParams();
    if (f.search) qi.set('search', f.search);
    if (f.status) qi.set('status', f.status);
    if (f.period) qi.set('period', f.period);
    const qp = new URLSearchParams();
    if (f.search) qp.set('search', f.search);
    Promise.all([
      get(`/billing/invoices?${qi}`),
      get(`/billing/payments?${qp}`),
      get('/billing/summary'),
      get('/students?status=aktif').catch(() => ({ data: [] })),
    ]).then(([i, p, s, st]) => { setInv(i.data); setPay(p.data); setSummary(s.data); setStudents(st.data); })
      .catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [f]);
  useEffect(() => { load(); }, [load]);

  const periods = [...new Set(inv.map((i) => i.period))].sort().reverse();

  const saveInv = async () => {
    const d = invForm;
    if (!d.studentId || !d.period || !d.invoiceDate) return toast.error('Siswa, periode, dan tanggal tagihan wajib diisi.');
    if (Number(d.amount) <= 0) return toast.error('Nominal tagihan harus lebih dari nol.');
    setBusy(true);
    try {
      const r = await post('/billing/invoices', {
        studentId: Number(d.studentId), program: d.program, period: d.period, invoiceDate: d.invoiceDate,
        dueDate: d.dueDate, discount: Number(d.discount || 0), note: d.note,
        items: [{ description: d.description || `Biaya bimbel ${d.program || ''} periode ${d.period}`, qty: 1, price: Number(d.amount) }],
      });
      toast.success(r.message);
      setInvForm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const savePay = async () => {
    const d = payForm;
    if (!d.invoiceId) return toast.error('Pilih tagihan.');
    if (Number(d.amount) <= 0) return toast.error('Nominal pembayaran harus lebih dari nol.');
    setBusy(true);
    try {
      const r = await post('/billing/payments', {
        invoiceId: Number(d.invoiceId), amount: Number(d.amount), paidAt: d.paidAt, method: d.method, note: d.note,
      });
      toast.success(r.message);
      setPayForm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const doCancelPay = async () => {
    setBusy(true);
    try {
      const r = await post(`/billing/payments/${confirm.id}/cancel`, { reason: confirm.reason });
      toast.success(r.message);
      setConfirm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const openDetail = async (r) => {
    try {
      const d = await get(`/billing/invoices/${r.id}`);
      setDetail(d.data);
    } catch (e) { toast.error(e.message); }
  };

  const quickPay = (inv) => {
    const sisa = Math.max(0, inv.total - inv.paid);
    setPayForm({ ...emptyPay, invoiceId: inv.id, amount: sisa });
  };

  return (
    <div>
      <PageHead title="Tagihan & Pembayaran" desc="Pencatatan pembayaran tunai/transfer/QRIS (manual — bukan payment gateway)"
        actions={<>
          <button className="btn-outline" onClick={() => setPayForm({ ...emptyPay })}>+ Catat Pembayaran</button>
          <button className="btn-primary" onClick={() => setInvForm({ ...emptyInv })}>+ Buat Tagihan</button>
        </>} />

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
          <div className="card p-4"><div className="text-[11px] text-slate-400 font-bold uppercase">Total Pemasukan</div>
            <div className="text-xl font-bold text-emerald-600">{rupiah(summary.totalIncome)}</div>
            <div className="text-[11px] text-slate-400">{summary.paymentCount} transaksi</div></div>
          <div className="card p-4"><div className="text-[11px] text-slate-400 font-bold uppercase">Belum Lunas</div>
            <div className="text-xl font-bold text-amber-600">{rupiah(summary.outstandingTotal)}</div>
            <div className="text-[11px] text-slate-400">{summary.outstandingCount} tagihan</div></div>
          <div className="card p-4"><div className="text-[11px] text-slate-400 font-bold uppercase">Tunggakan (Jatuh Tempo)</div>
            <div className="text-xl font-bold text-red-600">{rupiah(summary.overdueTotal)}</div>
            <div className="text-[11px] text-slate-400">{summary.overdueCount} tagihan</div></div>
          <div className="card p-4"><div className="text-[11px] text-slate-400 font-bold uppercase">Per Metode</div>
            <div className="text-[11px] text-slate-600 mt-1 space-y-0.5">
              {(summary.byMethod || []).map((m) => <div key={m.method} className="flex justify-between"><span>{m.method}</span><b>{rupiah(m.total)}</b></div>)}
              {(!summary.byMethod || !summary.byMethod.length) && <span>Belum ada pembayaran</span>}
            </div></div>
        </div>
      )}

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'tagihan', label: 'Tagihan', count: inv.length },
        { key: 'pembayaran', label: 'Pembayaran', count: pay.length },
      ]} />

      <div className="card p-4 mb-4 grid sm:grid-cols-4 gap-3">
        <Input placeholder="Cari nama siswa / nomor..." value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        {tab === 'tagihan' ? (
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">Semua Status</option>
            <option value="belum">Belum dibayar</option><option value="sebagian">Dibayar sebagian</option>
            <option value="lunas">Lunas</option><option value="jatuh_tempo">Jatuh tempo</option><option value="batal">Batal</option>
          </Select>
        ) : <Select value="" onChange={() => {}}><option>Semua metode</option></Select>}
        <Select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>
          <option value="">Semua Periode</option>
          {periods.map((p) => <option key={p}>{p}</option>)}
        </Select>
        <button className="btn-outline" onClick={() => setF({ search: '', status: '', period: '' })}>Reset</button>
      </div>

      <div className="card p-4">
        {tab === 'tagihan' ? (
          <Table loading={loading} rows={inv} empty="Belum ada tagihan."
            onRowClick={openDetail}
            columns={[
              { label: 'No. Tagihan', render: (r) => <span className="font-mono text-xs">{r.invoiceNumber}</span> },
              { label: 'Siswa', render: (r) => <div><div className="font-semibold text-navy">{r.studentName}</div><div className="text-[11px] text-slate-400">{r.nis} • {r.period}</div></div> },
              { label: 'Jatuh Tempo', render: (r) => tgl(r.dueDate) },
              { label: 'Total', render: (r) => <b>{rupiah(r.total)}</b> },
              { label: 'Dibayar', render: (r) => rupiah(r.paid) },
              { label: 'Sisa', render: (r) => <b className={r.remaining > 0 ? 'text-red-600' : 'text-emerald-600'}>{rupiah(r.remaining)}</b> },
              { label: 'Status', render: (r) => <Badge status={r.status} /> },
              { label: 'Aksi', center: true, render: (r) => (
                <div className="flex gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
                  {r.status !== 'lunas' && r.status !== 'batal' && <button className="btn-primary btn-sm" onClick={() => quickPay(r)}>Bayar</button>}
                  <button className="btn-outline btn-sm" onClick={() => openDetail(r)}>Detail</button>
                </div>
              )},
            ]} />
        ) : (
          <Table loading={loading} rows={pay} empty="Belum ada pembayaran tercatat."
            columns={[
              { label: 'No. Transaksi', render: (r) => <span className="font-mono text-xs">{r.transaction_number}</span> },
              { label: 'Tanggal', render: (r) => tgl(r.paid_at) },
              { label: 'Siswa', render: (r) => <div><div className="font-semibold">{r.student_name}</div><div className="text-[11px] text-slate-400">{r.invoice_number || '-'}</div></div> },
              { label: 'Nominal', render: (r) => <b className="text-emerald-600">{rupiah(r.amount)}</b> },
              { label: 'Metode', key: 'method' },
              { label: 'Petugas', render: (r) => <span className="text-xs">{r.recorder || '-'}</span> },
              { label: 'Status', render: (r) => <Badge status={r.status === 'posted' ? 'aktif' : 'batal'} children={r.status === 'posted' ? 'Tercatat' : 'Dibatalkan'} /> },
              { label: 'Aksi', center: true, render: (r) => (
                <div className="flex gap-1 justify-center">
                  <a className="btn-outline btn-sm" href={`/api/billing/payments/${r.id}/receipt`} target="_blank" rel="noreferrer">Kuitansi</a>
                  {r.status === 'posted' && user.role === 'direktur' && (
                    <button className="btn-outline btn-sm !text-red-600" onClick={() => setConfirm({ ...r, reason: '' })}>Batal</button>
                  )}
                </div>
              )},
            ]} />
        )}
      </div>

      {/* Modal tagihan */}
      <Modal open={!!invForm} onClose={() => setInvForm(null)} wide title="Buat Tagihan Baru"
        footer={<><button className="btn-outline" onClick={() => setInvForm(null)}>Batal</button>
          <button className="btn-primary" onClick={saveInv} disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Tagihan'}</button></>}>
        {invForm && (
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Siswa" required><Select value={invForm.studentId} onChange={(e) => {
              const s = students.find((x) => x.id === Number(e.target.value));
              setInvForm({ ...invForm, studentId: e.target.value, program: s?.program || invForm.program });
            }}>
              <option value="">-- Pilih Siswa --</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.nis})</option>)}</Select></Field>
            <Field label="Program"><Input value={invForm.program} onChange={(e) => setInvForm({ ...invForm, program: e.target.value })} placeholder="otomatis dari data siswa" /></Field>
            <Field label="Periode Tagihan" required hint="mis. Oktober 2026"><Input value={invForm.period} onChange={(e) => setInvForm({ ...invForm, period: e.target.value })} /></Field>
            <Field label="Uraian"><Input value={invForm.items[0].description} onChange={(e) => setInvForm({ ...invForm, items: [{ ...invForm.items[0], description: e.target.value }] })} placeholder="Biaya bimbel ..." /></Field>
            <Field label="Tanggal Tagihan" required><Input type="date" value={invForm.invoiceDate} onChange={(e) => setInvForm({ ...invForm, invoiceDate: e.target.value })} /></Field>
            <Field label="Tanggal Jatuh Tempo"><Input type="date" value={invForm.dueDate} onChange={(e) => setInvForm({ ...invForm, dueDate: e.target.value })} /></Field>
            <Field label="Nominal (Rp)" required><Input type="number" min="0" value={invForm.amount} onChange={(e) => setInvForm({ ...invForm, amount: e.target.value, items: [{ ...invForm.items[0], price: Number(e.target.value) }] })} /></Field>
            <Field label="Diskon (Rp)"><Input type="number" min="0" value={invForm.discount} onChange={(e) => setInvForm({ ...invForm, discount: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="Catatan"><Textarea rows={2} value={invForm.note} onChange={(e) => setInvForm({ ...invForm, note: e.target.value })} /></Field></div>
            <div className="sm:col-span-2 bg-navy/[0.05] rounded-lg p-3 flex justify-between items-center">
              <span className="text-sm text-slate-600">Total yang harus dibayar</span>
              <b className="text-lg text-navy">{rupiah(Number(invForm.amount || 0) - Number(invForm.discount || 0))}</b>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal pembayaran */}
      <Modal open={!!payForm} onClose={() => setPayForm(null)} title="Catat Pembayaran"
        footer={<><button className="btn-outline" onClick={() => setPayForm(null)}>Batal</button>
          <button className="btn-primary" onClick={savePay} disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Pembayaran'}</button></>}>
        {payForm && (() => {
          const target = payForm.invoiceId ? inv.find((i) => i.id === Number(payForm.invoiceId)) : null;
          const sisa = target ? Math.max(0, target.total - target.paid) : null;
          return (
            <div>
              <Field label="Tagihan" required>
                <Select value={payForm.invoiceId} onChange={(e) => {
                  const t = inv.find((i) => i.id === Number(e.target.value));
                  setPayForm({ ...payForm, invoiceId: e.target.value, amount: t ? String(Math.max(0, t.total - t.paid)) : payForm.amount });
                }}>
                  <option value="">-- Pilih tagihan belum lunas --</option>
                  {inv.filter((i) => ['belum', 'sebagian', 'jatuh_tempo'].includes(i.status)).map((i) => (
                    <option key={i.id} value={i.id}>{i.invoiceNumber} — {i.studentName} — sisa {rupiah(i.total - i.paid)}</option>
                  ))}
                </Select>
              </Field>
              {target && (
                <div className="bg-slate-50 rounded-lg p-3 text-xs mb-3 flex justify-between">
                  <span>Total: <b>{rupiah(target.total)}</b></span>
                  <span>Sudah dibayar: <b>{rupiah(target.paid)}</b></span>
                  <span>Sisa: <b className="text-red-600">{rupiah(sisa)}</b></span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nominal (Rp)" required><Input type="number" min="1" value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} /></Field>
                <Field label="Tanggal" required><Input type="date" value={payForm.paidAt} onChange={(e) => setPayForm({ ...payForm, paidAt: e.target.value })} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Metode" required><Select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                  {['Tunai', 'Transfer bank', 'QRIS', 'Lainnya'].map((m) => <option key={m}>{m}</option>)}</Select></Field>
                <Field label="Catatan"><Input value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} /></Field>
              </div>
              <p className="text-[11px] text-slate-500">Pembayaran sebagian diperbolehkan — sisa tagihan dihitung otomatis dalam transaksi database. Pencatatan metode pembayaran tidak berarti terhubung payment gateway.</p>
            </div>
          );
        })()}
      </Modal>

      {/* Detail tagihan */}
      <Modal open={!!detail} onClose={() => setDetail(null)} wide title={`Detail Tagihan ${detail?.invoiceNumber || ''}`}
        footer={<button className="btn-outline" onClick={() => setDetail(null)}>Tutup</button>}>
        {!detail ? <Spinner /> : (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              {[['Siswa', detail.studentName], ['Periode', detail.period], ['Tanggal', tgl(detail.invoiceDate)],
                ['Jatuh Tempo', tgl(detail.dueDate)], ['Total', rupiah(detail.total)], ['Dibayar', rupiah(detail.paid)],
                ['Sisa', rupiah(detail.remaining)], ['Status', detail.status]].map(([k, v]) => (
                <div key={k} className="bg-slate-50 rounded-lg p-2.5">
                  <div className="text-[10px] uppercase text-slate-400 font-bold">{k}</div>
                  <div className="text-sm font-semibold text-navy">{v}</div>
                </div>
              ))}
            </div>
            <h4 className="font-bold text-navy text-sm mb-2">Rincian Item</h4>
            <Table rows={detail.items.map((x) => ({ ...x, id: x.id }))}
              columns={[{ label: 'Uraian', key: 'description' }, { label: 'Qty', center: true, key: 'qty' },
                { label: 'Harga', render: (r) => rupiah(r.price) }, { label: 'Subtotal', render: (r) => <b>{rupiah(r.subtotal)}</b> }]} />
            <h4 className="font-bold text-navy text-sm mt-4 mb-2">Riwayat Pembayaran</h4>
            <Table rows={detail.payments.map((p) => ({ ...p, id: p.id }))}
              empty="Belum ada pembayaran untuk tagihan ini."
              columns={[{ label: 'No. Transaksi', render: (r) => <span className="font-mono text-xs">{r.transaction_number}</span> },
                { label: 'Tanggal', render: (r) => tgl(r.paid_at) }, { label: 'Nominal', render: (r) => <b>{rupiah(r.amount)}</b> },
                { label: 'Metode', key: 'method' }, { label: 'Petugas', key: 'recorder' },
                { label: '', center: true, render: (r) => <a className="btn-outline btn-sm" href={`/api/billing/payments/${r.id}/receipt`} target="_blank" rel="noreferrer">Kuitansi</a> }]} />
          </div>
        )}
      </Modal>

      {/* Konfirmasi batal pembayaran */}
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Batalkan Pembayaran"
        footer={<><button className="btn-outline" onClick={() => setConfirm(null)}>Batal</button>
          <button className="btn-danger" onClick={doCancelPay} disabled={busy || !confirm?.reason?.trim()}>{busy ? 'Memproses...' : 'Batalkan Pembayaran'}</button></>}>
        <div className="text-sm text-slate-600">
          <p className="mb-3">Transaksi <b>{confirm?.transaction_number}</b> sebesar <b>{rupiah(confirm?.amount)}</b> akan ditandai dibatalkan. Data transaksi tetap tersimpan (tidak dihapus) dan saldo tagihan dihitung ulang.</p>
          <Field label="Alasan pembatalan (wajib)" required>
            <Textarea value={confirm?.reason || ''} onChange={(e) => setConfirm({ ...confirm, reason: e.target.value })} />
          </Field>
          <p className="text-[11px] text-slate-500">Pembatalan tercatat pada riwayat aktivitas beserta alasannya.</p>
        </div>
      </Modal>
    </div>
  );
}
