import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth, can } from './auth';
import { Spinner } from './ui';
import Layout from './layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Students from './pages/Students';
import Programs from './pages/Programs';
import StudentDetail from './pages/StudentDetail';
import Tutors from './pages/Tutors';
import TutorDetail from './pages/TutorDetail';
import Schedules from './pages/Schedules';
import Attendance from './pages/Attendance';
import AttendanceRecap from './pages/AttendanceRecap';
import TutorAttendance from './pages/TutorAttendance';
import Journals from './pages/Journals';
import Assessments from './pages/Assessments';
import Reports from './pages/Reports';
import ReportEditor from './pages/ReportEditor';
import Archives from './pages/Archives';
import Billing from './pages/Billing';
import Laporan from './pages/Laporan';
import Users from './pages/Users';

function Guard({ roles, children }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (roles && !roles.includes(user.role)) {
    return (
      <Layout>
        <div className="card p-10 text-center">
          <h2 className="text-lg font-bold text-navy">Akses Ditolak</h2>
          <p className="text-sm text-slate-500 mt-1">Peran <b>{user.roleName}</b> tidak memiliki hak mengakses halaman ini.</p>
        </div>
      </Layout>
    );
  }
  return children;
}

const wrap = (roles, element) => <Guard roles={roles}>{<Layout>{element}</Layout>}</Guard>;

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner /></div>;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  const all = ['direktur', 'sekretaris', 'tentor'];
  const admin = ['direktur', 'sekretaris'];

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/" element={wrap(all, <Dashboard />)} />
      <Route path="/siswa" element={wrap(all, <Students />)} />
      <Route path="/program" element={wrap(admin, <Programs />)} />
      <Route path="/siswa/:id" element={wrap(all, <StudentDetail />)} />
      <Route path="/tentor" element={wrap(all, <Tutors />)} />
      <Route path="/tentor/:id" element={wrap(all, <TutorDetail />)} />
      <Route path="/jadwal" element={wrap(all, <Schedules />)} />
      <Route path="/absensi" element={wrap(all, <Attendance />)} />
      <Route path="/absensi/rekap" element={wrap(admin, <AttendanceRecap />)} />
      <Route path="/absensi-tentor" element={wrap(admin, <TutorAttendance />)} />
      <Route path="/jurnal" element={wrap(all, <Journals />)} />
      <Route path="/nilai" element={wrap(all, <Assessments />)} />
      <Route path="/rapor" element={wrap(all, <Reports />)} />
      <Route path="/rapor/:id" element={wrap(all, <ReportEditor />)} />
      <Route path="/arsip" element={wrap(all, <Archives />)} />
      <Route path="/pembayaran" element={wrap(admin, <Billing />)} />
      <Route path="/laporan" element={wrap(admin, <Laporan />)} />
      <Route path="/pengguna" element={wrap(['direktur', 'sekretaris'], <Users />)} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
