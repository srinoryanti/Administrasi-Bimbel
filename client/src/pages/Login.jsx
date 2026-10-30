import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { useToast } from '../ui';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!identifier.trim() || !password) {
      setErr('Email/username dan password wajib diisi.');
      return;
    }
    setBusy(true);
    try {
      const u = await login(identifier.trim(), password);
      toast.success(`Selamat datang, ${u.fullName}!`);
      nav('/');
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* Identitas visual */}
      <div className="bg-navy text-white flex flex-col justify-between p-8 sm:p-12 relative overflow-hidden">
        <div className="absolute -right-20 -top-20 w-72 h-72 rounded-full bg-sky-500/20" />
        <div className="absolute -left-16 bottom-10 w-56 h-56 rounded-full bg-sky-400/10" />
        <div className="relative">
          <div className="w-16 h-16 rounded-2xl bg-white text-navy font-black flex items-center justify-center text-2xl mb-6">RP</div>
          <h1 className="text-2xl sm:text-3xl font-black leading-tight">BIMBEL RUMAH PINTAR</h1>
          <p className="text-sky-200 mt-2 text-sm">Sistem Informasi Manajemen Bimbel</p>
        </div>
        <div className="relative hidden sm:block">
          <p className="text-lg font-semibold leading-relaxed text-sky-100">
            Kelola siswa, tentor, kelas, absensi, rapor perkembangan, arsip digital, dan pembayaran dalam satu sistem yang terintegrasi.
          </p>
          <div className="mt-6 grid grid-cols-3 gap-3 text-center text-xs">
            {[['Data', 'Tersentralisasi'], ['Hak Akses', 'Berbasis Peran'], ['Laporan', 'PDF & Excel']].map(([a, b]) => (
              <div key={a} className="bg-white/10 rounded-xl py-3">
                <div className="font-bold">{a}</div>
                <div className="text-sky-200">{b}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="relative text-[11px] text-sky-300/80">© 2026 Bimbel Rumah Pintar • Asia/Jakarta</div>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center p-6 sm:p-10 bg-white">
        <form onSubmit={submit} className="w-full max-w-md">
          <h2 className="text-2xl font-bold text-navy">Masuk ke Aplikasi</h2>
          <p className="text-sm text-slate-500 mt-1 mb-6">Silakan login menggunakan akun yang telah diberikan pengelola.</p>

          {err && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3">{err}</div>
          )}

          <label className="label">Email / Username</label>
          <input className="input mb-4" value={identifier} onChange={(e) => setIdentifier(e.target.value)}
            placeholder="mis. direktur" autoComplete="username" disabled={busy} />

          <label className="label">Password</label>
          <div className="relative mb-2">
            <input type={show ? 'text' : 'password'} className="input pr-16" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" disabled={busy} />
            <button type="button" onClick={() => setShow(!show)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-semibold text-navy hover:underline px-2 py-1">
              {show ? 'Sembunyikan' : 'Tampilkan'}
            </button>
          </div>

          <button className="btn-primary w-full mt-4 py-2.5" disabled={busy}>
            {busy ? 'Memproses...' : 'Masuk (Login)'}
          </button>

          <div className="mt-6 rounded-lg bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-500 leading-relaxed">
            <b className="text-slate-700">Akun demo (lingkungan pengembangan):</b><br />
            direktur / Direktur#2026 • sekretaris / Sekretaris#2026<br />
            tentor1 / Tentor#2026 • tentor2 / Tentor#2026
          </div>
        </form>
      </div>
    </div>
  );
}
