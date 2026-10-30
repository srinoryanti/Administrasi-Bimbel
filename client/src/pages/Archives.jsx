import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../auth';
import { get, put } from '../api';
import { PageHead, Table, Modal, Field, Input, Select, Textarea, Badge, useToast, Spinner } from '../ui';
import { tgl, today } from '../format';

const empty = { docName: '', docNumber: '', category: 'Arsip administrasi', description: '', docDate: today(), studentId: '', tutorId: '' };

export default function Archives() {
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('daftar');
  const [rows, setRows] = useState([]);
  const [cats, setCats] = useState([]);
  const [students, setStudents] = useState([]);
  const [years, setYears] = useState([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ search: '', category: '', year: '' });
  const [form, setForm] = useState(null);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState(null);
  const [grouped, setGrouped] = useState({});

  const isAdmin = ['sekretaris', 'direktur'].includes(user.role);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (f.search) q.set('search', f.search);
    if (f.category) q.set('category', f.category);
    if (f.year) q.set('year', f.year);
    get(`/archives?${q}`).then((d) => {
      setRows(d.data);
      const g = {};
      d.data.forEach((r) => { const y = r.year || 'Tanpa Tahun'; (g[y] ||= []).push(r); });
      setGrouped(g);
    }).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [f]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => {
    get('/archives/categories').then((d) => setCats(d.data)).catch(() => {});
    get('/archives/years').then((d) => setYears(d.data)).catch(() => {});
    get('/students?status=aktif').then((d) => setStudents(d.data)).catch(() => {});
  }, []);

  const upload = async () => {
    if (!file) return toast.error('Pilih berkas terlebih dahulu.');
    if (!form.data.docName.trim()) return toast.error('Nama dokumen wajib diisi.');
    if (file.size > 10 * 1024 * 1024) return toast.error('Ukuran file maksimal 10 MB.');
    const fd = new FormData();
    Object.entries(form.data).forEach(([k, v]) => { if (v !== '' && v != null) fd.append(k, v); });
    fd.append('file', file);
    setBusy(true);
    try {
      const d = await apiUpload('/archives', fd);
      toast.success(d.message);
      setForm(null); setFile(null); load();
      setYears((await get('/archives/years')).data);
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const showVersions = async (r) => {
    try {
      const d = await get(`/archives/${r.id}/versions`);
      setVersions({ row: r, list: d.data });
    } catch (e) { toast.error(e.message); }
  };

  const saveMeta = async () => {
    setBusy(true);
    try {
      const r = await put(`/archives/${form.data.id}`, {
        docName: form.data.docName, docNumber: form.data.docNumber, category: form.data.category,
        description: form.data.description, docDate: form.data.docDate, status: form.data.status,
        studentId: form.data.studentId || null, tutorId: form.data.tutorId || null,
      });
      toast.success(r.message);
      setForm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const set = (k, v) => setForm((f) => ({ ...f, data: { ...f.data, [k]: v } }));

  return (
    <div>
      <PageHead title="Arsip Digital" desc="Dokumen bimbel: siswa, tentor, administrasi, surat, keuangan, rapor"
        actions={isAdmin && <button className="btn-primary" onClick={() => { setForm({ data: { ...empty } }); setFile(null); }}>Unggah Dokumen</button>} />

      <div className="card p-4 mb-4 grid sm:grid-cols-4 gap-3">
        <Input placeholder="Cari nama/kode/no. dokumen..." value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        <Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          <option value="">Semua Kategori</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}>
          <option value="">Semua Tahun</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        <button className="btn-outline" onClick={() => setF({ search: '', category: '', year: '' })}>Reset</button>
      </div>

      <div className="card p-4">
        {loading ? <Spinner /> : tab === 'daftar' ? (
          <Table rows={rows} empty="Tidak ada dokumen untuk filter ini."
            columns={[
              { label: 'Kode', render: (r) => <span className="font-mono text-xs">{r.docCode}</span> },
              { label: 'Dokumen', render: (r) => (
                <div className="min-w-0"><div className="font-semibold text-navy">{r.docName}</div>
                  <div className="text-[11px] text-slate-400 truncate">{r.fileName} • {(r.fileSize / 1024).toFixed(1)} KB</div></div>
              )},
              { label: 'Kategori', render: (r) => <span className="text-xs">{r.category}</span> },
              { label: 'No. Dokumen', render: (r) => <span className="text-xs">{r.docNumber || '-'}</span> },
              { label: 'Tanggal', render: (r) => tgl(r.docDate) },
              { label: 'Versi', center: true, render: (r) => <span className="text-xs font-bold">v{r.version}</span> },
              { label: 'Pengunggah', render: (r) => <span className="text-xs">{r.uploaderName || '-'}</span> },
              { label: 'Status', render: (r) => <Badge status={r.status === 'aktif' ? 'aktif' : 'berhenti'} children={r.status} /> },
              { label: 'Aksi', center: true, render: (r) => (
                <div className="flex gap-1 justify-center flex-wrap">
                  <a className="btn-outline btn-sm" href={`/api/archives/${r.id}/download?inline=1`} target="_blank" rel="noreferrer">Lihat</a>
                  <a className="btn-outline btn-sm" href={`/api/archives/${r.id}/download`} onClick={() => {}}>Unduh</a>
                  <button className="btn-outline btn-sm" onClick={() => showVersions(r)}>v{r.version}</button>
                  {isAdmin && <button className="btn-outline btn-sm" onClick={() => setForm({ data: { ...empty, ...r, studentId: r.studentId || '', tutorId: r.tutorId || '' } })}>Edit</button>}
                </div>
              )},
            ]} />
        ) : (
          <div>
            {Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0])).map(([y, items]) => (
              <div key={y} className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="bg-navy text-white text-xs font-bold px-3 py-1 rounded-full">{y}</span>
                  <span className="text-xs text-slate-400">{items.length} dokumen</span>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map((r) => (
                    <div key={r.id} className="border border-slate-200 rounded-xl p-3 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-[10px] font-bold text-slate-400 uppercase bg-slate-100 rounded px-1.5 py-0.5 shrink-0">{(r.fileName.split('.').pop() || 'file').toUpperCase()}</div>
                        <Badge status={r.status === 'aktif' ? 'aktif' : 'berhenti'} children={r.status} />
                      </div>
                      <div className="font-semibold text-sm text-navy mt-2 line-clamp-2">{r.docName}</div>
                      <div className="text-[11px] text-slate-400">{r.category} • v{r.version} • {tgl(r.docDate)}</div>
                      <div className="flex gap-1 mt-2">
                        <a className="btn-outline btn-sm flex-1" href={`/api/archives/${r.id}/download?inline=1`} target="_blank" rel="noreferrer">Buka</a>
                        <a className="btn-outline btn-sm flex-1" href={`/api/archives/${r.id}/download`}>Unduh</a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <button className={`btn-sm ${tab === 'daftar' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('daftar')}>Tabel</button>
          <button className={`btn-sm ${tab === 'tahun' ? 'btn-primary' : 'btn-outline'}`} onClick={() => setTab('tahun')}>Kelompokkan per Tahun</button>
        </div>
      </div>

      {/* Upload / edit modal */}
      <Modal open={!!form} onClose={() => setForm(null)} wide
        title={form?.data?.id ? 'Edit Metadata Dokumen' : 'Unggah Dokumen Baru'}
        footer={<><button className="btn-outline" onClick={() => setForm(null)}>Batal</button>
          <button className="btn-primary" onClick={form?.data?.id ? saveMeta : upload} disabled={busy}>
            {busy ? 'Menyimpan...' : form?.data?.id ? 'Simpan Perubahan' : 'Unggah'}
          </button></>}>
        {form && (
          <div className="grid sm:grid-cols-2 gap-x-4">
            <div className="sm:col-span-2"><Field label="Nama Dokumen" required><input className="input" value={form.data.docName} onChange={(e) => set('docName', e.target.value)} /></Field></div>
            <Field label="Kategori" required><Select value={form.data.category} onChange={(e) => set('category', e.target.value)}>
              {cats.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Nomor Dokumen"><Input value={form.data.docNumber || ''} onChange={(e) => set('docNumber', e.target.value)} /></Field>
            <Field label="Tanggal Dokumen"><Input type="date" value={form.data.docDate || ''} onChange={(e) => set('docDate', e.target.value)} /></Field>
            <Field label="Kaitkan ke Siswa (opsional)"><Select value={form.data.studentId} onChange={(e) => set('studentId', e.target.value)}>
              <option value="">-- Tidak dikaitkan --</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}</Select></Field>
            <div className="sm:col-span-2"><Field label="Deskripsi"><Textarea value={form.data.description || ''} onChange={(e) => set('description', e.target.value)} /></Field></div>
            {!form.data.id && (
              <div className="sm:col-span-2">
                <Field label="Berkas (PDF/Gambar/Office, maks 10 MB)" required>
                  <input type="file" className="input" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
                    onChange={(e) => setFile(e.target.files[0] || null)} />
                </Field>
                {file && <p className="text-xs text-slate-500">Dipilih: {file.name} ({(file.size / 1024).toFixed(1)} KB)</p>}
                <p className="text-[11px] text-slate-400 mt-1">File disimpan pada folder penyimpanan internal (di luar folder publik) dan hanya dapat diunduh melalui endpoint terproteksi.</p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Versi */}
      <Modal open={!!versions} onClose={() => setVersions(null)} title={`Riwayat Versi — ${versions?.row?.docName || ''}`}
        footer={<button className="btn-outline" onClick={() => setVersions(null)}>Tutup</button>}>
        {versions && (versions.list.length === 0 ? (
          <p className="text-sm text-slate-500">Dokumen ini baru memiliki satu versi (belum pernah diganti).</p>
        ) : (
          <ul className="space-y-2">
            {versions.list.map((v) => (
              <li key={v.id} className="border border-slate-200 rounded-lg p-3 text-sm">
                <div className="flex justify-between"><b>Versi {v.version}</b><span className="text-xs text-slate-400">{v.created_at}</span></div>
                <div className="text-xs text-slate-500">{v.file_name} • {(v.file_size / 1024).toFixed(1)} KB</div>
                <div className="text-xs text-slate-500">Catatan: {v.note || '-'}</div>
              </li>
            ))}
          </ul>
        ))}
      </Modal>
    </div>
  );
}

async function apiUpload(path, formData) {
  const res = await fetch(`/api${path}`, { method: 'POST', body: formData, credentials: 'include' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Gagal mengunggah berkas.');
  return data;
}
