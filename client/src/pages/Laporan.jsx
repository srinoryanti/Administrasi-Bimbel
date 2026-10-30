import React, { useEffect, useMemo, useState } from 'react';
import { get } from '../api';
import { useAuth } from '../auth';
import { PageHead, Field, Input, Spinner, useToast, Badge } from '../ui';
import { rupiah, today } from '../format';

const NEEDS_DATE = ['absensi_siswa', 'absensi_tentor', 'aktivitas_pembelajaran', 'tagihan', 'pembayaran'];

export default function Laporan() {
  const toast = useToast();
  const { user } = useAuth();
  const [types, setTypes] = useState([]);
  const [type, setType] = useState('ringkasan');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    get('/laporan/types').then((d) => setTypes(d.data)).catch((e) => toast.error(e.message));
  }, []);

  const load = () => {
    if (!type) return;
    setLoading(true);
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    get(`/laporan/${type}?${q}`)
      .then((d) => setData(d))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(() => (data?.data?.length ? Object.keys(data.data[0]) : []), [data]);
  const showDate = NEEDS_DATE.includes(type);

  const exportFile = async (kind) => {
    setBusy(kind);
    try {
      const q = new URLSearchParams();
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      const res = await fetch(`/api/laporan/${type}/${kind}?${q}`, { credentials: 'include' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Ekspor gagal.'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `laporan-${type}-${today()}.${kind === 'excel' ? 'xlsx' : 'pdf'}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Laporan ${kind === 'excel' ? 'Excel' : 'PDF'} berhasil diunduh.`);
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  const renderCell = (h, v) => {
    if (v == null || v === '') return '—';
    if (typeof v === 'number' && /Total|Nominal|Sisa|Dibayar|Pemasukan/i.test(h)) return rupiah(v);
    if (h === 'Status') return <Badge status={String(v)}>{String(v)}</Badge>;
    return String(v);
  };

  return (
    <div>
      <PageHead title="Laporan Bimbel" desc="16 jenis laporan operasional & keuangan, ekspor Excel dan PDF"
        actions={<>
          <button className="btn-outline" disabled={!data || busy} onClick={() => exportFile('pdf')}>
            {busy === 'pdf' ? 'Menyiapkan...' : 'Ekspor PDF'}
          </button>
          <button className="btn-primary" disabled={!data || busy} onClick={() => exportFile('excel')}>
            {busy === 'excel' ? 'Menyiapkan...' : 'Ekspor Excel'}
          </button>
        </>} />

      <div className="card p-4 mb-4 grid sm:grid-cols-4 gap-3 items-end">
        <Field label="Jenis Laporan">
          <select className="input" value={type} onChange={(e) => { setType(e.target.value); setData(null); }}>
            {types.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
          </select>
        </Field>
        <Field label="Dari Tanggal" hint={showDate ? undefined : 'filter ini tidak dipakai'}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!showDate} />
        </Field>
        <Field label="Sampai Tanggal">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={!showDate} />
        </Field>
        <button className="btn-outline" onClick={load} disabled={loading}>{loading ? 'Memuat...' : 'Muat Ulang'}</button>
      </div>

      {user.role === 'tentor' && (
        <p className="text-xs text-amber-600 mb-3">Modul laporan hanya untuk sekretaris & direktur.</p>
      )}

      <div className="card p-4 overflow-x-auto">
        {loading ? <Spinner /> : !data ? null : (
          <>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-navy">{data.title}</h3>
                <p className="text-xs text-slate-400">{data.data.length} baris data{showDate && (from || to) ? ` • periode ${from || 'semua'} s.d. ${to || 'semua'}` : ''}</p>
              </div>
            </div>
            {data.data.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">Tidak ada data untuk filter yang dipilih.</p>
            ) : (
              <div className="max-h-[60vh] overflow-auto border border-slate-200 rounded-lg">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-navy text-white">
                    <tr>{columns.map((c) => <th key={c} className="th !bg-navy !text-white whitespace-nowrap">{c}</th>)}</tr>
                  </thead>
                  <tbody>
                    {data.data.map((r, i) => (
                      <tr key={i} className="border-b border-slate-100 hover:bg-navy/[0.03]">
                        {columns.map((c) => <td key={c} className="td whitespace-nowrap">{renderCell(c, r[c])}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
