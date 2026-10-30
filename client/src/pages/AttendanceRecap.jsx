import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { get, post, put, del } from '../api';
import { PageHead, Tabs, Table, Input, Select, Badge, useToast, Modal, Field } from '../ui';
import { tgl, today, rupiah } from '../format';
import { useAuth } from '../auth';

export default function AttendanceRecap() {
  const toast = useToast();
  const [tab, setTab] = useState('rekap');
  return (
    <div>
      <PageHead title="Rekap Absensi" desc="Rekap kehadiran siswa dan tentor (data nyata dari database)"
        actions={<Link to="/absensi" className="btn-outline">Isi Absensi per Pertemuan →</Link>} />
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'rekap', label: 'Rekap Kehadiran Siswa' },
        { key: 'detail', label: 'Rincian Absensi Siswa' },
        { key: 'tentor', label: 'Rekap Absensi Tentor' },
      ]} />
      {tab === 'rekap' && <RecapSummary />}
      {tab === 'detail' && <DetailList />}
      {tab === 'tentor' && <TutorRecap />}
    </div>
  );
}

function useFilters(initial) {
  const [f, setF] = useState(initial);
  return [f, setF];
}

function RecapSummary() {
  const toast = useToast();
  const [f, setF] = useFilters({ from: '', to: '', classId: '' });
  const [rows, setRows] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { get('/data/classes').then((d) => setClasses(d.data)).catch(() => {}); }, []);
  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (f.from) q.set('from', f.from);
    if (f.to) q.set('to', f.to);
    if (f.classId) q.set('classId', f.classId);
    get(`/attendance/summary?${q}`).then((d) => setRows(d.data)).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [f]);
  useEffect(() => { load(); }, [load]);

  const exportCSV = () => {
    const head = ['NIS', 'Nama', 'Hadir', 'Izin', 'Sakit', 'Alpa', 'Total', 'Persentase'];
    const body = rows.map((r) => [r.nis, r.full_name, r.hadir, r.izin, r.sakit, r.alpa, r.total, `${r.percentage}%`]);
    const csv = [head, ...body].map((r) => r.join(';')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `rekap-absensi-${today()}.csv`; a.click();
    toast.success('Rekap absensi diekspor.');
  };

  return (
    <div>
      <div className="card p-4 mb-4 grid sm:grid-cols-4 gap-3">
        <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <Select value={f.classId} onChange={(e) => setF({ ...f, classId: e.target.value })}>
          <option value="">Semua Kelas</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div className="flex gap-2">
          <button className="btn-outline flex-1" onClick={() => setF({ from: '', to: '', classId: '' })}>Reset</button>
          <button className="btn-primary flex-1" onClick={exportCSV}>CSV</button>
        </div>
      </div>
      <div className="card p-4">
        <Table loading={loading} rows={rows} empty="Belum ada data absensi untuk filter ini."
          columns={[
            { label: 'NIS', key: 'nis', className: 'font-mono text-xs' },
            { label: 'Nama Siswa', key: 'full_name' },
            { label: 'Hadir', center: true, render: (r) => <b className="text-emerald-600">{r.hadir}</b> },
            { label: 'Izin', center: true, key: 'izin' },
            { label: 'Sakit', center: true, key: 'sakit' },
            { label: 'Alpa', center: true, render: (r) => <b className={r.alpa > 0 ? 'text-red-600' : ''}>{r.alpa}</b> },
            { label: 'Total', center: true, key: 'total' },
            { label: 'Kehadiran', center: true, render: (r) => (
              <div className="flex items-center gap-2 justify-center">
                <div className="w-20 h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div className={`h-full ${r.percentage >= 80 ? 'bg-emerald-500' : r.percentage >= 60 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${r.percentage}%` }} />
                </div>
                <span className="text-xs font-bold">{r.percentage}%</span>
              </div>
            )},
          ]} />
      </div>
    </div>
  );
}

function DetailList() {
  const toast = useToast();
  const [f, setF] = useFilters({ from: '', to: '', status: '', search: '' });
  const [rows, setRows] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [koreksi, setKoreksi] = useState(null);
  const [form, setForm] = useState({ status: '', changeNote: '', note: '' });
  const { user } = useAuth();

  useEffect(() => { get('/data/classes').then((d) => setClasses(d.data)).catch(() => {}); }, []);
  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => v && q.set(k, v));
    get(`/attendance/recap?${q}`).then((d) => setRows(d.data)).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [f]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [f]);

  const simpan = async () => {
    if (form.status !== koreksi.status && !form.changeNote.trim()) return toast.error('Koreksi status wajib disertai catatan perubahan.');
    try {
      const d = await put(`/attendance/${koreksi.id}`, { ...form, status: form.status || undefined });
      toast.success(d.message);
      setKoreksi(null); load();
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <div className="card p-4 mb-4 grid sm:grid-cols-5 gap-3">
        <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        <Input placeholder="Cari nama siswa..." value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="">Semua Status</option>
          {['hadir', 'izin', 'sakit', 'alpa'].map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <button className="btn-outline" onClick={() => setF({ from: '', to: '', status: '', search: '' })}>Reset</button>
      </div>
      <div className="card p-4">
        <Table loading={loading} rows={rows.slice(0, 500)} empty="Tidak ada absensi untuk filter ini."
          columns={[
            { label: 'Tanggal', render: (r) => <span className="whitespace-nowrap">{tgl(r.session_date)}</span> },
            { label: 'Siswa', render: (r) => <div><div className="font-semibold">{r.student_name}</div><div className="text-[11px] text-slate-400">{r.nis}</div></div> },
            { label: 'Kelas', key: 'class_name' },
            { label: 'Tentor', key: 'tutor_name' },
            { label: 'Jam', render: (r) => `${r.start_time}–${r.end_time}` },
            { label: 'Status', render: (r) => <Badge status={r.status} /> },
            { label: 'Catatan', render: (r) => <span className="text-xs text-slate-500">{r.note || (r.change_note ? `↺ ${r.change_note}` : '-')}</span> },
            ...(user.role !== 'tentor' ? [{ label: 'Aksi', center: true, render: (r) => (
              <button className="btn-outline btn-sm" onClick={() => { setKoreksi(r); setForm({ status: r.status, changeNote: '', note: r.note || '' }); }}>Koreksi</button>
            ) }] : []),
          ]} />
      </div>

      <Modal open={!!koreksi} onClose={() => setKoreksi(null)} title="Koreksi Absensi (Tercatat)"
        footer={<><button className="btn-outline" onClick={() => setKoreksi(null)}>Batal</button>
          <button className="btn-primary" onClick={simpan}>Simpan Koreksi</button></>}>
        {koreksi && (
          <div>
            <div className="bg-slate-50 rounded-lg p-3 text-sm mb-3">
              <b>{koreksi.student_name}</b> • {koreksi.class_name}<br />
              {tgl(koreksi.session_date)} • Status saat ini: <Badge status={koreksi.status} />
            </div>
            <Field label="Status Baru"><Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              {['hadir', 'izin', 'sakit', 'alpa'].map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
            <Field label="Catatan Perubahan (wajib jika status berubah)" required>
              <Input value={form.changeNote} onChange={(e) => setForm({ ...form, changeNote: e.target.value })} placeholder="mis. Siswa izin, koreksi dari data manual" />
            </Field>
            <Field label="Catatan"><Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
            <p className="text-[11px] text-slate-500">Koreksi tercatat pada riwayat aktivitas: pengguna, waktu, status lama → baru.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

function TutorRecap() {
  const toast = useToast();
  const [f, setF] = useFilters({ from: '', to: '', tutorId: '' });
  const [rows, setRows] = useState([]);
  const [tutors, setTutors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [add, setAdd] = useState(false);
  const [form, setForm] = useState({ tutorId: '', attDate: today(), status: 'hadir', learningStatus: 'dilaksanakan', note: '' });

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

  const simpan = async () => {
    if (!form.tutorId) return toast.error('Pilih tentor.');
    try {
      const d = await post('/attendance/tutor', { ...form, tutorId: Number(form.tutorId), attDate: form.attDate, startTime: null, endTime: null });
      toast.success(d.message);
      setAdd(false); load();
    } catch (e) { toast.error(e.message); }
  };

  const summary = rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});

  return (
    <div>
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
        <button className="btn-primary" onClick={() => setAdd(true)}>+ Catat Absensi Tentor</button>
      </div>

      <div className="card p-4">
        <Table loading={loading} rows={rows} empty="Belum ada absensi tentor."
          columns={[
            { label: 'Tanggal', render: (r) => <span className="whitespace-nowrap">{tgl(r.att_date)}</span> },
            { label: 'Tentor', key: 'tutor_name' },
            { label: 'Kelas', render: (r) => r.class_name || '-' },
            { label: 'Kehadiran', render: (r) => <Badge status={r.status} /> },
            { label: 'Pelaksanaan Pembelajaran', render: (r) => (
              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100">{(r.learning_status || '-').replace(/_/g, ' ')}</span>
            )},
            { label: 'Catatan', render: (r) => <span className="text-xs text-slate-500">{r.note || '-'}</span> },
          ]} />
        <p className="text-[11px] text-slate-400 mt-3">
          • Kehadiran tentor dibedakan dari status pelaksanaan pembelajaran — kelas batal/dijadwalkan ulang tidak otomatis dihitung tentor alpa.
        </p>
      </div>

      <Modal open={add} onClose={() => setAdd(false)} title="Catat Kehadiran Tentor"
        footer={<><button className="btn-outline" onClick={() => setAdd(false)}>Batal</button>
          <button className="btn-primary" onClick={simpan}>Simpan</button></>}>
        <Field label="Tentor" required><Select value={form.tutorId} onChange={(e) => setForm({ ...form, tutorId: e.target.value })}>
          <option value="">-- Pilih --</option>
          {tutors.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}</Select></Field>
        <Field label="Tanggal" required><Input type="date" value={form.attDate} onChange={(e) => setForm({ ...form, attDate: e.target.value })} /></Field>
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
