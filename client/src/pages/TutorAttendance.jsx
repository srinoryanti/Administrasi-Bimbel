import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { get, post, put } from '../api';
import { PageHead, Table, Input, Select, Badge, useToast, Modal, Field } from '../ui';
import { tgl, today } from '../format';

export default function TutorAttendance() {
  const toast = useToast();
  const [f, setF] = useState({ from: '', to: '', tutorId: '' });
  const [rows, setRows] = useState([]);
  const [tutors, setTutors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [add, setAdd] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ tutorId: '', attDate: today(), status: 'hadir', learningStatus: 'dilaksanakan', note: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => { get('/tutors').then((d) => setTutors(d.data)).catch(() => {}); }, []);
  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (f.from) q.set('from', f.from);
    if (f.to) q.set('to', f.to);
    if (f.tutorId) q.set('tutorId', f.tutorId);
    get(`/attendance/tutor?${q}`).then((d) => setRows(d.data)).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [f]);
  useEffect(() => { load(); }, [load]);

  const summary = rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});

  const simpan = async () => {
    if (!form.tutorId && !edit) return toast.error('Pilih tentor.');
    setBusy(true);
    try {
      const d = edit
        ? await put(`/attendance/tutor/${edit.id}`, { status: form.status, learningStatus: form.learningStatus, note: form.note })
        : await post('/attendance/tutor', { ...form, tutorId: Number(form.tutorId), startTime: null, endTime: null });
      toast.success(d.message);
      setAdd(false); setEdit(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const openEdit = (r) => {
    setEdit(r);
    setForm({ tutorId: r.tutor_id, attDate: r.att_date, status: r.status, learningStatus: r.learningStatus || r.learning_status || 'dilaksanakan', note: r.note || '' });
  };

  return (
    <div>
      <PageHead title="Absensi Tentor" desc="Pencatatan kehadiran tentor & status pelaksanaan pembelajaran"
        actions={<button className="btn-primary" onClick={() => { setEdit(null); setForm({ tutorId: '', attDate: today(), status: 'hadir', learningStatus: 'dilaksanakan', note: '' }); setAdd(true); }}>+ Catat Kehadiran</button>} />

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
        {[['Total', rows.length], ['Hadir', summary.hadir || 0], ['Izin', summary.izin || 0], ['Sakit', summary.sakit || 0], ['Tidak Hadir', summary.tidak_hadir || 0]].map(([l, v]) => (
          <div key={l} className="card p-3 text-center">
            <div className="text-xl font-bold text-navy">{v}</div><div className="text-[11px] text-slate-500">{l}</div>
          </div>
        ))}
      </div>

      <div className="card p-4 mb-4 grid sm:grid-cols-4 gap-3">
        <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <Select value={f.tutorId} onChange={(e) => setF({ ...f, tutorId: e.target.value })}>
          <option value="">Semua Tentor</option>
          {tutors.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}
        </Select>
        <button className="btn-outline" onClick={() => setF({ from: '', to: '', tutorId: '' })}>Reset</button>
      </div>

      <div className="card p-4">
        <Table loading={loading} rows={rows} empty="Belum ada absensi tentor."
          columns={[
            { label: 'Tanggal', render: (r) => <span className="whitespace-nowrap">{tgl(r.att_date)}</span> },
            { label: 'Tentor', key: 'tutor_name' },
            { label: 'Kelas', render: (r) => r.class_name || '-' },
            { label: 'Kehadiran', render: (r) => <Badge status={r.status} /> },
            { label: 'Pelaksanaan', render: (r) => (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 whitespace-nowrap">{(r.learning_status || '-').replace(/_/g, ' ')}</span>
            )},
            { label: 'Catatan', render: (r) => <span className="text-xs text-slate-500">{r.note || '-'}</span> },
            { label: 'Aksi', center: true, render: (r) => <button className="btn-outline btn-sm" onClick={() => openEdit(r)}>Ubah</button> },
          ]} />
        <div className="mt-3 bg-slate-50 rounded-lg p-3 text-[11px] text-slate-500 leading-relaxed">
          <b>Aturan sistem:</b> kehadiran tentor dibedakan dari status pelaksanaan pembelajaran. Kelas yang dibatalkan/dijadwalkan ulang tidak otomatis menjadikan tentor "tidak hadir".
          Rekap bulanan tersedia melalui filter tanggal di atas dan modul Pusat Laporan.
        </div>
      </div>

      <Modal open={add || !!edit} onClose={() => { setAdd(false); setEdit(null); }}
        title={edit ? 'Ubah Absensi Tentor' : 'Catat Kehadiran Tentor'}
        footer={<><button className="btn-outline" onClick={() => { setAdd(false); setEdit(null); }}>Batal</button>
          <button className="btn-primary" onClick={simpan} disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button></>}>
        {!edit && (
          <Field label="Tentor" required><Select value={form.tutorId} onChange={(e) => setForm({ ...form, tutorId: e.target.value })}>
            <option value="">-- Pilih --</option>
            {tutors.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}</Select></Field>
        )}
        {!edit && <Field label="Tanggal" required><Input type="date" value={form.attDate} onChange={(e) => setForm({ ...form, attDate: e.target.value })} /></Field>}
        <Field label="Status Kehadiran" required><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          {['hadir', 'izin', 'sakit', 'tidak_hadir'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select></Field>
        <Field label="Status Pelaksanaan Pembelajaran"><Select value={form.learningStatus} onChange={(e) => setForm({ ...form, learningStatus: e.target.value })}>
          <option value="dilaksanakan">Dilaksanakan</option><option value="sebagian">Sebagian</option>
          <option value="dibatalkan">Dibatalkan</option><option value="dijadwalkan_ulang">Dijadwalkan ulang</option></Select></Field>
        <Field label="Catatan"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
      </Modal>
    </div>
  );
}
