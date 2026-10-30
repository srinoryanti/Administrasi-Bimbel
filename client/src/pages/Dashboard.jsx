import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell, Legend } from 'recharts';
import { useAuth } from '../auth';
import { get } from '../api';
import { Spinner, StatCard, Badge, PageHead, useToast } from '../ui';
import { tgl, rupiah, HARI } from '../format';

const COLORS = ['#1e3a5f', '#3b6291', '#7da7d9', '#d97706', '#0f9d58'];

function monthLabel(m) {
  if (!m) return '';
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const [y, mm] = m.split('-');
  return `${names[Number(mm) - 1]} ${y.slice(2)}`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const toast = useToast();

  useEffect(() => {
    get('/dashboard').then((d) => setData(d.data)).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="card p-8 text-center text-red-600">{err}</div>;
  if (!data) return <Spinner />;

  if (user.role === 'tentor') return <DashboardTentor data={data} />;
  if (user.role === 'sekretaris') return <DashboardSekretaris data={data} />;
  return <DashboardDirektur data={data} />;
}

/* ============ DIREKTUR ============ */
function DashboardDirektur({ data: d }) {
  const att = d.attendanceToday || {};
  const attendanceData = [
    { name: 'Hadir', value: att.hadir || 0 },
    { name: 'Tidak Hadir', value: (att.izin || 0) + (att.sakit || 0) + (att.alpa || 0) },
  ];
  return (
    <div>
      <PageHead title="Dashboard Direktur" desc="Ringkasan keseluruhan aktivitas Bimbel Rumah Pintar" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <StatCard label="Siswa Aktif" value={d.activeStudents} />
        <StatCard label="Tentor Aktif" value={d.activeTutors} tone="blue" />
        <StatCard label="Kelas Aktif" value={d.activeClasses} tone="green" />
        <StatCard label="Siswa Baru (bulanan)" value={d.newStudents} tone="amber" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <StatCard label="Total Pemasukan" value={rupiah(d.totalIncome)} tone="green" />
        <StatCard label="Tagihan Belum Lunas" value={rupiah(d.unpaidTotal)} sub={`${d.unpaidCount} tagihan`} tone="red" />
        <StatCard label="Kehadiran Siswa Hari Ini" value={att.total ? `${Math.round(((att.hadir || 0) / att.total) * 100)}%` : '-'} sub={`${att.hadir || 0} dari ${att.total || 0} hadir`} tone="blue" />
        <StatCard label="Kehadiran Tentor Bulan Ini" value={d.tutorAttendanceMonth.total ? `${Math.round((d.tutorAttendanceMonth.hadir / d.tutorAttendanceMonth.total) * 100)}%` : '-'} sub={`${d.tutorAttendanceMonth.hadir} dari ${d.tutorAttendanceMonth.total} hadir`} tone="navy" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-5">
        <div className="card p-4">
          <h3 className="font-bold text-navy text-sm mb-3">Jumlah Siswa per Bulan (Pendaftaran)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={(d.studentsPerMonth || []).map((r) => ({ ...r, label: monthLabel(r.month) }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} />
              <Tooltip />
              <Bar dataKey="n" name="Siswa" fill="#1e3a5f" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card p-4">
          <h3 className="font-bold text-navy text-sm mb-3">Pembayaran per Bulan (Rupiah)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={(d.incomeMonthly || []).map((r) => ({ ...r, label: monthLabel(r.month) }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis fontSize={11} tickFormatter={(v) => `${Math.round(v / 1e6)}jt`} />
              <Tooltip formatter={(v) => rupiah(v)} />
              <Line type="monotone" dataKey="total" name="Pemasukan" stroke="#0f9d58" strokeWidth={2.5} dot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-4">
          <h3 className="font-bold text-navy text-sm mb-3">Ringkasan Kehadiran Siswa Hari Ini</h3>
          <ResponsiveContainer width="100%" height={190}>
            <PieChart>
              <Pie data={attendanceData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={4}>
                {attendanceData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
              </Pie>
              <Legend fontSize={11} />
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <h3 className="font-bold text-navy text-sm mb-3">Rapor Belum Diterbitkan</h3>
          {d.pendingReports.length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">Semua rapor sudah diterbitkan.</p>
          ) : (
            <ul className="space-y-2">
              {d.pendingReports.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-xs border-b border-slate-50 pb-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-700 truncate">{r.student_name}</div>
                    <div className="text-slate-400 truncate">{r.period_name} • {r.report_code}</div>
                  </div>
                  <Badge status={r.status} />
                </li>
              ))}
            </ul>
          )}
          <Link to="/rapor" className="text-xs text-navy font-semibold hover:underline mt-2 inline-block">Buka modul rapor →</Link>
        </div>

        <div className="card p-4">
          <h3 className="font-bold text-navy text-sm mb-3">Aktivitas Terbaru</h3>
          <ul className="space-y-2">
            {d.latestActivities.slice(0, 7).map((a) => (
              <li key={a.id} className="text-xs border-b border-slate-50 pb-2">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-slate-700">{a.user_name || 'Sistem'}</span>
                  <span className="text-slate-400 shrink-0">{(a.created_at || '').slice(0, 10)}</span>
                </div>
                <div className="text-slate-500">{a.action.replace(/_/g, ' ').toLowerCase()} {a.entity ? `• ${a.entity}` : ''}</div>
              </li>
            ))}
          </ul>
          <Link to="/pengguna" className="text-xs text-navy font-semibold hover:underline mt-2 inline-block">Lihat semua riwayat →</Link>
        </div>
      </div>

      <div className="card p-4 mt-4">
        <h3 className="font-bold text-navy text-sm mb-3">Ringkasan Perkembangan Belajar (Rata-rata Nilai Akhir)</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={d.development || []}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="full_name" fontSize={10} tickFormatter={(v) => String(v).split(' ')[0]} />
            <YAxis domain={[0, 100]} fontSize={11} />
            <Tooltip />
            <Bar dataKey="avg_score" name="Rata-rata" fill="#3b6291" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ============ SEKRETARIS ============ */
function DashboardSekretaris({ data: d }) {
  const { user } = useAuth();
  const nav = useNavigate();
  return (
    <div>
      <PageHead title="Dashboard Sekretaris" desc="Administrasi sehari-hari Bimbel Rumah Pintar"
        actions={<button className="btn-primary" onClick={() => nav('/siswa')}>+ Tambah Siswa</button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <StatCard label="Siswa Aktif" value={d.activeStudents} />
        <StatCard label="Tentor" value={d.activeTutors} tone="blue" />
        <StatCard label="Dokumen Siswa Belum Lengkap" value={d.incompleteDocs} tone="amber" />
        <StatCard label="Tagihan Belum Lunas" value={d.unpaidCount} sub={rupiah(d.unpaidTotal)} tone="red" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <div className="card p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-navy text-sm">Jadwal Pembelajaran Terdekat</h3>
            <Link to="/jadwal" className="text-xs text-navy font-semibold hover:underline">Semua jadwal →</Link>
          </div>
          <div className="space-y-2">
            {d.upcomingSessions.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">Tidak ada jadwal mendatang.</p>}
            {d.upcomingSessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 bg-slate-50 rounded-lg px-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-700 truncate">{s.class_name}</div>
                  <div className="text-[11px] text-slate-500">{tgl(s.session_date)} • {s.start_time}–{s.end_time} • {s.tutor_name}</div>
                </div>
                <Badge status={s.status} />
              </div>
            ))}
          </div>
        </div>
        <div className="card p-4">
          <h3 className="font-bold text-navy text-sm mb-3">Pembayaran Terbaru</h3>
          <ul className="space-y-2">
            {d.recentPayments.map((p, i) => (
              <li key={i} className="text-xs border-b border-slate-50 pb-2">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold text-slate-700 truncate">{p.student_name}</span>
                  <span className="font-bold text-emerald-600 shrink-0">{rupiah(p.amount)}</span>
                </div>
                <div className="text-slate-400">{tgl(p.paid_at)} • {p.method} • {p.transaction_number}</div>
              </li>
            ))}
            {d.recentPayments.length === 0 && <li className="text-xs text-slate-400 text-center py-4">Belum ada pembayaran.</li>}
          </ul>
          <Link to="/pembayaran" className="text-xs text-navy font-semibold hover:underline mt-2 inline-block">Kelola pembayaran →</Link>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-navy text-sm">Rapor Menunggu Pemeriksaan</h3>
            <Link to="/rapor" className="text-xs text-navy font-semibold hover:underline">Periksa →</Link>
          </div>
          {d.pendingReports.filter((r) => r.status === 'menunggu').length === 0
            ? <p className="text-xs text-slate-400 py-4 text-center">Tidak ada rapor menunggu pemeriksaan.</p>
            : d.pendingReports.filter((r) => r.status === 'menunggu').slice(0, 6).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 py-2 border-b border-slate-50">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-700 truncate">{r.student_name}</div>
                  <div className="text-[11px] text-slate-400">{r.period_name}</div>
                </div>
                <Link to={`/rapor/${r.id}`} className="btn-outline btn-sm">Periksa</Link>
              </div>
            ))}
        </div>

        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-navy text-sm">Rekap Absensi Hari Ini</h3>
            <Link to="/absensi/rekap" className="text-xs text-navy font-semibold hover:underline">Rekap lengkap →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Hadir', d.attendanceToday.hadir, 'text-emerald-600'],
              ['Tidak Hadir', d.attendanceToday.tidak, 'text-red-600'],
              ['Total Absensi', d.attendanceToday.total, 'text-navy'],
              ['Arsip Terbaru', 'Lihat', 'text-navy'],
            ].map(([l, v, c], i) => (
              <div key={i} className="bg-slate-50 rounded-lg p-3">
                <div className={`text-xl font-bold ${c}`}>{v}</div>
                <div className="text-[11px] text-slate-500">{l}</div>
              </div>
            ))}
          </div>
          <Link to="/arsip" className="btn-outline btn-sm mt-3 w-full">Buka Arsip Digital</Link>
        </div>
      </div>
    </div>
  );
}

/* ============ TENTOR ============ */
function DashboardTentor({ data: d }) {
  const now = new Date();
  const jamSekarang = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const dow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })).getDay();
  const reportsPending = (d.reportsByStatus || []).filter((r) => r.status !== 'diterbitkan').reduce((a, b) => a + b.n, 0);
  const reportsDone = (d.reportsByStatus || []).find((r) => r.status === 'diterbitkan')?.n || 0;

  return (
    <div>
      <PageHead title="Dashboard Tentor" desc={`${dayNames[dow]} • Jadwal dan tanggung jawab mengajar Anda`} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <StatCard label="Kelas Diampu" value={d.myClasses.length} />
        <StatCard label="Siswa Diampu" value={d.totalStudents} tone="blue" />
        <StatCard label="Jurnal Belum Diisi" value={d.pendingJournals} tone={d.pendingJournals > 0 ? 'amber' : 'green'} />
        <StatCard label="Rapor Belum Selesai" value={reportsPending} tone={reportsPending > 0 ? 'red' : 'green'} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="card p-4 lg:col-span-2">
          <h3 className="font-bold text-navy text-sm mb-3">Jadwal Mengajar Hari Ini</h3>
          {d.todaySchedules.length === 0 && <p className="text-xs text-slate-400 py-6 text-center">Tidak ada jadwal mengajar hari ini.</p>}
          <div className="space-y-2">
            {d.todaySchedules.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 bg-navy/[0.04] border border-navy/10 rounded-lg px-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="text-center bg-white rounded-lg px-2 py-1 border border-slate-200 shrink-0">
                    <div className="text-sm font-bold text-navy leading-none">{s.start_time}</div>
                    <div className="text-[10px] text-slate-400 leading-none mt-0.5">{s.end_time}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-700 truncate">{s.className}</div>
                    <div className="text-[11px] text-slate-500">{s.subjectName || '-'} • {s.location || '-'}</div>
                  </div>
                </div>
                <span className={`text-[11px] font-bold px-2 py-1 rounded-full shrink-0 ${jamSekarang >= s.start_time && jamSekarang <= s.end_time ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {jamSekarang >= s.start_time && jamSekarang <= s.end_time ? 'Berlangsung' : 'Terjadwal'}
                </span>
              </div>
            ))}
          </div>

          <h3 className="font-bold text-navy text-sm mt-5 mb-3">Pertemuan (Butuh Absensi / Jurnal)</h3>
          {d.todaySessions.length === 0 ? (
            <p className="text-xs text-slate-400 py-4 text-center">Tidak ada pertemuan hari ini.</p>
          ) : d.todaySessions.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2.5 mb-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-700 truncate">{s.class_name} • {s.start_time}–{s.end_time}</div>
                <div className="text-[11px] text-slate-500">Absensi: {s.filled}/{s.total} siswa {s.has_journal ? '• Jurnal ✓' : '• Jurnal belum'}</div>
              </div>
              <Link to="/absensi" className="btn-primary btn-sm">Isi Absensi</Link>
            </div>
          ))}
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="font-bold text-navy text-sm mb-3">Kelas Diampu</h3>
            <ul className="space-y-2">
              {d.myClasses.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 text-xs border-b border-slate-50 pb-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-700 truncate">{c.name}</div>
                    <div className="text-slate-400">{c.subject_name || '-'} • {c.student_count} siswa</div>
                  </div>
                  <Badge status={c.type} />
                </li>
              ))}
            </ul>
          </div>

          <div className="card p-4">
            <h3 className="font-bold text-navy text-sm mb-3">Siswa & Evaluasi Terbaru</h3>
            <ul className="space-y-2">
              {d.recentEvaluations.slice(0, 5).map((e, i) => (
                <li key={i} className="text-xs border-b border-slate-50 pb-2">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold text-slate-700 truncate">{e.student_name}</span>
                    <span className="font-bold text-navy">{e.final_score ?? '-'}</span>
                  </div>
                  <div className="text-slate-400">{e.subject_name} • {e.period_label}</div>
                </li>
              ))}
              {d.recentEvaluations.length === 0 && <li className="text-xs text-slate-400 text-center py-3">Belum ada nilai.</li>}
            </ul>
            <Link to="/rapor" className="text-xs text-navy font-semibold hoverunderline mt-2 inline-block">Kelola rapor ({reportsDone} terbit) →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
