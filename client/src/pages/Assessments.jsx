import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../auth';
import { get, post } from '../api';
import { PageHead, Table, Modal, Field, Input, Select, Textarea, Badge, useToast, Spinner } from '../ui';
import { tgl, today } from '../format';

export default function Assessments() {
  const { user } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [students, setStudents] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ studentId: '', subjectId: '', period: '' });
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (f.studentId) q.set('studentId', f.studentId);
    if (f.subjectId) q.set('subjectId', f.subjectId);
    if (f.period) q.set('period', f.period);
    get(`/assessments?${q}`).then((d) => setRows(d.data)).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [f]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    get('/students?status=aktif').then((d) => setStudents(d.data)).catch(() => {});
    get('/catalog/subjects').then((d) => setSubjects(d.data)).catch(() => {});
    get('/catalog/report-periods').then((d) => setPeriods(d.data)).catch(() => {});
  }, []);

  const periodLabels = [...new Set([...rows.map((r) => r.periodLabel), ...periods.map((p) => p.name)])].filter(Boolean);

  // Mapel yang boleh dinilai untuk seorang siswa = mapel programnya.
  // Siswa tanpa program / mapel tanpa program = umum (ikut ditampilkan).
  const subjectsForStudent = (studentId) => {
    const st = students.find((s) => String(s.id) === String(studentId));
    if (!st?.programId) return subjects;
    return subjects.filter((s) => !s.programIds?.length || s.programIds.includes(st.programId));
  };

  const openNew = (r) => {
    if (r) setForm({ mode: 'edit', id: r.id, data: { ...r, correctionNote: '' } });
    else setForm({ mode: 'add', data: { studentId: '', subjectId: '', periodLabel: periods[0]?.name || `${new Date().toLocaleString('id-ID', { month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' })}`, initialScore: '', taskScore: '', practiceScore: '', finalScore: '', notes: '', initialCondition: '', correctionNote: '' } });
  };

  const onPickStudent = (studentId) => {
    setForm((f) => {
      const allowed = subjectsForStudent(studentId).map((s) => String(s.id));
      const subjectId = f.data.subjectId && allowed.includes(String(f.data.subjectId)) ? f.data.subjectId : '';
      return { ...f, data: { ...f.data, studentId, subjectId } };
    });
  };

  const pickedStudent = students.find((s) => String(s.id) === String(form?.data?.studentId));
  const formSubjects = form?.mode === 'edit' ? subjects : subjectsForStudent(form?.data?.studentId);

  const save = async () => {
    const d = form.data;
    if (!d.studentId || !d.subjectId || !d.periodLabel) return toast.error('Siswa, mata pelajaran, dan periode wajib diisi.');
    setBusy(true);
    try {
      const payload = {
        studentId: Number(d.studentId), subjectId: Number(d.subjectId), periodId: d.periodId || null, periodLabel: d.periodLabel,
        initialScore: d.initialScore === '' || d.initialScore == null ? null : Number(d.initialScore),
        taskScore: d.taskScore === '' || d.taskScore == null ? null : Number(d.taskScore),
        practiceScore: d.practiceScore === '' || d.practiceScore == null ? null : Number(d.practiceScore),
        finalScore: d.finalScore === '' || d.finalScore == null ? null : Number(d.finalScore),
        notes: d.notes || null, initialCondition: d.initialCondition || null, correctionNote: d.correctionNote || null,
      };
      const r = await post('/assessments', payload);
      toast.success(r.message);
      setForm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const set = (k, v) => setForm((f) => ({ ...f, data: { ...f.data, [k]: v } }));
  const sekretarisKoreksi = user.role === 'sekretaris';

  return (
    <div>
      <PageHead title="Nilai & Evaluasi Siswa" desc="Penilaian per siswa, mata pelajaran, dan periode"
        actions={<button className="btn-primary" onClick={() => openNew(null)}>+ Input Nilai</button>} />

      <div className="card p-4 mb-4 grid sm:grid-cols-4 gap-3">
        <Select value={f.studentId} onChange={(e) => setF({ ...f, studentId: e.target.value })}>
          <option value="">Semua Siswa</option>
          {students.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
        </Select>
        <Select value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })}>
          <option value="">Semua Mata Pelajaran</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>
          <option value="">Semua Periode</option>
          {periodLabels.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        <button className="btn-outline" onClick={() => setF({ studentId: '', subjectId: '', period: '' })}>Reset</button>
      </div>

      <div className="card p-4">
        <Table loading={loading} rows={rows} empty="Belum ada nilai untuk filter ini."
          columns={[
            { label: 'Periode', render: (r) => <span className="whitespace-nowrap">{r.periodLabel}</span> },
            { label: 'Siswa', render: (r) => <div><div className="font-semibold">{r.studentName}</div><div className="text-[11px] text-slate-400">{r.nis}</div></div> },
            { label: 'Mata Pelajaran', key: 'subjectName' },
            { label: 'Awal', center: true, render: (r) => r.initialScore ?? <span className="text-amber-600 text-[11px]">belum ada data</span> },
            { label: 'Tugas', center: true, key: 'taskScore' },
            { label: 'Latihan', center: true, key: 'practiceScore' },
            { label: 'Akhir', center: true, render: (r) => <b className="text-navy">{r.finalScore ?? '-'}</b> },
            { label: 'Catatan', render: (r) => <span className="text-xs text-slate-500">{r.notes || '-'}</span> },
            { label: 'Aksi', center: true, render: (r) => <button className="btn-outline btn-sm" onClick={() => openNew(r)}>Edit</button> },
          ]} />
        <div className="mt-3 text-[11px] text-slate-500 bg-slate-50 rounded-lg p-3 leading-relaxed">
          <b>Kebijakan koreksi nilai:</b> {sekretarisKoreksi
            ? 'sebagai sekretaris, setiap perubahan nilai wajib disertai catatan koreksi dan tercatat pada riwayat aktivitas (tidak dapat diam-diam).'
            : 'perubahan nilai oleh tentor tercatat otomatis dalam riwayat aktivitas beserta nilai lama → baru. Nilai tidak dibuat otomatis tanpa data.'}
        </div>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} wide
        title={form?.mode === 'edit' ? 'Edit / Koreksi Nilai' : 'Input Nilai & Evaluasi'}
        footer={<><button className="btn-outline" onClick={() => setForm(null)}>Batal</button>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Nilai'}</button></>}>
        {form && (
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Siswa" required><Select value={form.data.studentId} onChange={(e) => onPickStudent(e.target.value)} disabled={form.mode === 'edit'}>
              <option value="">-- Pilih Siswa --</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.nis}){s.program ? ` — ${s.program}` : ''}</option>)}</Select></Field>
            <Field label="Mata Pelajaran" required hint={pickedStudent?.program ? `Disesuaikan dengan program ${pickedStudent.program}` : undefined}>
              <Select value={form.data.subjectId} onChange={(e) => set('subjectId', e.target.value)} disabled={form.mode === 'edit'}>
              <option value="">-- Pilih --</option>
              {formSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
              {form.mode !== 'edit' && pickedStudent?.program && formSubjects.length === 0 && (
                <span className="text-[10px] text-amber-600">Belum ada mata pelajaran untuk program ini — hubungi sekretaris untuk mengaturnya di menu Program.</span>
              )}
            </Field>
            <div className="sm:col-span-2">
              <Field label="Periode (mis. Oktober 2026)" required><Input value={form.data.periodLabel} onChange={(e) => set('periodLabel', e.target.value)} list="periode-list" />
                <datalist id="periode-list">{periods.map((p) => <option key={p.id} value={p.name} />)}</datalist>
              </Field>
            </div>
            <Field label="Nilai Awal (0–100, opsional)" hint="Kosongkan bila data belum tersedia"><Input type="number" min="0" max="100" value={form.data.initialScore ?? ''} onChange={(e) => set('initialScore', e.target.value)} /></Field>
            <Field label="Nilai Tugas (0–100)"><Input type="number" min="0" max="100" value={form.data.taskScore ?? ''} onChange={(e) => set('taskScore', e.target.value)} /></Field>
            <Field label="Nilai Latihan/Evaluasi (0–100)"><Input type="number" min="0" max="100" value={form.data.practiceScore ?? ''} onChange={(e) => set('practiceScore', e.target.value)} /></Field>
            <Field label="Nilai Akhir Periode (0–100)"><Input type="number" min="0" max="100" value={form.data.finalScore ?? ''} onChange={(e) => set('finalScore', e.target.value)} /></Field>
            <div className="sm:col-span-2"><Field label="Kondisi Awal Masuk" hint="Kondisi siswa saat mulai — ditampilkan pada kolom “Kondisi Awal Masuk” di Laporan Perkembangan Belajar">
              <Textarea value={form.data.initialCondition || ''} onChange={(e) => set('initialCondition', e.target.value)} placeholder="mis. Memahami penjumlahan dan pengurangan dasar, pembagian belum dikuasai." /></Field></div>
            <div className="sm:col-span-2"><Field label="Ketercapaian / Catatan Perkembangan" hint="Ditampilkan pada kolom “Ketercapaian” di Laporan Perkembangan Belajar"><Textarea value={form.data.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field></div>
            {form.mode === 'edit' && (
              <div className="sm:col-span-2">
                <Field label={sekretarisKoreksi ? 'Catatan Koreksi (WAJIB untuk sekretaris)' : 'Catatan Koreksi (opsional)'} required={sekretarisKoreksi}
                  hint="Tercatat pada audit log: nilai lama → nilai baru">
                  <Input value={form.data.correctionNote || ''} onChange={(e) => set('correctionNote', e.target.value)} placeholder="mis. Koreksi nilai latihan sesuai lembar jawaban" />
                </Field>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
