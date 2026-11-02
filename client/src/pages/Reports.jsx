import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { get, post } from '../api';
import { PageHead, Table, Badge, Modal, Field, Select, Input, useToast, Spinner, Tabs } from '../ui';
import { tgl } from '../format';
import { exportRaporPdf } from '../export';

const STATUS_LABEL = { draf: 'Draf', menunggu: 'Menunggu Pemeriksaan', revisi: 'Perlu Revisi', disetujui: 'Disetujui', diterbitkan: 'Diterbitkan' };

export default function Reports() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState('semua');
  const [rows, setRows] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [create, setCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [note, setNote] = useState('');
  const [pdfBusy, setPdfBusy] = useState(0);

  const downloadPdf = async (r) => {
    setPdfBusy(r.id);
    try {
      const d = await get(`/reports/${r.id}`);
      await exportRaporPdf(d.data);
      toast.success('PDF rapor berhasil diunduh.');
    } catch (e) { toast.error(e.message); } finally { setPdfBusy(0); }
  };

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (tab !== 'semua') q.set('status', tab);
    get(`/reports?${q}`).then((d) => setRows(d.data)).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [tab]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { get('/catalog/report-periods').then((d) => setPeriods(d.data)).catch(() => {}); }, []);

  const doAction = async () => {
    setBusy(true);
    try {
      const a = confirmAction;
      let d;
      if (a.kind === 'submit') d = await post(`/reports/${a.id}/submit`, {});
      else if (a.kind === 'check') d = await post(`/reports/${a.id}/check`, { action: a.action, note });
      else if (a.kind === 'approve') d = await post(`/reports/${a.id}/approve`, {});
      else if (a.kind === 'publish') d = await post(`/reports/${a.id}/publish`, {});
      toast.success(d.message);
      setConfirmAction(null); setNote(''); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const counts = rows.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {});

  const actionButtons = (r) => {
    const btns = [];
    if (user.role === 'tentor' && ['draf', 'revisi'].includes(r.status)) {
      btns.push(<button key="submit" className="btn-outline btn-sm" onClick={() => setConfirmAction({ kind: 'submit', id: r.id, row: r })}>Kirim Periksa</button>);
    }
    if (['sekretaris', 'direktur'].includes(user.role) && r.status === 'menunggu') {
      btns.push(<button key="check" className="btn-primary btn-sm" onClick={() => setConfirmAction({ kind: 'check', id: r.id, row: r, action: 'approve' })}>Periksa & Setujui</button>);
      btns.push(<button key="rev" className="btn-outline btn-sm !text-orange-600" onClick={() => setConfirmAction({ kind: 'check', id: r.id, row: r, action: 'revisi' })}>Kembalikan</button>);
    }
    if (user.role === 'direktur' && r.status === 'disetujui') {
      btns.push(<button key="appr" className="btn-primary btn-sm" onClick={() => setConfirmAction({ kind: 'approve', id: r.id, row: r })}>Persetujuan Akhir</button>);
    }
    if (['sekretaris', 'direktur'].includes(user.role) && r.status === 'disetujui') {
      btns.push(<button key="pub" className="btn-primary btn-sm" onClick={() => setConfirmAction({ kind: 'publish', id: r.id, row: r })}>Terbitkan</button>);
    }
    return btns;
  };

  const openCreate = () => {
    if (!periods.length) return toast.error('Belum ada periode rapor. Minta pengelola membuat periode terlebih dahulu.');
    setCreate(true);
  };

  return (
    <div>
      <PageHead title="Rapor Perkembangan Siswa" desc="Alur: draf → pemeriksaan → persetujuan → terbit (PDF)"
        actions={<button className="btn-primary" onClick={openCreate}>+ Buat Rapor</button>} />

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'semua', label: 'Semua', count: rows.length },
        { key: 'draf', label: 'Draf' },
        { key: 'menunggu', label: 'Menunggu Pemeriksaan' },
        { key: 'revisi', label: 'Perlu Revisi' },
        { key: 'disetujui', label: 'Disetujui' },
        { key: 'diterbitkan', label: 'Diterbitkan' },
      ]} />

      <div className="card p-4">
        <Table loading={loading} rows={rows} empty="Belum ada rapor untuk periode ini."
          onRowClick={(r) => nav(`/rapor/${r.id}`)}
          columns={[
            { label: 'Kode', render: (r) => <span className="font-mono text-xs">{r.report_code}</span> },
            { label: 'Siswa', render: (r) => <div><div className="font-semibold text-navy">{r.student_name}</div><div className="text-[11px] text-slate-400">{r.nis} • {r.class_name || '-'}</div></div> },
            { label: 'Periode', key: 'period_name' },
            { label: 'Tentor', render: (r) => <span className="text-xs">{r.tutor_name}</span> },
            { label: 'Status', render: (r) => <Badge status={r.status} children={STATUS_LABEL[r.status]} /> },
            { label: 'Terbit', render: (r) => tgl(r.published_at) },
            { label: 'Aksi', center: true, render: (r) => (
              <div className="flex gap-1 justify-center flex-wrap" onClick={(e) => e.stopPropagation()}>
                <button className="btn-outline btn-sm" onClick={() => nav(`/rapor/${r.id}`)}>Buka</button>
                {actionButtons(r)}
                {['disetujui', 'diterbitkan'].includes(r.status) && (
                  <button className="btn-outline btn-sm" disabled={pdfBusy === r.id} onClick={() => downloadPdf(r)}>
                    {pdfBusy === r.id ? 'Menyiapkan...' : 'PDF'}
                  </button>
                )}
              </div>
            )},
          ]} />
        <p className="text-[11px] text-slate-400 mt-3">
          Rapor yang sudah diterbitkan tidak dapat diubah tanpa proses revisi tercatat. PDF dapat diunduh lewat tombol <b>PDF</b>.
        </p>
      </div>

      <CreateModal open={create} onClose={() => setCreate(false)} periods={periods}
        onCreated={(id) => { setCreate(false); toast.success('Draf rapor dibuat.'); nav(`/rapor/${id}`); }} />

      <Modal open={!!confirmAction} onClose={() => setConfirmAction(null)}
        title={
          confirmAction?.kind === 'submit' ? 'Kirim Rapor untuk Pemeriksaan'
          : confirmAction?.kind === 'check' ? (confirmAction.action === 'revisi' ? 'Kembalikan untuk Revisi' : 'Setujui Rapor')
          : confirmAction?.kind === 'approve' ? 'Persetujuan Akhir Direktur'
          : 'Terbitkan Rapor'
        }
        footer={<>
          <button className="btn-outline" onClick={() => setConfirmAction(null)}>Batal</button>
          <button className="btn-primary" onClick={doAction} disabled={busy || (confirmAction?.kind === 'check' && confirmAction.action === 'revisi' && !note.trim())}>
            {busy ? 'Memproses...' : 'Konfirmasi'}
          </button>
        </>}>
        <div className="text-sm text-slate-600">
          <p className="mb-3">Rapor <b>{confirmAction?.row?.student_name}</b> — periode {confirmAction?.row?.period_name}.</p>
          {confirmAction?.kind === 'check' && confirmAction.action === 'revisi' && (
            <Field label="Alasan Pengembalian (wajib)" required>
              <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Jelaskan bagian yang harus diperbaiki tentor..." />
            </Field>
          )}
          {confirmAction?.kind === 'check' && confirmAction.action === 'approve' && (
            <Field label="Catatan Pemeriksaan (opsional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          )}
          {confirmAction?.kind === 'publish' && (
            <p className="text-xs bg-sky-50 border border-sky-200 rounded-lg p-3">
              Status rapor menjadi <b>Diterbitkan</b>. PDF rapor dapat diunduh kapan saja lewat tombol <b>PDF</b>.
            </p>
          )}
          {confirmAction?.kind === 'submit' && (
            <p className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-3">
              Setelah dikirim, rapor dikunci untuk tentor dan menunggu pemeriksaan sekretaris.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

function CreateModal({ open, onClose, periods, onCreated }) {
  const toast = useToast();
  const { user } = useAuth();
  const [periodId, setPeriodId] = useState('');
  const [cands, setCands] = useState([]);
  const [studentId, setStudentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPeriodId(periods[0]?.id || '');
    setCands([]); setStudentId('');
  }, [open, periods]);

  useEffect(() => {
    if (!periodId) return;
    setLoading(true);
    get(`/reports/candidates?periodId=${periodId}`)
      .then((d) => setCands(d.data))
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [periodId]);

  const create = async () => {
    if (!studentId) return toast.error('Pilih siswa yang akan dibuatkan rapor.');
    setBusy(true);
    try {
      const c = cands.find((x) => x.id === Number(studentId));
      const d = await post('/reports', { studentId: Number(studentId), periodId: Number(periodId), classId: c?.class_id, tutorId: c?.tutor_id });
      onCreated(d.id);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Buat Rapor Perkembangan"
      footer={<><button className="btn-outline" onClick={onClose}>Batal</button>
        <button className="btn-primary" onClick={create} disabled={busy || loading}>{busy ? 'Membuat...' : 'Buat Draf'}</button></>}>
      <Field label="Periode Laporan" required>
        <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
          <option value="">-- Pilih Periode --</option>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.name} ({tgl(p.start_date)} – {tgl(p.end_date)})</option>)}
        </Select>
      </Field>
      <Field label="Siswa (yang belum memiliki rapor pada periode ini)" required>
        {loading ? <Spinner /> : (
          <Select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            <option value="">-- Pilih Siswa --</option>
            {cands.map((c) => <option key={c.id} value={c.id}>{c.full_name} ({c.nis}) — {c.class_name} • {c.tutor_name}</option>)}
          </Select>
        )}
      </Field>
      {cands.length === 0 && !loading && periodId && <p className="text-xs text-emerald-600">✓ Semua siswa terdaftar sudah memiliki rapor pada periode ini.</p>}
      <p className="text-[11px] text-slate-500">Sistem mengambil data absensi, jurnal, dan nilai yang relevan otomatis saat draf dibuat.</p>
    </Modal>
  );
}
