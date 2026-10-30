import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { get, post } from '../api';
import { PageHead, Spinner, Tabs, Badge, Table, Field, Input, Modal, useToast } from '../ui';
import { tgl, hariNama } from '../format';

export default function TutorDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [tab, setTab] = useState('profil');
  const [data, setData] = useState(null);
  const [att, setAtt] = useState(null);
  const [resetPw, setResetPw] = useState(false);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await get(`/tutors/${id}`);
      setData(d.data);
    } catch (e) { toast.error(e.message); nav('/tentor'); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab === 'absensi') {
      get(`/tutors/${id}/attendance`).then((d) => setAtt(d.data)).catch(() => setAtt([]));
    }
  }, [tab, id]);

  if (!data) return <Spinner />;
  const isAdmin = ['sekretaris', 'direktur'].includes(user.role);

  const createAccount = async () => {
    if (!data.email) return toast.error('Tentor memerlukan email sebelum akun login dibuat.');
    const nama = data.fullName;
    const username = data.email.split('@')[0].toLowerCase();
    setBusy(true);
    try {
      const d = await post('/users', {
        username, email: data.email, password: 'TentorBaru#2026', fullName: nama, roleCode: 'tentor', tutorId: Number(id),
      });
      toast.success(`Akun login dibuat: ${username} / TentorBaru#2026 (wajib diganti setelah login pertama)`);
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const doReset = async () => {
    if (!data.userAccount) return;
    setBusy(true);
    try {
      const d = await post(`/users/${data.userAccount.id}/reset-password`, { newPassword: pw || undefined });
      toast.success(d.message);
      setResetPw(false); setPw('');
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHead title={data.fullName} desc={`ID: ${data.employeeId} • ${data.expertise || '-'} • Bergabung ${tgl(data.joinDate)}`}
        actions={<Link to="/tentor" className="btn-outline">← Kembali</Link>} />

      <div className="card p-4 mb-4 flex flex-wrap gap-4 items-center">
        <div className="w-14 h-14 rounded-xl bg-navy text-white flex items-center justify-center text-xl font-bold">{data.fullName?.[0]}</div>
        <div><div className="text-[11px] text-slate-400">Status</div><Badge status={data.status} /></div>
        <div><div className="text-[11px] text-slate-400">Email</div><div className="text-sm font-semibold">{data.email || '-'}</div></div>
        <div><div className="text-[11px] text-slate-400">No. HP</div><div className="text-sm font-semibold">{data.phone || '-'}</div></div>
        <div><div className="text-[11px] text-slate-400">Kelas Diampu</div><div className="text-sm font-semibold">{data.classes.filter((c) => c.status === 'aktif').length}</div></div>
        {data.isDemo && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-1 rounded font-bold">DATA SIMULASI</span>}
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'profil', label: 'Profil' },
        { key: 'kelas', label: 'Kelas Diampu', count: data.classes.length },
        { key: 'jadwal', label: 'Jadwal Mengajar', count: data.schedules.length },
        { key: 'absensi', label: 'Riwayat Absensi' },
        { key: 'akun', label: 'Akun Login' },
      ]} />

      <div className="card p-4 sm:p-5">
        {tab === 'profil' && (
          <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
            {[['Nama Lengkap', data.fullName], ['ID Internal', data.employeeId], ['Nomor Identitas', data.idNumber],
              ['Email', data.email], ['Nomor HP', data.phone], ['Pendidikan Terakhir', data.education],
              ['Bidang Keahlian', data.expertise], ['Program Diampu', [...new Set(data.classes.map((c) => c.program_name).filter(Boolean))].join(', ')],
              ['Mata Pelajaran Diampu', [...new Set(data.classes.map((c) => c.subject_name).filter(Boolean))].join(', ')],
              ['Tanggal Bergabung', tgl(data.joinDate)], ['Alamat', data.address], ['Status', data.status]].map(([k, v]) => (
              <div key={k} className="border-b border-slate-50 pb-2">
                <dt className="text-[11px] uppercase text-slate-400 font-semibold">{k}</dt>
                <dd className="text-sm text-slate-700 font-medium">{v || '-'}</dd>
              </div>
            ))}
          </dl>
        )}

        {tab === 'kelas' && (
          <Table rows={data.classes} empty="Belum mengampu kelas."
            columns={[
              { label: 'Kode', key: 'class_code', className: 'font-mono text-xs' },
              { label: 'Nama Kelas', key: 'name' },
              { label: 'Program', render: (r) => r.program_name || <span className="text-slate-400">-</span> },
              { label: 'Mata Pelajaran', render: (r) => r.subject_name || <span className="text-slate-400">-</span> },
              { label: 'Jenjang', key: 'level', center: true },
              { label: 'Jenis', render: (r) => <Badge status={r.type} /> },
              { label: 'Jumlah Siswa', center: true, key: 'student_count' },
              { label: 'Status', render: (r) => <Badge status={r.status} /> },
            ]} />
        )}

        {tab === 'jadwal' && (
          <Table rows={data.schedules} empty="Belum ada jadwal mengajar."
            columns={[
              { label: 'Hari', render: (r) => <b>{hariNama(r.day_of_week)}</b> },
              { label: 'Jam', render: (r) => `${r.start_time} – ${r.end_time}` },
              { label: 'Kelas', key: 'class_name' },
              { label: 'Lokasi', key: 'location' },
              { label: 'Status', render: (r) => <Badge status={r.status} /> },
            ]} />
        )}

        {tab === 'absensi' && (
          att == null ? <Spinner /> : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[['Total', att.length], ['Hadir', att.filter((a) => a.status === 'hadir').length],
                  ['Izin/Sakit', att.filter((a) => ['izin', 'sakit'].includes(a.status)).length],
                  ['Tidak Hadir', att.filter((a) => a.status === 'tidak_hadir').length]].map(([l, v]) => (
                  <div key={l} className="bg-slate-50 rounded-lg p-3 text-center">
                    <div className="text-lg font-bold text-navy">{v}</div><div className="text-[11px] text-slate-500">{l}</div>
                  </div>
                ))}
              </div>
              <Table rows={att.slice(0, 100)} empty="Belum ada absensi tentor."
                columns={[
                  { label: 'Tanggal', render: (r) => tgl(r.att_date) },
                  { label: 'Status Kehadiran', render: (r) => <Badge status={r.status} /> },
                  { label: 'Pelaksanaan', render: (r) => <Badge status={r.learning_status || '-'} children={(r.learning_status || '-').replace(/_/g, ' ')} /> },
                  { label: 'Kelas', key: 'class_name' },
                  { label: 'Catatan', render: (r) => <span className="text-xs">{r.note || '-'}</span> },
                ]} />
            </>
          )
        )}

        {tab === 'akun' && (
          <div className="max-w-lg">
            {data.userAccount ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <div className="text-sm"><b>Username:</b> {data.userAccount.username}</div>
                <div className="text-sm"><b>Status akun:</b> {data.userAccount.is_active ? 'Aktif' : 'Nonaktif'}</div>
                <div className="text-xs text-slate-500 mt-1">Akun ini dibuat oleh direktur dan terhubung ke profil tentor ini.</div>
                {isAdmin && user.role === 'direktur' && (
                  <button className="btn-outline btn-sm mt-3" onClick={() => setResetPw(true)}>Reset Password</button>
                )}
              </div>
            ) : (
              <div>
                <p className="text-sm text-slate-500 mb-3">Tentor ini belum memiliki akun login.</p>
                {isAdmin && user.role === 'direktur' && (
                  <button className="btn-primary" onClick={createAccount} disabled={busy}>{busy ? 'Memproses...' : 'Buat Akun Login untuk Tentor'}</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <Modal open={resetPw} onClose={() => setResetPw(false)} title="Reset Password Tentor"
        footer={<><button className="btn-outline" onClick={() => setResetPw(false)}>Batal</button>
          <button className="btn-primary" onClick={doReset} disabled={busy}>{busy ? 'Menyimpan...' : 'Reset'}</button></>}>
        <Field label="Password Baru (kosongkan untuk default 'RumahPintar123')">
          <Input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="minimal 6 karakter" />
        </Field>
        <p className="text-xs text-slate-500">Pengguna akan diminta mengganti password saat login berikutnya.</p>
      </Modal>
    </div>
  );
}
