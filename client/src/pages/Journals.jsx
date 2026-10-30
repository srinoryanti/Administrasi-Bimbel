import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../auth';
import { get, post, put, del } from '../api';
import { PageHead, Table, Modal, Field, Input, Select, Textarea, Badge, useToast, Spinner, Tabs } from '../ui';
import { tgl, today } from '../format';

const empty = { journalDate: today(), classId: '', sessionId: '', material: '', objective: '', activities: '', outcomes: '', obstacles: '', assignments: '', nextPlan: '', status: 'terisi' };

export default function Journals() {
  const { user } = useAuth();
  const toast = useToast();
  const isTutor = user.role === 'tentor';
  const [tab, setTab] = useState('daftar');
  const [rows, setRows] = useState([]);
  const [classes, setClasses] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    Promise.all([
      get(`/journals?${q}`),
      get('/data/classes').catch(() => ({ data: [] })),
      isTutor ? get('/journals/pending').catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    ]).then(([j, c, p]) => { setRows(j.data); setClasses(c.data); setPending(p.data); })
      .catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [search]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const save = async () => {
    if (!form.data.classId) return toast.error('Pilih kelas.');
    if (!form.data.material.trim()) return toast.error('Materi yang diajarkan wajib diisi.');
    setBusy(true);
    try {
      const d = form.mode === 'add' ? await post('/journals', form.data) : await put(`/journals/${form.id}`, form.data);
      toast.success(d.message);
      setForm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    try { const d = await del(`/journals/${confirm.id}`); toast.success(d.message); setConfirm(null); load(); }
    catch (e) { toast.error(e.message); }
  };
  const set = (k, v) => setForm((f) => ({ ...f, data: { ...f.data, [k]: v } }));

  const myClasses = isTutor ? classes.filter((c) => c.tutorId === user.tutorId || true) : classes;

  return (
    <div>
      <PageHead title="Jurnal Mengajar" desc="Catatan pelaksanaan pembelajaran setelah pertemuan"
        actions={<button className="btn-primary" onClick={() => setForm({ mode: 'add', data: { ...empty } })}>+ Tulis Jurnal</button>} />

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'daftar', label: 'Semua Jurnal', count: rows.length },
        { key: 'belum', label: 'Belum Diisi', count: pending.length },
      ]} />

      {tab === 'belum' && (
        <div className="card p-4 mb-4">
          <p className="text-xs text-slate-500 mb-3">Pertemuan yang sudah berjalan tetapi belum memiliki jurnal{isTutor ? ' (hanya kelas tanggung jawab Anda)' : ''}.</p>
          {pending.length === 0 ? <p className="text-xs text-emerald-600 py-3">✓ Semua jurnal sudah dilengkapi.</p> : pending.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 border-b border-slate-50 py-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-navy">{p.class_name}</div>
                <div className="text-[11px] text-slate-400">{tgl(p.session_date)} • {p.start_time}–{p.end_time}</div>
              </div>
              <button className="btn-primary btn-sm" onClick={() => setForm({ mode: 'add', data: { ...empty, classId: p.class_id, sessionId: p.id, journalDate: p.session_date } })}>Tulis Jurnal</button>
            </div>
          ))}
        </div>
      )}

      <div className="card p-4 mb-4">
        <Input placeholder="Cari materi atau nama kelas..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="card p-4">
        <Table loading={loading} rows={rows} empty="Belum ada jurnal mengajar."
          columns={[
            { label: 'Tanggal', render: (r) => <span className="whitespace-nowrap font-semibold">{tgl(r.journal_date)}</span> },
            { label: 'Kelas', render: (r) => <div><div className="font-semibold">{r.class_name}</div><div className="text-[11px] text-slate-400">{r.subject_name || '-'}</div></div> },
            { label: 'Tentor', key: 'tutor_name' },
            { label: 'Materi', render: (r) => <span className="text-xs">{r.material}</span> },
            { label: 'Siswa', center: true, key: 'student_count' },
            { label: 'Status', render: (r) => <Badge status={r.status} /> },
            { label: 'Aksi', center: true, render: (r) => (
              <div className="flex gap-1 justify-center">
                <button className="btn-outline btn-sm" onClick={() => setForm({ mode: 'edit', id: r.id, data: { ...empty, ...r, classId: r.class_id, sessionId: r.session_id, journalDate: r.journal_date, objective: r.objective, activities: r.activities, outcomes: r.outcomes, obstacles: r.obstacles, assignments: r.assignments, nextPlan: r.next_plan } })}>Lihat/Edit</button>
                {['direktur', 'sekretaris'].includes(user.role) && (
                  <button className="btn-outline btn-sm !text-red-600" onClick={() => setConfirm(r)}>Hapus</button>
                )}
              </div>
            )},
          ]} />
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} wide
        title={form?.mode === 'add' ? 'Tulis Jurnal Mengajar' : 'Edit Jurnal Mengajar'}
        footer={<><button className="btn-outline" onClick={() => setForm(null)}>Batal</button>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Jurnal'}</button></>}>
        {form && (
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Tanggal" required><Input type="date" value={form.data.journalDate} onChange={(e) => set('journalDate', e.target.value)} /></Field>
            <Field label="Kelas" required><Select value={form.data.classId} onChange={(e) => set('classId', e.target.value)} disabled={form.mode === 'edit'}>
              <option value="">-- Pilih --</option>
              {myClasses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <div className="sm:col-span-2">
              <Field label="Materi yang Diajarkan" required><Input value={form.data.material} onChange={(e) => set('material', e.target.value)} placeholder="mis. Pecahan dan operasinya" /></Field>
            </div>
            <div className="sm:col-span-2"><Field label="Tujuan Pembelajaran"><Textarea value={form.data.objective} onChange={(e) => set('objective', e.target.value)} /></Field></div>
            <Field label="Aktivitas Pembelajaran"><Textarea value={form.data.activities} onChange={(e) => set('activities', e.target.value)} /></Field>
            <Field label="Hasil Pembelajaran"><Textarea value={form.data.outcomes} onChange={(e) => set('outcomes', e.target.value)} /></Field>
            <Field label="Kendala Siswa"><Textarea value={form.data.obstacles} onChange={(e) => set('obstacles', e.target.value)} /></Field>
            <Field label="Tugas / Latihan"><Textarea value={form.data.assignments} onChange={(e) => set('assignments', e.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="Rencana Pertemuan Berikutnya"><Textarea value={form.data.nextPlan} onChange={(e) => set('nextPlan', e.target.value)} /></Field></div>
            <Field label="Status"><Select value={form.data.status} onChange={(e) => set('status', e.target.value)}>
              <option value="terisi">Terisi</option><option value="draf">Draf</option></Select></Field>
          </div>
        )}
      </Modal>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Hapus Jurnal"
        footer={<><button className="btn-outline" onClick={() => setConfirm(null)}>Batal</button>
          <button className="btn-danger" onClick={remove}>Hapus</button></>}>
        <p className="text-sm">Hapus jurnal "{confirm?.material}" tanggal {tgl(confirm?.journal_date)}? Tindakan tercatat pada riwayat aktivitas.</p>
      </Modal>
    </div>
  );
}
