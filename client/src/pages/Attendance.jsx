import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../auth';
import { get, post } from '../api';
import { PageHead, Table, Badge, Select, Input, useToast, Spinner, Modal, Field } from '../ui';
import { tgl, today, statusBadge } from '../format';

const STATUS = [
  { v: 'hadir', l: 'Hadir' },
  { v: 'izin', l: 'Izin' },
  { v: 'sakit', l: 'Sakit' },
  { v: 'alpa', l: 'Alpa' },
];

export default function Attendance() {
  const { user } = useAuth();
  const toast = useToast();
  const isTutor = user.role === 'tentor';
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ from: '', to: '', status: '' });
  const [active, setActive] = useState(null); // session dipilih
  const [list, setList] = useState(null);
  const [records, setRecords] = useState({});
  const [busy, setBusy] = useState(false);
  const [koreksi, setKoreksi] = useState(null);
  const [koreksiNote, setKoreksiNote] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const q = new URLSearchParams();
    if (filters.from) q.set('from', filters.from);
    if (filters.to) q.set('to', filters.to);
    if (filters.status) q.set('status', filters.status);
    q.set('from', filters.from || (isTutor ? today().slice(0, 8) + '01' : ''));
    get(`/data/sessions?${q}`).then((d) => setSessions(d.data)).catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [filters]);
  useEffect(() => { load(); }, [load]);

  const openSession = async (s) => {
    setActive(s);
    setList(null);
    try {
      const d = await get(`/attendance/sessions/${s.id}/students`);
      setList(d.data);
      const rec = {};
      d.data.forEach((r) => { rec[r.id] = { status: r.status || '', note: r.note || '', existing: !!r.status }; });
      setRecords(rec);
    } catch (e) { toast.error(e.message); setActive(null); }
  };

  const setAll = (v) => {
    const rec = { ...records };
    Object.keys(rec).forEach((k) => { rec[k] = { ...rec[k], status: v }; });
    setRecords(rec);
  };

  const save = async () => {
    const payload = Object.entries(records)
      .filter(([, v]) => v.status)
      .map(([sid, v]) => ({ studentId: Number(sid), status: v.status, note: v.note || null }));
    if (!payload.length) return toast.error('Pilih status kehadiran minimal satu siswa.');
    const belumTerisi = Object.values(records).filter((v) => !v.status).length;
    if (belumTerisi > 0 && !window.confirm(`${belumTerisi} siswa belum dipilih statusnya. Siswa tanpa pilihan TIDAK dianggap alpa dan tidak tersimpan. Lanjutkan?`)) return;
    setBusy(true);
    try {
      const d = await post(`/attendance/sessions/${active.id}/attendance`, { records: payload });
      toast.success(d.message);
      setKoreksi(null);
      await openSession(active);
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  // hitung yang belum diisi
  const unassigned = Object.values(records).filter((v) => !v.status).length;

  return (
    <div>
      <PageHead
        title={isTutor ? 'Absensi Siswa — Kelas Anda' : 'Absensi Siswa'}
        desc={isTutor ? 'Pilih pertemuan kelas yang Anda ampu lalu isi kehadiran siswa' : 'Isi & koreksi absensi siswa per pertemuan'}
        actions={isTutor ? null : (
          <a href="#rekap" className="btn-outline" onClick={(e) => { e.preventDefault(); window.location.href = '/absensi/rekap'; }}>Buka Rekap Absensi →</a>
        )} />

      <div className="card p-4 mb-4 grid sm:grid-cols-4 gap-3">
        <Input type="date" placeholder="Dari" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        <Input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        <Select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">Semua Status</option>
          <option value="terjadwal">Terjadwal</option><option value="selesai">Selesai</option>
          <option value="batal">Batal</option><option value="diundur">Diundur</option>
        </Select>
        <button className="btn-outline" onClick={() => setFilters({ from: '', to: '', status: '' })}>Reset</button>
      </div>

      <div className="card p-4">
        <Table loading={loading} rows={sessions} empty="Tidak ada pertemuan. Minta sekretaris membuat jadwal & generate pertemuan."
          onRowClick={openSession}
          columns={[
            { label: 'Tanggal', render: (r) => <span className="whitespace-nowrap font-semibold">{tgl(r.session_date)}</span> },
            { label: 'Jam', render: (r) => `${r.start_time}–${r.end_time}` },
            { label: 'Kelas', key: 'class_name' },
            { label: 'Tentor', key: 'tutor_name' },
            { label: 'Terisi', center: true, render: (r) => (
              <span className={r.attendance_filled >= r.student_count ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>
                {r.attendance_filled}/{r.student_count}
              </span>
            )},
            { label: 'Status', render: (r) => <Badge status={r.status} /> },
            { label: 'Aksi', center: true, render: (r) => (
              <button className="btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); openSession(r); }}>
                {r.attendance_filled > 0 ? 'Lihat / Koreksi' : 'Isi Absensi'}
              </button>
            )},
          ]} />
      </div>

      {/* Modal absensi */}
      <Modal open={!!active} onClose={() => setActive(null)} wide
        title={`Absensi — ${active?.class_name || ''} • ${active ? tgl(active.session_date) : ''}`}
        footer={<>
          <span className="text-xs text-slate-500 mr-auto">{unassigned} siswa belum dipilih (tidak dianggap alpa)</span>
          <button className="btn-outline" onClick={() => setActive(null)}>Tutup</button>
          <button className="btn-primary" onClick={save} disabled={busy || !list}>{busy ? 'Menyimpan...' : 'Simpan Absensi'}</button>
        </>}>
        {!list ? <Spinner /> : (
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-3 bg-slate-50 rounded-lg p-3">
              <span className="text-xs font-semibold text-slate-600">Tandai semua:</span>
              {STATUS.map((s) => (
                <button key={s.v} className="btn-outline btn-sm" onClick={() => setAll(s.v)}>{s.l}</button>
              ))}
              <span className="text-[11px] text-slate-400 ml-auto">Tentor pencatat: {user.fullName}</span>
            </div>
            <div className="space-y-2">
              {list.map((s) => (
                <div key={s.id} className="border border-slate-200 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-navy">{s.full_name}</div>
                    <div className="text-[11px] text-slate-400">{s.nis} • {s.school_grade || '-'}
                      {s.existing && <span className="ml-2 text-emerald-600">✓ sudah terisi</span>}
                      {s.status && <span className="ml-2">{statusBadge(s.status).label}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {STATUS.map((st) => (
                      <button key={st.v}
                        onClick={() => setRecords((r) => ({ ...r, [s.id]: { ...r[s.id], status: st.v } }))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                          records[s.id]?.status === st.v
                            ? st.v === 'hadir' ? 'bg-emerald-600 border-emerald-600 text-white'
                              : st.v === 'alpa' ? 'bg-red-600 border-red-600 text-white'
                              : 'bg-sky-500 border-sky-500 text-white'
                            : 'bg-white border-slate-300 text-slate-500 hover:border-navy'}`}>
                        {st.l}
                      </button>
                    ))}
                  </div>
                  <input className="input !py-1.5 text-xs sm:w-44" placeholder="Catatan..." value={records[s.id]?.note || ''}
                    onChange={(e) => setRecords((r) => ({ ...r, [s.id]: { ...r[s.id], note: e.target.value } }))} />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-3">
              • Koreksi status pada siswa yang sudah terisi akan tercatat sebagai perubahan dalam riwayat aktivitas.<br />
              • Absensi hanya berlaku untuk siswa terdaftar di kelas ini. Status "belum diisi" berbeda dengan "alpa".
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
