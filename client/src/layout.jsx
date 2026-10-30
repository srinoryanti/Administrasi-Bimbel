import React, { useState, useMemo } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { post } from './api';
import { useToast } from './ui';

const NAV = [
  { group: 'Utama', items: [
    { to: '/', label: 'Dashboard', roles: ['direktur', 'sekretaris', 'tentor'] },
    { to: '/jadwal', label: 'Jadwal & Kelas', roles: ['direktur', 'sekretaris', 'tentor'] },
  ]},
  { group: 'Data Pokok', items: [
    { to: '/siswa', label: 'Data Siswa', roles: ['direktur', 'sekretaris', 'tentor'] },
    { to: '/tentor', label: 'Data Tentor', roles: ['direktur', 'sekretaris', 'tentor'] },
    { to: '/program', label: 'Program Bimbel', roles: ['direktur', 'sekretaris'] },
  ]},
  { group: 'Kegiatan Belajar', items: [
    { to: '/absensi', label: 'Absensi Siswa', roles: ['direktur', 'sekretaris', 'tentor'] },
    { to: '/absensi-tentor', label: 'Absensi Tentor', roles: ['direktur', 'sekretaris'] },
    { to: '/jurnal', label: 'Jurnal Mengajar', roles: ['direktur', 'sekretaris', 'tentor'] },
    { to: '/nilai', label: 'Nilai & Evaluasi', roles: ['direktur', 'sekretaris', 'tentor'] },
    { to: '/rapor', label: 'Rapor Perkembangan', roles: ['direktur', 'sekretaris', 'tentor'] },
  ]},
  { group: 'Administrasi', items: [
    { to: '/arsip', label: 'Arsip Digital', roles: ['direktur', 'sekretaris', 'tentor'] },
    { to: '/pembayaran', label: 'Tagihan & Pembayaran', roles: ['direktur', 'sekretaris'] },
    { to: '/laporan', label: 'Pusat Laporan', roles: ['direktur', 'sekretaris'] },
  ]},
  { group: 'Sistem', items: [
    { to: '/pengguna', label: 'Pengguna & Aktivitas', roles: ['direktur', 'sekretaris'] },
  ]},
];

export default function Layout({ title, children }) {
  const { user, logout, refresh } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pwModal, setPwModal] = useState(false);

  const groups = useMemo(() => NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.roles.includes(user?.role)),
  })).filter((g) => g.items.length), [user]);

  const activeLabel = useMemo(() => {
    for (const g of NAV) for (const i of g.items) if (i.to === loc.pathname) return i.label;
    if (loc.pathname.startsWith('/siswa/')) return 'Detail Siswa';
    if (loc.pathname.startsWith('/tentor/')) return 'Detail Tentor';
    if (loc.pathname.startsWith('/rapor/')) return 'Editor Rapor';
    return title || 'Beranda';
  }, [loc.pathname, title]);

  const doLogout = async () => {
    await logout();
    toast.info('Anda telah keluar dari sistem.');
    nav('/login');
  };

  return (
    <div className="min-h-screen flex bg-mist">
      {/* Sidebar */}
      <aside className={`no-print fixed lg:static inset-y-0 left-0 z-40 w-64 bg-navy text-white flex flex-col transform transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-5 py-5 border-b border-white/10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white text-navy font-black flex items-center justify-center text-lg shrink-0">RP</div>
          <div className="min-w-0">
            <div className="font-bold leading-tight text-sm">BIMBEL RUMAH PINTAR</div>
            <div className="text-[11px] text-sky-200 truncate">Sistem Informasi Manajemen</div>
          </div>
          <button className="ml-auto lg:hidden text-2xl" onClick={() => setOpen(false)}>&times;</button>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-3 space-y-4">
          {groups.map((g) => (
            <div key={g.group}>
              <div className="px-3 mb-1 text-[10px] font-bold uppercase tracking-wider text-sky-300/70">{g.group}</div>
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/'}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${
                      isActive ? 'bg-white text-navy font-bold' : 'text-slate-200 hover:bg-white/10'}`}>
                  {i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10 text-[11px] text-sky-200/80">
          Asia/Jakarta • v1.0
        </div>
      </aside>
      {open && <div className="fixed inset-0 bg-slate-900/50 z-30 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="no-print bg-white border-b border-slate-200 sticky top-0 z-20">
          <div className="h-14 px-4 flex items-center gap-3">
            <button className="lg:hidden text-2xl text-navy" onClick={() => setOpen(true)}>&#9776;</button>
            <div className="font-bold text-navy text-sm sm:text-base truncate">{activeLabel}</div>
            <div className="ml-auto flex items-center gap-3 relative">
              <div className="hidden sm:block text-right leading-tight">
                <div className="text-sm font-semibold text-navy truncate max-w-[160px]">{user?.fullName}</div>
                <div className="text-[11px] text-slate-500">{user?.roleName}</div>
              </div>
              <button onClick={() => setMenu(!menu)}
                className="w-9 h-9 rounded-full bg-navy text-white font-bold text-sm shrink-0 hover:bg-navy-dark">
                {user?.fullName?.[0] || '?'}
              </button>
              {menu && (
                <div className="absolute right-0 top-11 bg-white border border-slate-200 rounded-xl shadow-lg w-56 py-2 z-30">
                  <div className="px-4 py-2 border-b border-slate-100">
                    <div className="text-sm font-semibold text-navy">{user?.fullName}</div>
                    <div className="text-[11px] text-slate-500">{user?.email || user?.username}</div>
                    <div className="text-[11px] text-sky-600 font-semibold mt-0.5">{user?.roleName}</div>
                  </div>
                  <button className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50" onClick={() => { setMenu(false); setPwModal(true); }}>Ganti Password</button>
                  <button className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50" onClick={() => { setMenu(false); doLogout(); }}>Keluar (Logout)</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1400px] w-full mx-auto">
          {children}
        </main>
      </div>

      <ChangePasswordModal open={pwModal} onClose={() => setPwModal(false)} firstTime={user?.mustChangePassword} onDone={refresh} />
    </div>
  );
}

function ChangePasswordModal({ open, onClose, firstTime, onDone }) {
  const toast = useToast();
  const [oldP, setOldP] = useState('');
  const [newP, setNewP] = useState('');
  const [newP2, setNewP2] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const submit = async () => {
    if (newP.length < 6) return toast.error('Password baru minimal 6 karakter.');
    if (newP !== newP2) return toast.error('Konfirmasi password tidak sama.');
    setBusy(true);
    try {
      const d = await post('/auth/change-password', { oldPassword: oldP, newPassword: newP });
      toast.success(d.message);
      setOldP(''); setNewP(''); setNewP2('');
      await onDone?.();
      if (!firstTime) onClose();
    } catch (e) {
      toast.error(e.message);
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md p-6">
        <h3 className="font-bold text-navy mb-1">Ganti Password</h3>
        <p className="text-xs text-slate-500 mb-4">{firstTime ? 'Anda diminta mengganti password bawaan saat pertama kali login.' : 'Perbarui password akun Anda.'}</p>
        <label className="label">Password Lama</label>
        <input type="password" className="input mb-3" value={oldP} onChange={(e) => setOldP(e.target.value)} />
        <label className="label">Password Baru</label>
        <input type="password" className="input mb-3" value={newP} onChange={(e) => setNewP(e.target.value)} />
        <label className="label">Ulangi Password Baru</label>
        <input type="password" className="input mb-4" value={newP2} onChange={(e) => setNewP2(e.target.value)} />
        <div className="flex justify-end gap-2">
          {!firstTime && <button className="btn-outline" onClick={onClose}>Batal</button>}
          <button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Password'}</button>
        </div>
      </div>
    </div>
  );
}
