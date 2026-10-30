import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { get, post, put, del } from '../api';
import { PageHead, Table, Field, Input, Select, Modal, Confirm, Badge, useToast } from '../ui';
import { tgl, today } from '../format';

const empty = { fullName: '', idNumber: '', email: '', phone: '', address: '', education: '', expertise: '', joinDate: today(), status: 'aktif' };

export default function Tutors() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [form, setForm] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = ['sekretaris', 'direktur'].includes(user.role);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (status) q.set('status', status);
    get(`/tutors?${q}`).then((d) => setRows(d.data)).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [search, status]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const save = async () => {
    if (!form.data.fullName?.trim()) return toast.error('Nama lengkap wajib diisi.');
    setBusy(true);
    try {
      const d = form.mode === 'add' ? await post('/tutors', form.data) : await put(`/tutors/${form.data.id}`, form.data);
      toast.success(d.message);
      setForm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try {
      const d = await del(`/tutors/${confirm.id}`);
      toast.success(d.message); setConfirm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const set = (k, v) => setForm((f) => ({ ...f, data: { ...f.data, [k]: v } }));

  return (
    <div>
      <PageHead title="Data Tentor" desc={`Kelola data tentor & pengajar • ${rows.length} tentor`}
        actions={isAdmin && <button className="btn-primary" onClick={() => setForm({ mode: 'add', data: { ...empty } })}>+ Tambah Tentor</button>} />

      <div className="card p-4 mb-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <Input placeholder="Cari nama, ID, keahlian..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Semua Status</option><option value="aktif">Aktif</option><option value="nonaktif">Nonaktif</option>
          </Select>
          <button className="btn-outline" onClick={() => { setSearch(''); setStatus(''); }}>Reset Filter</button>
        </div>
      </div>

      <div className="card p-4">
        <Table loading={loading} rows={rows} empty="Tidak ada tentor."
          onRowClick={(r) => nav(`/tentor/${r.id}`)}
          columns={[
            { label: 'ID Internal', key: 'employeeId', className: 'font-mono text-xs' },
            { label: 'Nama Lengkap', render: (r) => (
              <div><div className="font-semibold text-navy">{r.fullName}</div>
              <div className="text-[11px] text-slate-400">{r.email || '-'}</div></div>
            )},
            { label: 'Keahlian / Mapel', render: (r) => <span className="text-xs">{r.expertise || '-'}</span> },
            { label: 'Pendidikan', render: (r) => <span className="text-xs">{r.education || '-'}</span> },
            { label: 'No. HP', render: (r) => <span className="text-xs">{r.phone || '-'}</span> },
            { label: 'Bergabung', render: (r) => tgl(r.joinDate) },
            { label: 'Status', render: (r) => <Badge status={r.status} /> },
            { label: 'Aksi', center: true, render: (r) => (
              <div className="flex gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
                <button className="btn-outline btn-sm" onClick={() => nav(`/tentor/${r.id}`)}>Detail</button>
                {isAdmin && <>
                  <button className="btn-outline btn-sm" onClick={() => setForm({ mode: 'edit', data: { ...empty, ...r } })}>Edit</button>
                  <button className="btn-outline btn-sm !text-red-600" onClick={() => setConfirm(r)}>Hapus</button>
                </>}
              </div>
            )},
          ]} />
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} wide
        title={form?.mode === 'add' ? 'Tambah Tentor' : `Edit Tentor: ${form?.data?.fullName || ''}`}
        footer={<>
          <button className="btn-outline" onClick={() => setForm(null)}>Batal</button>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button>
        </>}>
        {form && (
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Nama Lengkap" required><input className="input" value={form.data.fullName} onChange={(e) => set('fullName', e.target.value)} /></Field>
            <Field label="Nomor Identitas Internal"><Input value={form.data.employeeId || ''} onChange={(e) => set('employeeId', e.target.value)} disabled placeholder="Otomatis saat tambah" /></Field>
            <Field label="Email"><Input type="email" value={form.data.email || ''} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="Nomor HP"><Input value={form.data.phone || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Pendidikan Terakhir"><Input value={form.data.education || ''} onChange={(e) => set('education', e.target.value)} placeholder="mis. S.Pd. Matematika" /></Field>
            <Field label="Bidang Keahlian"><Input value={form.data.expertise || ''} onChange={(e) => set('expertise', e.target.value)} placeholder="mis. Matematika SD-SMA" /></Field>
            <Field label="Tanggal Bergabung"><Input type="date" value={form.data.joinDate || ''} onChange={(e) => set('joinDate', e.target.value)} /></Field>
            <Field label="Status"><Select value={form.data.status} onChange={(e) => set('status', e.target.value)}>
              <option value="aktif">Aktif</option><option value="nonaktif">Nonaktif</option></Select></Field>
            <div className="sm:col-span-2">
              <Field label="Alamat"><Input value={form.data.address || ''} onChange={(e) => set('address', e.target.value)} /></Field>
            </div>
          </div>
        )}
      </Modal>

      <Confirm open={!!confirm} onClose={() => setConfirm(null)} onConfirm={remove} loading={busy}
        title="Hapus / Nonaktifkan Tentor"
        message={`Tentor "${confirm?.fullName}" dengan jadwal/riwayat mengajar akan dinonaktifkan (termasuk akun loginnya), bukan dihapus, agar riwayat pembelajaran tetap utuh. Lanjutkan?`} />
    </div>
  );
}
