import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { get, post, put, del } from '../api';
import { PageHead, Table, Field, Input, Select, Modal, Confirm, Badge, useToast, Spinner } from '../ui';
import { tgl, today } from '../format';

const emptyForm = {
  fullName: '', birthPlace: '', birthDate: '', gender: 'L', educationLevel: 'SD', schoolGrade: '',
  schoolName: '', address: '', programId: '', startDate: today(), status: 'aktif',
  guardianName: '', guardianRelation: 'Orang Tua', guardianPhone: '', guardianOccupation: '',
};

export default function Students() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [level, setLevel] = useState('');
  const [form, setForm] = useState(null); // null | {mode, data}
  const [programs, setPrograms] = useState([]);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = user.role === 'sekretaris' || user.role === 'direktur';

  useEffect(() => { get('/catalog/programs').then((d) => setPrograms(d.data)).catch(() => {}); }, []);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (status) q.set('status', status);
    if (level) q.set('level', level);
    get(`/students?${q}`).then((d) => setRows(d.data)).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [search, status, level]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const save = async () => {
    if (!form.data.fullName?.trim()) return toast.error('Nama lengkap wajib diisi.');
    setBusy(true);
    try {
      if (form.mode === 'add') {
        const d = await post('/students', form.data);
        toast.success(d.message + (d.nis ? ` NIS: ${d.nis}` : ''));
      } else {
        const d = await put(`/students/${form.data.id}`, form.data);
        toast.success(d.message);
      }
      setForm(null);
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const d = await del(`/students/${confirm.id}`);
      toast.success(d.message);
      setConfirm(null);
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const exportCSV = () => {
    const headers = ['NIS', 'Nama', 'Jenjang', 'Kelas', 'Sekolah', 'Program', 'Status', 'Mulai'];
    const body = rows.map((r) => [r.nis, r.fullName, r.educationLevel, r.schoolGrade, r.schoolName, r.program, r.status, tgl(r.startDate)]);
    const csv = [headers, ...body].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `data-siswa-${today()}.csv`;
    a.click();
    toast.success('Data siswa diekspor ke CSV (dapat dibuka di Excel).');
  };

  const set = (k, v) => setForm((f) => ({ ...f, data: { ...f.data, [k]: v } }));

  return (
    <div>
      <PageHead title="Data Siswa" desc={`Kelola data siswa • ${rows.length} siswa ditampilkan`}
        actions={<>
          <button className="btn-outline" onClick={exportCSV}>Ekspor CSV</button>
          {isAdmin && <button className="btn-primary" onClick={() => setForm({ mode: 'add', data: { ...emptyForm } })}>+ Tambah Siswa</button>}
        </>} />

      <div className="card p-4 mb-4">
        <div className="grid sm:grid-cols-4 gap-3">
          <Input placeholder="Cari nama, NIS, sekolah..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Semua Status</option>
            <option value="aktif">Aktif</option>
            <option value="cuti">Cuti</option>
            <option value="berhenti">Berhenti</option>
          </Select>
          <Select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Semua Jenjang</option>
            {['SD', 'SMP', 'SMA'].map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
          <button className="btn-outline" onClick={() => { setSearch(''); setStatus(''); setLevel(''); }}>Reset Filter</button>
        </div>
      </div>

      <div className="card p-3 sm:p-4">
        <Table
          loading={loading}
          rows={rows}
          empty="Tidak ada siswa yang cocok dengan pencarian/filter."
          onRowClick={(r) => nav(`/siswa/${r.id}`)}
          columns={[
            { label: 'NIS', key: 'nis', className: 'font-mono text-xs whitespace-nowrap' },
            { label: 'Nama Lengkap', render: (r) => (
              <div className="min-w-0">
                <div className="font-semibold text-navy truncate">{r.fullName}</div>
                <div className="text-[11px] text-slate-400 truncate">{r.schoolName || '-'} • {r.schoolGrade || '-'}</div>
              </div>
            )},
            { label: 'Jenjang', key: 'educationLevel', center: true },
            { label: 'Program', render: (r) => <span className="text-xs">{r.program || '-'}</span> },
            { label: 'Orang Tua/Wali', render: (r) => <span className="text-xs">{r.guardianName || '-'}</span> },
            { label: 'Status', render: (r) => <Badge status={r.status} /> },
            { label: 'Aksi', center: true, render: (r) => (
              <div className="flex gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
                <button className="btn-outline btn-sm" onClick={() => nav(`/siswa/${r.id}`)}>Detail</button>
                {isAdmin && <>
                  <button className="btn-outline btn-sm" onClick={() => setForm({ mode: 'edit', data: { ...emptyForm, ...r } })}>Edit</button>
                  <button className="btn-outline btn-sm !text-red-600" onClick={() => setConfirm(r)}>Hapus</button>
                </>}
              </div>
            )},
          ]}
        />
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} wide
        title={form?.mode === 'add' ? 'Tambah Siswa Baru' : `Edit Siswa: ${form?.data?.fullName || ''}`}
        footer={<>
          <button className="btn-outline" onClick={() => setForm(null)}>Batal</button>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Data'}</button>
        </>}>
        {form && (
          <div className="grid sm:grid-cols-2 gap-x-4">
            <div className="sm:col-span-2 border-b border-slate-100 pb-1 mb-2 mt-1 font-bold text-navy text-sm">Identitas Siswa</div>
            <Field label="Nama Lengkap" required><input className="input" value={form.data.fullName} onChange={(e) => set('fullName', e.target.value)} /></Field>
            <Field label="Jenis Kelamin"><Select value={form.data.gender} onChange={(e) => set('gender', e.target.value)}>
              <option value="L">Laki-laki</option><option value="P">Perempuan</option></Select></Field>
            <Field label="Tempat Lahir"><Input value={form.data.birthPlace || ''} onChange={(e) => set('birthPlace', e.target.value)} /></Field>
            <Field label="Tanggal Lahir"><Input type="date" value={form.data.birthDate || ''} onChange={(e) => set('birthDate', e.target.value)} /></Field>

            <div className="sm:col-span-2 border-b border-slate-100 pb-1 mb-2 mt-3 font-bold text-navy text-sm">Pendidikan</div>
            <Field label="Jenjang Pendidikan"><Select value={form.data.educationLevel || ''} onChange={(e) => set('educationLevel', e.target.value)}>
              {['SD', 'SMP', 'SMA', 'TK'].map((l) => <option key={l} value={l}>{l}</option>)}</Select></Field>
            <Field label="Kelas Sekolah"><Input value={form.data.schoolGrade || ''} onChange={(e) => set('schoolGrade', e.target.value)} placeholder="mis. Kelas 5" /></Field>
            <Field label="Nama Sekolah"><Input value={form.data.schoolName || ''} onChange={(e) => set('schoolName', e.target.value)} /></Field>
            <Field label="Alamat"><Input value={form.data.address || ''} onChange={(e) => set('address', e.target.value)} /></Field>

            <div className="sm:col-span-2 border-b border-slate-100 pb-1 mb-2 mt-3 font-bold text-navy text-sm">Bimbel</div>
            <Field label="Program Bimbel"><Select value={form.data.programId || ''}
              onChange={(e) => {
                const pid = e.target.value;
                const p = programs.find((x) => String(x.id) === pid);
                setForm((f) => ({ ...f, data: { ...f.data, programId: pid, program: p ? p.name : '' } }));
              }}>
              <option value="">-- Pilih Program --</option>
              {programs.filter((p) => p.status === 'aktif' || p.id === form.data.programId).map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.duration_minutes} mnt, {p.sessions_per_month}×/bulan)</option>
              ))}</Select></Field>
            <Field label="Tanggal Mulai Bimbel"><Input type="date" value={form.data.startDate || ''} onChange={(e) => set('startDate', e.target.value)} /></Field>
            <Field label="Status Siswa"><Select value={form.data.status} onChange={(e) => set('status', e.target.value)}>
              <option value="aktif">Aktif</option><option value="cuti">Cuti</option><option value="berhenti">Berhenti</option></Select></Field>

            <div className="sm:col-span-2 border-b border-slate-100 pb-1 mb-2 mt-3 font-bold text-navy text-sm">Orang Tua / Wali</div>
            <Field label="Nama Orang Tua/Wali"><Input value={form.data.guardianName || ''} onChange={(e) => set('guardianName', e.target.value)} /></Field>
            <Field label="Hubungan"><Select value={form.data.guardianRelation || 'Orang Tua'} onChange={(e) => set('guardianRelation', e.target.value)}>
              {['Ayah', 'Ibu', 'Orang Tua', 'Wali', 'Lainnya'].map((x) => <option key={x}>{x}</option>)}</Select></Field>
            <Field label="Nomor WhatsApp"><Input value={form.data.guardianPhone || ''} onChange={(e) => set('guardianPhone', e.target.value)} placeholder="08xxxxxxxxxx" /></Field>
            <Field label="Pekerjaan"><Input value={form.data.guardianOccupation || ''} onChange={(e) => set('guardianOccupation', e.target.value)} /></Field>
          </div>
        )}
      </Modal>

      <Confirm open={!!confirm} onClose={() => setConfirm(null)} onConfirm={remove} loading={busy}
        title="Hapus / Arsipkan Siswa"
        message={`Anda yakin ingin menghapus siswa "${confirm?.fullName}"? Jika siswa memiliki riwayat absensi, transaksi, atau pembelajaran, sistem akan menonaktifkan (mengarsipkan) data demi keamanan riwayat, bukan menghapus permanen.`} />
    </div>
  );
}
