import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { get, post } from '../api';
import { PageHead, Spinner, Tabs, Badge, Table, Modal, Field, Select, useToast, Empty } from '../ui';
import { tgl, rupiah } from '../format';

const TABS = [
  { key: 'profil', label: '1. Profil' },
  { key: 'kelas', label: '2. Riwayat Kelas' },
  { key: 'absensi', label: '3. Riwayat Absensi' },
  { key: 'pembelajaran', label: '4. Riwayat Pembelajaran' },
  { key: 'nilai', label: '5. Nilai & Evaluasi' },
  { key: 'rapor', label: '6. Rapor Perkembangan' },
  { key: 'bayar', label: '7. Tagihan & Pembayaran' },
  { key: 'arsip', label: '8. Arsip Dokumen' },
];

export default function StudentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [tab, setTab] = useState('profil');
  const [data, setData] = useState(null);
  const [relations, setRelations] = useState({ classes: [], subjects: [] });
  const [extra, setExtra] = useState({});
  const [loading, setLoading] = useState(true);
  const [enroll, setEnroll] = useState(false);
  const [classes, setClasses] = useState([]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const d = await get(`/students/${id}`);
      setData(d.data);
      const r = await get(`/students/${id}/relations`);
      setRelations(r);
    } catch (e) {
      toast.error(e.message);
      nav('/siswa');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!data) return;
    const map = {
      absensi: `/attendance/recap?studentId=${id}`,
      nilai: `/assessments?studentId=${id}`,
      rapor: `/reports?studentId=${id}`,
      bayar: `/billing/invoices?studentId=${id}`,
      arsip: `/archives?studentId=${id}`,
      pembelajaran: '/journals',
    };
    if (map[tab]) {
      setExtra((e) => ({ ...e, [tab]: null }));
      get(map[tab]).then((d) => setExtra((e) => ({ ...e, [tab]: d.data }))).catch(() => setExtra((e) => ({ ...e, [tab]: [] })));
    }
  }, [tab, data, id]);

  if (loading || !data) return <Spinner />;
  const isAdmin = ['sekretaris', 'direktur'].includes(user.role);
  const myClassIds = relations.classes.filter((c) => c.enroll_status === 'aktif').map((c) => c.id);

  return (
    <div>
      <PageHead
        title={data.fullName}
        desc={`NIS: ${data.nis} • ${data.educationLevel || '-'} • Status: ${data.status}`}
        actions={<>
          <Link to="/siswa" className="btn-outline">← Kembali</Link>
          {isAdmin && <button className="btn-outline" onClick={() => setEnroll(true)}>+ Masukkan ke Kelas</button>}
        </>} />

      <div className="card p-4 mb-4 flex flex-wrap gap-4 items-center">
        <div className="w-16 h-16 rounded-xl bg-navy text-white flex items-center justify-center text-2xl font-bold shrink-0">
          {data.fullName?.[0]}
        </div>
        <div className="min-w-[180px]">
          <div className="text-xs text-slate-400">Program</div>
          <div className="font-semibold text-navy">{data.program || '-'}</div>
        </div>
        <div className="min-w-[180px]">
          <div className="text-xs text-slate-400">Sekolah</div>
          <div className="font-semibold text-navy">{data.schoolName || '-'}</div>
        </div>
        <div className="min-w-[180px]">
          <div className="text-xs text-slate-400">Orang Tua/Wali</div>
          <div className="font-semibold text-navy">{data.guardians?.[0]?.guardian_name || '-'} <span className="text-slate-400 font-normal text-xs">{data.guardians?.[0]?.phone || ''}</span></div>
        </div>
        <div className="min-w-[120px]">
          <div className="text-xs text-slate-400">Mulai Bimbel</div>
          <div className="font-semibold text-navy">{tgl(data.startDate)}</div>
        </div>
        <Badge status={data.status} />
        {data.isDemo && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-1 rounded font-bold">DATA SIMULASI</span>}
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="card p-4 sm:p-5">
        {tab === 'profil' && <TabProfil data={data} relations={relations} />}
        {tab === 'kelas' && (
          <Table rows={relations.classes.map((c) => ({ ...c, key: c.id }))}
            empty="Belum terdaftar di kelas mana pun."
            columns={[
              { label: 'Kode', key: 'class_code', className: 'font-mono text-xs' },
              { label: 'Nama Kelas', key: 'name' },
              { label: 'Jenjang', key: 'level', center: true },
              { label: 'Jenis', render: (r) => <Badge status={r.type} /> },
              { label: 'Tentor', key: 'tutor_name' },
              { label: 'Bergabung', render: (r) => tgl(r.joined_at) },
              { label: 'Status', render: (r) => <Badge status={r.enroll_status === 'aktif' ? 'aktif' : 'berhenti'} children={r.enroll_status} /> },
            ]} />
        )}
        {tab === 'absensi' && (
          extra.absensi == null ? <Spinner /> : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
                {[['Total', extra.absensi.length], ['Hadir', extra.absensi.filter((a) => a.status === 'hadir').length],
                  ['Izin', extra.absensi.filter((a) => a.status === 'izin').length], ['Sakit', extra.absensi.filter((a) => a.status === 'sakit').length],
                  ['Alpa', extra.absensi.filter((a) => a.status === 'alpa').length]].map(([l, v]) => (
                  <div key={l} className="bg-slate-50 rounded-lg p-3 text-center">
                    <div className="text-lg font-bold text-navy">{v}</div>
                    <div className="text-[11px] text-slate-500">{l}</div>
                  </div>
                ))}
              </div>
              <Table rows={extra.absensi.slice(0, 100)}
                empty="Belum ada absensi."
                columns={[
                  { label: 'Tanggal', render: (r) => tgl(r.session_date) },
                  { label: 'Kelas', key: 'class_name' },
                  { label: 'Tentor', key: 'tutor_name' },
                  { label: 'Jam', render: (r) => `${r.start_time}–${r.end_time}` },
                  { label: 'Status', render: (r) => <Badge status={r.status} /> },
                  { label: 'Catatan', render: (r) => <span className="text-xs text-slate-500">{r.note || '-'}</span> },
                ]} />
            </>
          )
        )}
        {tab === 'pembelajaran' && (
          extra.pembelajaran == null ? <Spinner /> : (() => {
            const j = extra.pembelajaran.filter((x) => myClassIds.includes(x.class_id));
            return j.length === 0 ? <Empty text="Belum ada jurnal pembelajaran untuk kelas yang diikuti siswa ini." /> : (
              <div className="space-y-3">
                {j.slice(0, 40).map((x) => (
                  <div key={x.id} className="border border-slate-200 rounded-lg p-3">
                    <div className="flex flex-wrap justify-between gap-2">
                      <div className="font-semibold text-navy text-sm">{tgl(x.journal_date)} • {x.class_name}</div>
                      <span className="text-xs text-slate-400">{x.tutor_name}</span>
                    </div>
                    <div className="text-sm mt-1"><b>Materi:</b> {x.material}</div>
                    <div className="text-xs text-slate-500 mt-1">Tujuan: {x.objective || '-'}<br />Hasil: {x.outcomes || '-'}</div>
                  </div>
                ))}
              </div>
            );
          })()
        )}
        {tab === 'nilai' && (
          extra.nilai == null ? <Spinner /> : (
            <Table rows={extra.nilai} empty="Belum ada nilai/evaluasi untuk siswa ini."
              columns={[
                { label: 'Periode', key: 'periodLabel' },
                { label: 'Mata Pelajaran', key: 'subjectName' },
                { label: 'Nilai Awal', center: true, render: (r) => r.initialScore ?? <span className="text-amber-600 text-xs">belum ada data</span> },
                { label: 'Tugas', center: true, key: 'taskScore' },
                { label: 'Latihan', center: true, key: 'practiceScore' },
                { label: 'Akhir', center: true, render: (r) => <b className="text-navy">{r.finalScore ?? '-'}</b> },
                { label: 'Catatan', render: (r) => <span className="text-xs">{r.notes || '-'}</span> },
              ]} />
          )
        )}
        {tab === 'rapor' && (
          extra.rapor == null ? <Spinner /> : (
            <Table rows={extra.rapor} empty="Belum ada rapor perkembangan."
              onRowClick={(r) => nav(`/rapor/${r.id}`)}
              columns={[
                { label: 'Kode', key: 'report_code', className: 'font-mono text-xs' },
                { label: 'Periode', key: 'period_name' },
                { label: 'Tentor', key: 'tutor_name' },
                { label: 'Status', render: (r) => <Badge status={r.status} /> },
                { label: 'Terbit', render: (r) => tgl(r.published_at) },
                { label: 'Aksi', center: true, render: (r) => <button className="btn-outline btn-sm" onClick={(e) => { e.stopPropagation(); nav(`/rapor/${r.id}`); }}>Buka</button> },
              ]} />
          )
        )}
        {tab === 'bayar' && (
          extra.bayar == null ? <Spinner /> : (
            <>
              <Table rows={extra.bayar} empty="Belum ada tagihan."
                columns={[
                  { label: 'No. Tagihan', key: 'invoiceNumber', className: 'font-mono text-xs' },
                  { label: 'Periode', key: 'period' },
                  { label: 'Jatuh Tempo', render: (r) => tgl(r.dueDate) },
                  { label: 'Total', render: (r) => <span className="font-semibold">{rupiah(r.total)}</span> },
                  { label: 'Dibayar', render: (r) => rupiah(r.paid) },
                  { label: 'Sisa', render: (r) => <b className={r.remaining > 0 ? 'text-red-600' : 'text-emerald-600'}>{rupiah(r.remaining)}</b> },
                  { label: 'Status', render: (r) => <Badge status={r.status} /> },
                ]} />
              {!isAdmin && <p className="text-xs text-slate-400 mt-3">Rincian pembayaran hanya dapat dilihat pengelola/sekretaris.</p>}
            </>
          )
        )}
        {tab === 'arsip' && (
          extra.arsip == null ? <Spinner /> : (
            <Table rows={extra.arsip} empty="Belum ada dokumen arsip untuk siswa ini."
              columns={[
                { label: 'Kode', key: 'docCode', className: 'font-mono text-xs' },
                { label: 'Nama Dokumen', key: 'docName' },
                { label: 'Kategori', key: 'category' },
                { label: 'Tanggal', render: (r) => tgl(r.docDate) },
                { label: 'Status', render: (r) => <Badge status={r.status === 'aktif' ? 'aktif' : 'berhenti'} children={r.status} /> },
                { label: 'Aksi', center: true, render: (r) => (
                  <a className="btn-outline btn-sm" href={`/api/archives/${r.id}/download?inline=1`} target="_blank" rel="noreferrer">Buka</a>
                )},
              ]} />
          )
        )}
      </div>

      <Modal open={enroll} onClose={() => setEnroll(false)} title="Masukkan Siswa ke Kelas"
        footer={<button className="btn-outline" onClick={() => setEnroll(false)}>Tutup</button>}>
        <EnrollForm studentId={id} onDone={async () => { setEnroll(false); await loadAll(); toast.success('Siswa ditambahkan ke kelas.'); }} />
      </Modal>
    </div>
  );
}

function TabProfil({ data, relations }) {
  const rows = [
    ['Nama Lengkap', data.fullName], ['Nomor Induk Siswa (NIS)', data.nis],
    ['Tempat, Tanggal Lahir', `${data.birthPlace || '-'}, ${tgl(data.birthDate)}`],
    ['Jenis Kelamin', data.gender === 'L' ? 'Laki-laki' : data.gender === 'P' ? 'Perempuan' : '-'],
    ['Jenjang / Kelas Sekolah', `${data.educationLevel || '-'} / ${data.schoolGrade || '-'}`],
    ['Nama Sekolah', data.schoolName], ['Alamat', data.address],
    ['Nama Orang Tua/Wali', data.guardians?.[0]?.guardian_name],
    ['Hubungan', data.guardians?.[0]?.relation],
    ['Nomor WhatsApp', data.guardians?.[0]?.phone],
    ['Pekerjaan', data.guardians?.[0]?.occupation],
    ['Program Bimbel', data.program], ['Tanggal Mulai Bimbel', tgl(data.startDate)],
    ['Mata Pelajaran Diikuti', relations.subjects.map((s) => s.subject_name).join(', ') || '-'],
    ['Status', data.status],
  ];
  return (
    <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
      {rows.map(([k, v]) => (
        <div key={k} className="border-b border-slate-50 pb-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">{k}</dt>
          <dd className="text-sm text-slate-700 font-medium">{v || '-'}</dd>
        </div>
      ))}
    </dl>
  );
}

function EnrollForm({ studentId, onDone }) {
  const toast = useToast();
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { get('/data/classes?status=aktif').then((d) => setClasses(d.data)).catch(() => {}); }, []);
  const submit = async () => {
    if (!classId) return toast.error('Pilih kelas terlebih dahulu.');
    setBusy(true);
    try {
      await post(`/data/classes/${classId}/students`, { studentId: Number(studentId) });
      onDone();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div>
      <Field label="Pilih Kelas" required>
        <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">-- Pilih Kelas --</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.tutorName || 'tanpa tentor'})</option>)}
        </Select>
      </Field>
      <button className="btn-primary w-full" onClick={submit} disabled={busy}>{busy ? 'Menyimpan...' : 'Tambahkan ke Kelas'}</button>
    </div>
  );
}
