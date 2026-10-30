import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../auth';
import { get, post, put, del } from '../api';
import { PageHead, Table, Field, Input, Select, Modal, Confirm, Badge, useToast } from '../ui';

const emptyForm = { code: '', name: '', targetLevel: '', durationMinutes: 90, sessionsPerMonth: 12, price: 0, description: '', status: 'aktif' };
const JENJANG = ['', 'TK/RA', 'SD/MI', 'SMP', 'SMA'];

export default function Programs() {
  const { user } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [subjForm, setSubjForm] = useState(null); // { id, name, selected: Set<number> }
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = user.role === 'sekretaris' || user.role === 'direktur';
  const isDirector = user.role === 'direktur';

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      get('/catalog/programs'),
      get('/catalog/subjects').catch(() => ({ data: [] })),
    ]).then(([p, s]) => { setRows(p.data); setSubjects(s.data); })
      .catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm((f) => ({ ...f, data: { ...f.data, [k]: v } }));

  const save = async () => {
    const d = form.data;
    if (!d.name?.trim()) return toast.error('Nama program wajib diisi.');
    if (!Number(d.durationMinutes) || Number(d.durationMinutes) < 15) return toast.error('Durasi minimal 15 menit.');
    if (!Number(d.sessionsPerMonth) || Number(d.sessionsPerMonth) < 1) return toast.error('Pertemuan/bulan minimal 1.');
    setBusy(true);
    try {
      const payload = {
        ...d,
        durationMinutes: Number(d.durationMinutes),
        sessionsPerMonth: Number(d.sessionsPerMonth),
        price: Number(d.price) || 0,
      };
      const r = form.mode === 'add' ? await post('/catalog/programs', payload) : await put(`/catalog/programs/${d.id}`, payload);
      toast.success(r.message);
      setForm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const r = await del(`/catalog/programs/${confirm.id}`);
      toast.success(r.message);
      setConfirm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const saveSubjects = async () => {
    setBusy(true);
    try {
      const r = await put(`/catalog/programs/${subjForm.id}/subjects`, { subjectIds: [...subjForm.selected] });
      toast.success(r.message);
      setSubjForm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const toggleSubject = (sid) => setSubjForm((f) => {
    const selected = new Set(f.selected);
    if (selected.has(sid)) selected.delete(sid); else selected.add(sid);
    return { ...f, selected };
  });

  const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

  return (
    <div>
      <PageHead title="Program Bimbel" desc="Master program belajar: durasi, kuota pertemuan/bulan, dan biaya"
        actions={isAdmin && <button className="btn-primary" onClick={() => setForm({ mode: 'add', data: { ...emptyForm } })}>+ Program Baru</button>} />

      <div className="card p-3 sm:p-4">
        <Table loading={loading} rows={rows} empty="Belum ada program. Tambahkan program bimbel (mis. Calistung, Reguler A, Reguler B)."
          columns={[
            { label: 'Kode', key: 'code', className: 'font-mono text-xs' },
            { label: 'Nama Program', render: (r) => (
              <div>
                <div className="font-semibold text-navy">{r.name}</div>
                {r.description && <div className="text-[11px] text-slate-400">{r.description}</div>}
              </div>
            )},
            { label: 'Jenjang', center: true, render: (r) => r.target_level || <span className="text-slate-400 text-xs">Semua</span> },
            { label: 'Durasi', center: true, render: (r) => `${r.duration_minutes} mnt` },
            { label: 'Sesi/Bulan', center: true, render: (r) => <b className="text-navy">{r.sessions_per_month}×</b> },
            { label: 'Biaya/Bulan', center: true, render: (r) => <span className="text-xs whitespace-nowrap">{rupiah(r.price)}</span> },
            { label: 'Mata Pelajaran', render: (r) => (
              <div className="flex flex-wrap gap-1">
                {(r.subjects || []).length ? r.subjects.map((s) => (
                  <span key={s.id} className="text-[10px] bg-slate-100 text-slate-600 rounded px-1.5 py-0.5 whitespace-nowrap">{s.name}</span>
                )) : <span className="text-[11px] text-slate-400">belum diatur</span>}
              </div>
            )},
            { label: 'Status', render: (r) => <Badge status={r.status} /> },
            { label: 'Aksi', center: true, render: (r) => (
              isAdmin && (
                <div className="flex gap-1 justify-center">
                  <button className="btn-outline btn-sm" onClick={() => setSubjForm({ id: r.id, name: r.name, selected: new Set((r.subjects || []).map((s) => s.id)) })}>Mapel</button>
                  <button className="btn-outline btn-sm" onClick={() => setForm({ mode: 'edit', data: { ...emptyForm, ...r, targetLevel: r.target_level || '' } })}>Edit</button>
                  {isDirector && <button className="btn-outline btn-sm !text-red-600" onClick={() => setConfirm(r)}>Hapus</button>}
                </div>
              )
            )},
          ]} />
      </div>

      <p className="text-xs text-slate-400 mt-3">
        Catatan: <b>Durasi</b> dipakai untuk menghitung jam selesai jadwal otomatis; <b>Sesi/Bulan</b> menjadi target
        generate pertemuan bulanan (mis. 12× = 12 pertemuan wajib/bulan); <b>Biaya</b> menjadi acuan prefill tagihan.
        <b> Mata Pelajaran</b> menentukan mapel yang boleh dinilai untuk siswa program ini (mis. Calistung → Membaca, Menulis, Berhitung).
        Program yang masih dipakai siswa/kelas akan dinonaktifkan, bukan dihapus, agar riwayat tetap utuh.
      </p>

      <Modal open={!!subjForm} onClose={() => setSubjForm(null)}
        title={`Mata Pelajaran Program: ${subjForm?.name || ''}`}
        footer={<>
          <button className="btn-outline" onClick={() => setSubjForm(null)}>Batal</button>
          <button className="btn-primary" onClick={saveSubjects} disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Mapel'}</button>
        </>}>
        {subjForm && (
          <div>
            <p className="text-xs text-slate-500 mb-3">Centang mata pelajaran yang berlaku untuk siswa program ini —
              hanya mapel tercentang yang muncul saat menginput nilai.</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {subjects.map((s) => (
                <label key={s.id} className={`flex items-center gap-2 border rounded-lg px-3 py-2 cursor-pointer text-sm ${subjForm.selected.has(s.id) ? 'border-navy bg-navy/5' : 'border-slate-200'}`}>
                  <input type="checkbox" checked={subjForm.selected.has(s.id)} onChange={() => toggleSubject(s.id)} className="accent-navy" />
                  <span>{s.name}</span>
                  <span className="ml-auto text-[10px] text-slate-400 font-mono">{s.code}</span>
                </label>
              ))}
            </div>
            {!subjects.length && <p className="text-sm text-slate-400">Belum ada mata pelajaran. Tambahkan melalui API /catalog/subjects.</p>}
          </div>
        )}
      </Modal>

      <Modal open={!!form} onClose={() => setForm(null)}
        title={form?.mode === 'add' ? 'Tambah Program Baru' : `Edit Program: ${form?.data?.name || ''}`}
        footer={<>
          <button className="btn-outline" onClick={() => setForm(null)}>Batal</button>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Program'}</button>
        </>}>
        {form && (
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Kode Program" ><Input value={form.data.code || ''} onChange={(e) => set('code', e.target.value)} placeholder="otomatis bila kosong" /></Field>
            <Field label="Nama Program" required><Input value={form.data.name} onChange={(e) => set('name', e.target.value)} placeholder="mis. Reguler A" /></Field>
            <Field label="Jenjang Sasaran"><Select value={form.data.targetLevel || ''} onChange={(e) => set('targetLevel', e.target.value)}>
              {JENJANG.map((j) => <option key={j} value={j}>{j || 'Semua jenjang'}</option>)}</Select></Field>
            <Field label="Status"><Select value={form.data.status} onChange={(e) => set('status', e.target.value)}>
              <option value="aktif">Aktif</option><option value="nonaktif">Nonaktif</option></Select></Field>
            <Field label="Durasi per Pertemuan (menit)" required>
              <Input type="number" min="15" step="5" value={form.data.durationMinutes} onChange={(e) => set('durationMinutes', e.target.value)} />
            </Field>
            <Field label="Pertemuan per Bulan (kuota)" required>
              <Input type="number" min="1" max="62" value={form.data.sessionsPerMonth} onChange={(e) => set('sessionsPerMonth', e.target.value)} />
            </Field>
            <Field label="Biaya per Bulan (Rp)"><Input type="number" min="0" step="5000" value={form.data.price} onChange={(e) => set('price', e.target.value)} /></Field>
            <div className="sm:col-span-2">
              <Field label="Keterangan"><Input value={form.data.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="mis. 90 menit, 12 pertemuan/bulan" /></Field>
            </div>
          </div>
        )}
      </Modal>

      <Confirm open={!!confirm} onClose={() => setConfirm(null)} onConfirm={remove} loading={busy}
        title="Hapus Program"
        message={`Hapus program "${confirm?.name}"? Jika program masih dipakai siswa/kelas, program akan dinonaktifkan agar riwayat absensi, tagihan, dan rapor tetap utuh.`} />
    </div>
  );
}
