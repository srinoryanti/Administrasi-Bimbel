import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../auth';
import { get, post, put, del } from '../api';
import { PageHead, Tabs, Table, Modal, Field, Input, Select, Badge, useToast, Confirm, Spinner } from '../ui';
import { HARI, tgl, today, hariPendek } from '../format';

const emptyClass = { name: '', level: 'SD', programId: '', subjectId: '', type: 'kelompok', tutorId: '', location: '', capacity: 12, status: 'aktif' };
const emptySched = { classId: '', tutorId: '', dayOfWeek: 1, startTime: '15:30', endTime: '17:00', location: '' };

function addMins(t, mins) {
  const [h, m] = String(t || '').split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(mins)) return '';
  const total = (h * 60 + m + Number(mins)) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function Schedules() {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = ['sekretaris', 'direktur'].includes(user.role);
  const [tab, setTab] = useState('kelas');
  const [classes, setClasses] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [tutors, setTutors] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [clsForm, setClsForm] = useState(null);
  const [schedForm, setSchedForm] = useState(null);
  const [detail, setDetail] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState([]);
  const [genForm, setGenForm] = useState(false);
  const [quotaMonth, setQuotaMonth] = useState(() => today().slice(0, 7));

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    Promise.all([
      get(`/data/classes?${q}`),
      get('/data/schedules'),
      get('/catalog/subjects').catch(() => ({ data: [] })),
      get('/catalog/programs').catch(() => ({ data: [] })),
      get('/tutors').catch(() => ({ data: [] })),
    ]).then(([c, s, sub, pg, t]) => {
      setClasses(c.data); setSchedules(s.data); setSubjects(sub.data); setPrograms(pg.data); setTutors(t.data);
    }).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [search]);
  useEffect(() => { const tt = setTimeout(load, 250); return () => clearTimeout(tt); }, [load]);

  const saveClass = async () => {
    if (!clsForm.data.name?.trim()) return toast.error('Nama kelas wajib diisi.');
    setBusy(true);
    try {
      const payload = {
        ...clsForm.data,
        programId: clsForm.data.programId ? Number(clsForm.data.programId) : null,
        subjectId: clsForm.data.subjectId ? Number(clsForm.data.subjectId) : null,
        tutorId: clsForm.data.tutorId ? Number(clsForm.data.tutorId) : null,
      };
      const d = clsForm.mode === 'add' ? await post('/data/classes', payload) : await put(`/data/classes/${clsForm.id}`, payload);
      toast.success(d.message);
      setClsForm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const saveSched = async () => {
    const payload = { ...schedForm.data, tutorId: Number(schedForm.data.tutorId), classId: Number(schedForm.data.classId), dayOfWeek: Number(schedForm.data.dayOfWeek) };
    setBusy(true); setConflict([]);
    try {
      const d = schedForm.mode === 'add'
        ? await post('/data/schedules', payload)
        : await put(`/data/schedules/${schedForm.id}`, payload);
      toast.success(d.message);
      setSchedForm(null); load();
    } catch (e) {
      setConflict([e.message]);
      toast.error(e.message);
    } finally { setBusy(false); }
  };

  const checkConflict = async (d) => {
    if (!d.tutorId || d.dayOfWeek === undefined || !d.startTime || !d.endTime) return;
    try {
      const r = await post('/data/schedules/check', { ...d, classId: d.classId || null, tutorId: Number(d.tutorId), dayOfWeek: Number(d.dayOfWeek) });
      setConflict(r.conflicts);
    } catch (e) { setConflict([e.message]); }
  };

  const doConfirm = async () => {
    setBusy(true);
    try {
      let d;
      if (confirm.kind === 'class') d = await del(`/data/classes/${confirm.id}`);
      if (confirm.kind === 'sched') d = await del(`/data/schedules/${confirm.id}`);
      toast.success(d.message);
      setConfirm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const setCls = (k, v) => setClsForm((f) => ({ ...f, data: { ...f.data, [k]: v } }));
  const setSched = (k, v) => setSchedForm((f) => ({ ...f, data: { ...f.data, [k]: v } }));

  // Mapel form kelas disaring sesuai program yang dipilih (mapel tanpa program = umum).
  const clsSubjects = (() => {
    const pid = clsForm?.data?.programId ? Number(clsForm.data.programId) : null;
    if (!pid) return subjects;
    return subjects.filter((s) => !s.programIds?.length || s.programIds.includes(pid));
  })();
  const onPickProgram = (pid) => {
    setClsForm((f) => {
      const allowed = (!pid ? subjects : subjects.filter((s) => !s.programIds?.length || s.programIds.includes(Number(pid)))).map((s) => String(s.id));
      const subjectId = f.data.subjectId && allowed.includes(String(f.data.subjectId)) ? f.data.subjectId : '';
      const data = { ...f.data, programId: pid, subjectId };
      const p = programs.find((x) => String(x.id) === pid);
      if (p && data.schedule && !data.schedule.endTimeManual) {
        data.schedule = { ...data.schedule, endTime: addMins(data.schedule.startTime, p.duration_minutes) };
      }
      return { ...f, data };
    });
  };

  // Jam selesai otomatis dari durasi program kelas yang dipilih.
  const progDurOf = (classId) => {
    const c = classes.find((x) => String(x.id) === String(classId));
    return c?.programDuration || null;
  };
  const schedChange = (patch) => {
    setSchedForm((f) => {
      const data = { ...f.data, ...patch };
      if (!data.endTimeManual && ('startTime' in patch || 'classId' in patch)) {
        const dur = progDurOf(data.classId);
        if (dur && data.startTime) data.endTime = addMins(data.startTime, dur);
      }
      if ('endTime' in patch) data.endTimeManual = true;
      return { ...f, data };
    });
    const merged = { ...schedForm.data, ...patch };
    if (!merged.endTimeManual && ('startTime' in patch || 'classId' in patch)) {
      const dur = progDurOf(merged.classId);
      if (dur && merged.startTime) merged.endTime = addMins(merged.startTime, dur);
      checkConflict({ ...merged, endTime: merged.endTime });
    } else {
      checkConflict(merged);
    }
  };

  return (
    <div>
      <PageHead title="Kelas & Jadwal Pembelajaran" desc="Kelola kelas, pola privat/kelompok, jadwal mingguan, dan pertemuan"
        actions={isAdmin && <>
          <button className="btn-outline" onClick={() => setGenForm(true)}>Generate Pertemuan</button>
          <button className="btn-primary" onClick={() => setClsForm({ mode: 'add', data: { ...emptyClass } })}>+ Kelas Baru</button>
        </>} />

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'kelas', label: 'Daftar Kelas', count: classes.length },
        { key: 'kalender', label: 'Kalender Jadwal', count: schedules.length },
        { key: 'pertemuan', label: 'Pertemuan' },
        { key: 'kuota', label: 'Target Bulanan' },
      ]} />

      {tab === 'kelas' && (
        <>
          <div className="card p-4 mb-4 grid sm:grid-cols-3 gap-3">
            <Input placeholder="Cari nama kelas..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value="" onChange={() => {}}>
              <option value="">Semua jenis & jenjang</option>
            </Select>
            <button className="btn-outline" onClick={() => setSearch('')}>Reset</button>
          </div>
          <div className="card p-4">
            <Table loading={loading} rows={classes} empty="Belum ada kelas. Buat kelas baru untuk memulai."
              columns={[
                { label: 'Kode', key: 'classCode', className: 'font-mono text-xs' },
                { label: 'Nama Kelas', render: (r) => (
                  <div><div className="font-semibold text-navy">{r.name}</div>
                  <div className="text-[11px] text-slate-400">{r.programName ? `${r.programName} • ` : ''}{r.subjectName || 'tanpa mapel'} • {r.location || '-'}</div></div>
                )},
                { label: 'Jenjang', center: true, key: 'level' },
                { label: 'Jenis', render: (r) => <Badge status={r.type} /> },
                { label: 'Tentor', render: (r) => r.tutorName || <span className="text-red-500 text-xs">belum ditentukan</span> },
                { label: 'Siswa', center: true, render: (r) => `${r.studentCount}` },
                { label: 'Jadwal', render: (r) => <span className="text-xs text-slate-500">{r.scheduleSummary || '-'}</span> },
                { label: 'Status', render: (r) => <Badge status={r.status} /> },
                { label: 'Aksi', center: true, render: (r) => (
                  <div className="flex gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
                    <button className="btn-outline btn-sm" onClick={() => setDetail(r)}>Detail</button>
                    {isAdmin && <>
                      <button className="btn-outline btn-sm" onClick={() => setClsForm({ mode: 'edit', id: r.id, data: { ...emptyClass, ...r, programId: r.programId || '', subjectId: r.subjectId || '', tutorId: r.tutorId || '' } })}>Edit</button>
                      <button className="btn-outline btn-sm !text-red-600" onClick={() => setConfirm({ kind: 'class', ...r })}>Hapus</button>
                    </>}
                  </div>
                )},
              ]} />
          </div>
        </>
      )}

      {tab === 'kalender' && <Calendar schedules={schedules} onAdd={() => setSchedForm({ mode: 'add', data: { ...emptySched, tutorId: tutors[0]?.id || '', classId: classes[0]?.id || '' } })} isAdmin={isAdmin} />}

      {tab === 'pertemuan' && <Sessions isAdmin={isAdmin} onChanged={load} />}

      {tab === 'kuota' && <QuotaRecap month={quotaMonth} onMonth={setQuotaMonth} />}

      {/* Modal kelas */}
      <Modal open={!!clsForm} onClose={() => setClsForm(null)} wide
        title={clsForm?.mode === 'add' ? 'Buat Kelas Baru' : `Edit Kelas: ${clsForm?.data?.name || ''}`}
        footer={<><button className="btn-outline" onClick={() => setClsForm(null)}>Batal</button>
          <button className="btn-primary" onClick={saveClass} disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Kelas'}</button></>}>
        {clsForm && (
          <div className="grid sm:grid-cols-2 gap-x-4">
            <div className="sm:col-span-2"><Field label="Nama Kelas" required><input className="input" value={clsForm.data.name} onChange={(e) => setCls('name', e.target.value)} placeholder="mis. Reguler A – SD Kelas 4" /></Field></div>
            <Field label="Program Bimbel" required><Select value={clsForm.data.programId || ''}
              onChange={(e) => onPickProgram(e.target.value)}>
              <option value="">-- Pilih Program --</option>
              {programs.filter((p) => p.status === 'aktif' || p.id === clsForm.data.programId).map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {p.duration_minutes} mnt, {p.sessions_per_month}×/bulan</option>
              ))}</Select></Field>
            <Field label="Jenjang"><Select value={clsForm.data.level || ''} onChange={(e) => setCls('level', e.target.value)}>
              {['TK', 'SD', 'SMP', 'SMA'].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
            <Field label="Mata Pelajaran (opsional)"><Select value={clsForm.data.subjectId || ''} onChange={(e) => setCls('subjectId', e.target.value)}>
              <option value="">-- Tanpa mapel --</option>
              {clsSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
              <span className="text-[10px] text-slate-400">Disesuaikan dengan program kelas — dipakai untuk penilaian</span></Field>
            <Field label="Jenis Pembelajaran"><Select value={clsForm.data.type} onChange={(e) => setCls('type', e.target.value)}>
              <option value="kelompok">Kelompok</option><option value="privat">Privat</option></Select></Field>
            <Field label="Tentor Pengampu"><Select value={clsForm.data.tutorId || ''} onChange={(e) => setCls('tutorId', e.target.value)}>
              <option value="">-- Pilih Tentor --</option>
              {tutors.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}</Select></Field>
            <Field label="Lokasi / Ruang"><Input value={clsForm.data.location || ''} onChange={(e) => setCls('location', e.target.value)} placeholder="mis. Ruang 1" /></Field>
            <Field label="Kapasitas"><Input type="number" value={clsForm.data.capacity || 1} onChange={(e) => setCls('capacity', Number(e.target.value))} /></Field>
            <div className="sm:col-span-2 border-t border-slate-100 pt-3 mt-1">
              <p className="text-xs font-bold text-navy mb-2">Jadwal Mingguan (opsional — sistem mengecek bentrok; jam selesai dihitung otomatis dari durasi program)</p>
              <div className="grid sm:grid-cols-4 gap-3">
                <Field label="Hari"><Select value={clsForm.data.schedule?.dayOfWeek ?? ''} onChange={(e) => setClsForm((f) => ({ ...f, data: { ...f.data, schedule: { ...f.data.schedule, dayOfWeek: e.target.value === '' ? undefined : Number(e.target.value) } } }))}>
                  <option value="">-- Pilih --</option>
                  {HARI.map((h, i) => <option key={h} value={i}>{h}</option>)}</Select></Field>
                <Field label="Jam Mulai"><Input type="time" value={clsForm.data.schedule?.startTime || ''}
                  onChange={(e) => setClsForm((f) => {
                    const sch = { ...f.data.schedule, startTime: e.target.value };
                    const prog = programs.find((p) => String(p.id) === String(f.data.programId));
                    if (prog && !sch.endTimeManual) sch.endTime = addMins(e.target.value, prog.duration_minutes);
                    return { ...f, data: { ...f.data, schedule: sch } };
                  })} /></Field>
                <Field label="Jam Selesai"><Input type="time" value={clsForm.data.schedule?.endTime || ''}
                  onChange={(e) => setClsForm((f) => ({ ...f, data: { ...f.data, schedule: { ...f.data.schedule, endTime: e.target.value, endTimeManual: true } } }))} />
                  {programs.find((p) => String(p.id) === String(clsForm.data.programId)) && !clsForm.data.schedule?.endTimeManual &&
                    <span className="text-[10px] text-sky-600">otomatis: {programs.find((p) => String(p.id) === String(clsForm.data.programId)).duration_minutes} menit</span>}</Field>
                <Field label="Status"><Select value={clsForm.data.status} onChange={(e) => setCls('status', e.target.value)}>
                  <option value="aktif">Aktif</option><option value="selesai">Selesai</option><option value="nonaktif">Nonaktif</option></Select></Field>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal jadwal */}
      <Modal open={!!schedForm} onClose={() => { setSchedForm(null); setConflict([]); }}
        title={schedForm?.mode === 'add' ? 'Tambah Jadwal' : 'Edit Jadwal'}
        footer={<><button className="btn-outline" onClick={() => { setSchedForm(null); setConflict([]); }}>Batal</button>
          <button className="btn-primary" onClick={saveSched} disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Jadwal'}</button></>}>
        {schedForm && (
          <>
            <Field label="Kelas" required><Select value={schedForm.data.classId} onChange={(e) => schedChange({ classId: e.target.value })}>
              <option value="">-- Pilih Kelas --</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}{c.programName ? ` (${c.programName} ${c.programDuration} mnt)` : ''}</option>)}</Select></Field>
            <Field label="Tentor" required><Select value={schedForm.data.tutorId} onChange={(e) => schedChange({ tutorId: e.target.value })}>
              <option value="">-- Pilih Tentor --</option>
              {tutors.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}</Select></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Hari" required><Select value={schedForm.data.dayOfWeek} onChange={(e) => schedChange({ dayOfWeek: e.target.value })}>
                {HARI.map((h, i) => <option key={h} value={i}>{h}</option>)}</Select></Field>
              <Field label="Jam Mulai" required><Input type="time" value={schedForm.data.startTime} onChange={(e) => schedChange({ startTime: e.target.value })} /></Field>
              <Field label="Jam Selesai" required><Input type="time" value={schedForm.data.endTime || ''} onChange={(e) => schedChange({ endTime: e.target.value })} />
                {!schedForm.data.endTimeManual && progDurOf(schedForm.data.classId) && <span className="text-[10px] text-sky-600">otomatis: {progDurOf(schedForm.data.classId)} mnt</span>}</Field>
            </div>
            <Field label="Lokasi"><Input value={schedForm.data.location || ''} onChange={(e) => setSched('location', e.target.value)} /></Field>
            {conflict.length > 0 && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                <b>Bentrok jadwal terdeteksi:</b>
                <ul className="list-disc ml-5 mt-1 text-xs">{conflict.map((c, i) => <li key={i}>{c}</li>)}</ul>
              </div>
            )}
            {conflict.length === 0 && schedForm.data.tutorId && schedForm.data.dayOfWeek !== '' && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-700">✓ Tidak ada bentrok jadwal untuk pilihan ini.</div>
            )}
          </>
        )}
      </Modal>

      {/* Modal detail kelas + anggota + jadwal */}
      <ClassDetail cls={detail} onClose={() => setDetail(null)} onChanged={load} isAdmin={isAdmin} tutors={tutors} />

      {/* Modal generate pertemuan */}
      <Modal open={genForm} onClose={() => setGenForm(false)} title="Generate Pertemuan dari Jadwal"
        footer={<button className="btn-outline" onClick={() => setGenForm(false)}>Tutup</button>}>
        <GenerateForm onDone={() => { setGenForm(false); toast.success('Pertemuan berhasil dibuat.'); }} />
      </Modal>

      <Confirm open={!!confirm} onClose={() => setConfirm(null)} onConfirm={doConfirm} loading={busy}
        title="Konfirmasi Penghapusan"
        message={confirm?.kind === 'class'
          ? `Kelas "${confirm?.name}" akan dihapus. Jika kelas sudah memiliki riwayat pertemuan, kelas akan dinonaktifkan agar data absensi & rapor tetap utuh.`
          : 'Jadwal ini akan dihapus permanen dari sistem.'} />
    </div>
  );
}

function Calendar({ schedules, onAdd, isAdmin }) {
  const perDay = HARI.map((h, i) => ({ day: i, name: h, items: schedules.filter((s) => Number(s.day_of_week) === i) }));
  const [week, setWeek] = useState(0);
  const weekStart = (() => {
    const d = new Date(today() + 'T00:00:00');
    const dow = (d.getDay() + 6) % 7; // Senin=0
    d.setDate(d.getDate() - dow + week * 7);
    return d;
  })();
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
  const fmt = (d) => d.toISOString().slice(0, 10);

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button className="btn-outline btn-sm" onClick={() => setWeek(week - 1)}>← Minggu</button>
          <span className="text-sm font-semibold text-navy">{tgl(fmt(dates[0]))} – {tgl(fmt(dates[6]))}</span>
          <button className="btn-outline btn-sm" onClick={() => setWeek(week + 1)}>Minggu →</button>
          {week !== 0 && <button className="btn-outline btn-sm" onClick={() => setWeek(0)}>Hari ini</button>}
        </div>
        {isAdmin && <button className="btn-primary btn-sm" onClick={onAdd}>+ Tambah Jadwal</button>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
        {perDay.map((d, i) => {
          const isToday = fmt(dates[i]) === today();
          return (
            <div key={d.day} className={`card p-3 min-h-[140px] ${isToday ? 'ring-2 ring-navy' : ''}`}>
              <div className={`text-xs font-bold mb-2 ${isToday ? 'text-navy' : 'text-slate-500'}`}>
                {hariPendek(d.day)} <span className="font-normal text-slate-400">{dates[i].getDate()}/{dates[i].getMonth() + 1}</span>
              </div>
              {d.items.length === 0 && <div className="text-[11px] text-slate-300">—</div>}
              {d.items.map((s) => (
                <div key={s.id} className="bg-navy/[0.06] border-l-[3px] border-navy rounded px-2 py-1.5 mb-1.5">
                  <div className="text-[11px] font-bold text-navy">{s.start_time}–{s.end_time}</div>
                  <div className="text-[11px] text-slate-600 leading-tight">{s.class_name}</div>
                  <div className="text-[10px] text-slate-400 truncate">{s.tutor_name}</div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-400 mt-3">Jadwal bersifat mingguan berulang. Bentrok jadwal tentor/kelas dicegah saat penyimpanan.</p>
    </div>
  );
}

function ClassDetail({ cls, onClose, onChanged, isAdmin, tutors }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [addSid, setAddSid] = useState('');
  const [students, setStudents] = useState([]);
  const [schedForm, setSchedForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cls) { setData(null); return; }
    get(`/data/classes/${cls.id}`).then((d) => setData(d.data)).catch((e) => toast.error(e.message));
    if (isAdmin) get('/students?status=aktif').then((d) => setStudents(d.data)).catch(() => {});
  }, [cls]);

  if (!cls) return null;

  const addStudent = async () => {
    if (!addSid) return toast.error('Pilih siswa.');
    setBusy(true);
    try {
      await post(`/data/classes/${cls.id}/students`, { studentId: Number(addSid) });
      toast.success('Siswa ditambahkan ke kelas.');
      setAddSid('');
      const d = await get(`/data/classes/${cls.id}`);
      setData(d.data); onChanged();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const removeStudent = async (sid, name) => {
    setBusy(true);
    try {
      await del(`/data/classes/${cls.id}/students/${sid}`);
      toast.success(`${name} dikeluarkan dari kelas.`);
      const d = await get(`/data/classes/${cls.id}`);
      setData(d.data); onChanged();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={!!cls} onClose={onClose} wide title={`Detail Kelas: ${cls.name}`}
      footer={<button className="btn-outline" onClick={onClose}>Tutup</button>}>
      {!data ? <Spinner /> : (
        <div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            {[['Kode', data.classCode], ['Jenjang', data.level || '-'], ['Mata Pelajaran', data.subjectName || '-'], ['Tentor', data.tutorName || '-'],
              ['Jenis', data.type], ['Lokasi', data.location || '-'], ['Kapasitas', data.capacity], ['Status', data.status]].map(([k, v]) => (
              <div key={k} className="bg-slate-50 rounded-lg p-2.5">
                <div className="text-[10px] uppercase text-slate-400 font-bold">{k}</div>
                <div className="text-sm font-semibold text-navy">{v}</div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between mb-2">
            <h4 className="font-bold text-navy text-sm">Jadwal Kelas</h4>
            {isAdmin && <button className="btn-outline btn-sm" onClick={() => setSchedForm({ classId: cls.id, tutorId: data.tutorId || tutors[0]?.id, dayOfWeek: 1, startTime: '15:30', endTime: '17:00', location: data.location })}>+ Jadwal</button>}
          </div>
          {data.schedules.length === 0 ? <p className="text-xs text-slate-400 mb-4">Belum ada jadwal.</p> : (
            <Table rows={data.schedules} empty=""
              columns={[
                { label: 'Hari', render: (r) => <b>{r.dayName}</b> },
                { label: 'Jam', render: (r) => `${r.startTime}–${r.endTime}` },
                { label: 'Tentor', key: 'tutorName' },
                { label: 'Lokasi', key: 'location' },
                ...(isAdmin ? [{ label: 'Aksi', center: true, render: (r) => (
                  <button className="btn-outline btn-sm !text-red-600" onClick={async () => {
                    try { await del(`/data/schedules/${r.id}`); toast.success('Jadwal dihapus.'); const d = await get(`/data/classes/${cls.id}`); setData(d.data); onChanged(); }
                    catch (e) { toast.error(e.message); }
                  }}>Hapus</button>
                ) }] : []),
              ]} />
          )}

          <div className="flex items-center justify-between mt-5 mb-2">
            <h4 className="font-bold text-navy text-sm">Daftar Siswa ({data.students.length})</h4>
            {isAdmin && (
              <div className="flex gap-2">
                <select className="input !w-56 !py-1.5 text-xs" value={addSid} onChange={(e) => setAddSid(e.target.value)}>
                  <option value="">-- Pilih siswa --</option>
                  {students.filter((s) => !data.students.some((x) => x.id === s.id && x.enrollStatus === 'aktif'))
                    .map((s) => <option key={s.id} value={s.id}>{s.fullName} ({s.nis})</option>)}
                </select>
                <button className="btn-primary btn-sm" onClick={addStudent} disabled={busy}>+ Tambah</button>
              </div>
            )}
          </div>
          <Table rows={data.students} empty="Belum ada siswa di kelas ini."
            columns={[
              { label: 'NIS', key: 'nis', className: 'font-mono text-xs' },
              { label: 'Nama', key: 'fullName' },
              { label: 'Kelas Sekolah', center: true, key: 'schoolGrade' },
              { label: 'Bergabung', render: (r) => tgl(r.joinedAt) },
              { label: 'Status', render: (r) => <Badge status={r.enrollStatus === 'aktif' ? 'aktif' : 'berhenti'} children={r.enrollStatus} /> },
              ...(isAdmin ? [{ label: '', center: true, render: (r) => (
                <button className="btn-outline btn-sm !text-red-600" onClick={() => removeStudent(r.id, r.fullName)}>Keluarkan</button>
              ) }] : []),
            ]} />
        </div>
      )}

      <Modal open={!!schedForm} onClose={() => setSchedForm(null)} title="Tambah Jadwal untuk Kelas Ini"
        footer={<button className="btn-outline" onClick={() => setSchedForm(null)}>Batal</button>}>
        <ScheduleQuickForm initial={schedForm} onSaved={async () => {
          setSchedForm(null); toast.success('Jadwal ditambahkan.');
          const d = await get(`/data/classes/${cls.id}`); setData(d.data); onChanged();
        }} />
      </Modal>
    </Modal>
  );
}

function ScheduleQuickForm({ initial, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(initial || {});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(initial || {}); }, [initial]);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const d = await post('/data/schedules', { ...f, tutorId: Number(f.tutorId), classId: Number(f.classId), dayOfWeek: Number(f.dayOfWeek) });
      toast.success(d.message); onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  if (!f.classId) return null;
  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Hari" required><Select value={f.dayOfWeek} onChange={(e) => setF({ ...f, dayOfWeek: e.target.value })}>
          {HARI.map((h, i) => <option key={h} value={i}>{h}</option>)}</Select></Field>
        <Field label="Mulai" required><Input type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></Field>
        <Field label="Selesai" required><Input type="time" value={f.endTime} onChange={(e) => setF({ ...f, endTime: e.target.value })} /></Field>
      </div>
      {err && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs p-3">{err}</div>}
      <button className="btn-primary w-full mt-3" onClick={save} disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Jadwal'}</button>
    </div>
  );
}

function GenerateForm({ onDone }) {
  const toast = useToast();
  const curMonth = today().slice(0, 7);
  const [mode, setMode] = useState('bulan'); // 'bulan' | 'rentang'
  const [month, setMonth] = useState(curMonth);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10); });
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const d = mode === 'bulan'
        ? await post('/data/sessions/generate', { month })
        : await post('/data/sessions/generate', { from, to });
      toast.success(d.message); onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div>
      <div className="flex gap-2 mb-3">
        <button className={`btn-sm rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === 'bulan' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setMode('bulan')}>Per Bulan (kuota program)</button>
        <button className={`btn-sm rounded-lg px-3 py-1.5 text-xs font-semibold ${mode === 'rentang' ? 'bg-navy text-white' : 'bg-slate-100 text-slate-600'}`} onClick={() => setMode('rentang')}>Rentang Tanggal</button>
      </div>
      {mode === 'bulan' ? (
        <>
          <p className="text-xs text-slate-500 mb-3">Pertemuan dibuat dari jadwal aktif sepanjang bulan tersebut, <b>dibatasi kuota pertemuan/bulan tiap program</b> (mis. Calistung &amp; Reguler A 12×, Reguler B 24×). Lihat tab <b>Target Bulanan</b> untuk rekap capaiannya.</p>
          <Field label="Bulan" required><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-3">Sistem membuat pertemuan untuk semua jadwal aktif pada rentang tanggal. Pertemuan yang sudah ada tidak diduplikasi.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dari Tanggal" required><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="Sampai Tanggal" required><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        </>
      )}
      <button className="btn-primary w-full mt-3" onClick={run} disabled={busy}>{busy ? 'Memproses...' : mode === 'bulan' ? 'Generate Pertemuan Bulan Ini' : 'Generate Pertemuan'}</button>
    </div>
  );
}

function QuotaRecap({ month, onMonth }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    if (!month) return;
    setLoading(true);
    get(`/data/sessions/quota?month=${month}`).then((d) => setRows(d.data)).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [month]);
  useEffect(() => { load(); }, [load]);
  const achieved = rows.filter((r) => r.achieved).length;
  return (
    <div>
      <div className="card p-4 mb-4 grid sm:grid-cols-3 gap-3 items-end">
        <Field label="Bulan"><Input type="month" value={month} onChange={(e) => onMonth(e.target.value)} /></Field>
        <div className="text-sm text-slate-500 pb-1">{rows.length} kelas aktif berprogram • <b className="text-emerald-600">{achieved} tercapai</b> • <b className="text-amber-600">{rows.length - achieved} belum</b></div>
        <div className="text-[11px] text-slate-400 pb-1">Target = kuota pertemuan/bulan program. Generate mode "Per Bulan" akan membuat pertemuan sesuai kuota.</div>
      </div>
      <div className="card p-4">
        <Table loading={loading} rows={rows} empty="Tidak ada kelas aktif dengan program pada bulan ini."
          columns={[
            { label: 'Kode', key: 'classCode', className: 'font-mono text-xs' },
            { label: 'Kelas', key: 'name' },
            { label: 'Program', render: (r) => r.programName || '-' },
            { label: 'Target/Bulan', center: true, render: (r) => <b className="text-navy">{r.target}×</b> },
            { label: 'Terjadwal', center: true, render: (r) => <span className={r.achieved ? 'text-emerald-600 font-bold' : 'text-amber-600 font-semibold'}>{r.actual}×</span> },
            { label: 'Kurang', center: true, render: (r) => r.remaining > 0 ? <span className="text-amber-600">{r.remaining}×</span> : <span className="text-emerald-600">—</span> },
            { label: 'Status', center: true, render: (r) => r.achieved
              ? <Badge status="aktif" children="Tercapai" />
              : <Badge status="jatuh_tempo" children="Belum tercapai" /> },
          ]} />
      </div>
      <p className="text-xs text-slate-400 mt-3">Kelas belum tercapai → tambah jadwal mingguan kelas tersebut, lalu generate ulang bulan ini.</p>
    </div>
  );
}

function Sessions({ isAdmin, onChanged }) {
  const toast = useToast();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ from: '', to: '', status: '' });
  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (filters.from) q.set('from', filters.from);
    if (filters.to) q.set('to', filters.to);
    if (filters.status) q.set('status', filters.status);
    get(`/data/sessions?${q}`).then((d) => setRows(d.data)).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="card p-4 mb-4 grid sm:grid-cols-4 gap-3">
        <Input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        <Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">Semua Status</option>
          <option value="terjadwal">Terjadwal</option><option value="selesai">Selesai</option>
          <option value="batal">Batal</option><option value="diundur">Diundur</option>
        </Select>
        <button className="btn-outline" onClick={() => setFilters({ from: '', to: '', status: '' })}>Reset</button>
      </div>
      <div className="card p-4">
        <Table loading={loading} rows={rows} empty="Belum ada pertemuan. Gunakan 'Generate Pertemuan' untuk membuat dari jadwal."
          columns={[
            { label: 'Tanggal', render: (r) => <span className="whitespace-nowrap">{tgl(r.session_date)}</span> },
            { label: 'Jam', render: (r) => `${r.start_time}–${r.end_time}` },
            { label: 'Kelas', render: (r) => <div><div className="font-semibold">{r.class_name}</div><div className="text-[11px] text-slate-400">{r.subject_name || '-'}</div></div> },
            { label: 'Tentor', key: 'tutor_name' },
            { label: 'Absensi', center: true, render: (r) => (
              <span className={`text-xs ${r.attendance_filled >= r.student_count ? 'text-emerald-600' : 'text-amber-600'}`}>
                {r.attendance_filled}/{r.student_count}
              </span>
            )},
            { label: 'Jurnal', center: true, render: (r) => r.journal_count ? '✓' : <span className="text-amber-500">belum</span> },
            { label: 'Status', render: (r) => <Badge status={r.status} /> },
            ...(isAdmin ? [{ label: 'Aksi', center: true, render: (r) => (
              <Select value={r.status} onClick={(e) => e.stopPropagation()} className="!py-1 !text-xs"
                onChange={async (e) => {
                  try { await put(`/data/sessions/${r.id}/status`, { status: e.target.value }); toast.success('Status pertemuan diperbarui.'); load(); onChanged?.(); }
                  catch (ex) { toast.error(ex.message); }
                }}>
                {['terjadwal', 'selesai', 'batal', 'diundur'].map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
            )}] : []),
          ]} />
      </div>
    </div>
  );
}
