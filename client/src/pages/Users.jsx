import React, { useEffect, useState, useCallback } from 'react';
import { get, post, put, del } from '../api';
import { useAuth } from '../auth';
import { PageHead, Tabs, Table, Modal, Field, Input, Select, Badge, useToast } from '../ui';

const empty = { username: '', fullName: '', email: '', password: '', roleCode: 'sekretaris', tutorId: '', isActive: true };

export default function Users() {
  const toast = useToast();
  const { user: me, logout } = useAuth();
  const [tab, setTab] = useState('akun');
  const [rows, setRows] = useState([]);
  const [logs, setLogs] = useState([]);
  const [roles, setRoles] = useState([]);
  const [tutors, setTutors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [logSearch, setLogSearch] = useState('');

  const isDirector = me.role === 'direktur';

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([get('/users'), isDirector ? get('/users/audit-logs').catch(() => ({ data: [] })) : Promise.resolve({ data: [] })])
      .then(([u, l]) => { setRows(u.data); setLogs(l.data); })
      .catch((e) => toast.error(e.message)).finally(() => setLoading(false));
  }, [isDirector]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    get('/users/roles').then((d) => setRoles(d.data)).catch(() => {});
    get('/tutors?status=aktif').then((d) => setTutors(d.data)).catch(() => {});
  }, []);

  const filteredLogs = logs.filter((l) => !logSearch ||
    [l.user_name, l.action, l.entity, l.detail, l.ip].some((v) => v && String(v).toLowerCase().includes(logSearch.toLowerCase())));

  const save = async () => {
    const d = form;
    if (!d.id) {
      if (!d.username || !d.password || !d.fullName) return toast.error('Username, nama lengkap, dan password wajib diisi.');
      if (d.password.length < 6) return toast.error('Password minimal 6 karakter.');
      if (d.roleCode === 'tentor' && !d.tutorId) return toast.error('Akun tentor harus ditautkan ke data tentor.');
    }
    setBusy(true);
    try {
      if (d.id) {
        const r = await put(`/users/${d.id}`, {
          email: d.email, fullName: d.fullName, roleCode: d.roleCode,
          tutorId: d.tutorId ? Number(d.tutorId) : null, isActive: d.isActive,
        });
        toast.success(r.message);
      } else {
        const r = await post('/users', {
          username: d.username, email: d.email, password: d.password, fullName: d.fullName,
          roleCode: d.roleCode, tutorId: d.tutorId ? Number(d.tutorId) : null, isActive: d.isActive,
        });
        toast.success(r.message + ' (wajib ganti password saat login pertama)');
      }
      setForm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const resetPw = async () => {
    setBusy(true);
    try {
      const r = await post(`/users/${confirm.id}/reset-password`, { newPassword: confirm.newPassword || 'RumahPintar123' });
      toast.success(r.message);
      setConfirm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const deactivate = async () => {
    setBusy(true);
    try {
      const r = await del(`/users/${confirm.id}`);
      toast.success(r.message);
      setConfirm(null); load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <PageHead title="Pengguna & Hak Akses" desc="Akun sistem (direktur, sekretaris, tentor) & riwayat aktivitas"
        actions={isDirector && <button className="btn-primary" onClick={() => setForm({ ...empty })}>+ Buat Akun</button>} />

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'akun', label: 'Akun Pengguna', count: rows.length },
        ...(isDirector ? [{ key: 'log', label: 'Riwayat Aktivitas', count: logs.length }] : []),
      ]} />

      {tab === 'akun' ? (
        <div className="card p-4">
          <Table loading={loading} rows={rows} empty="Belum ada akun."
            columns={[
              { label: 'Username', render: (r) => <span className="font-mono text-xs">{r.username}</span> },
              { label: 'Nama Lengkap', render: (r) => <div><div className="font-semibold text-navy">{r.full_name}</div>{r.email && <div className="text-[11px] text-slate-400">{r.email}</div>}</div> },
              { label: 'Peran', render: (r) => <Badge status={r.role_code} children={r.role_name} /> },
              { label: 'Terkait Tentor', render: (r) => <span className="text-xs">{r.tutor_name || '-'}</span> },
              { label: 'Login Terakhir', render: (r) => <span className="text-xs">{r.last_login_at || 'belum pernah'}</span> },
              { label: 'Wajib Ganti PW', center: true, render: (r) => r.must_change_password ? <Badge status="menunggu" children="Ya" /> : <span className="text-xs text-slate-400">-</span> },
              { label: 'Status', render: (r) => <Badge status={r.is_active ? 'aktif' : 'berhenti'} children={r.is_active ? 'Aktif' : 'Nonaktif'} /> },
              ...(isDirector ? [{ label: 'Aksi', center: true, render: (r) => (
                <div className="flex gap-1 justify-center">
                  <button className="btn-outline btn-sm" onClick={() => setForm({
                    id: r.id, username: r.username, fullName: r.full_name, email: r.email || '',
                    roleCode: r.role_code, tutorId: r.tutor_id || '', isActive: !!r.is_active,
                  })}>Ubah</button>
                  <button className="btn-outline btn-sm" onClick={() => setConfirm({ mode: 'reset', id: r.id, username: r.username, newPassword: '' })}>Reset</button>
                  {r.id !== me.id && r.is_active ? (
                    <button className="btn-outline btn-sm !text-red-600" onClick={() => setConfirm({ mode: 'off', id: r.id, username: r.username })}>Nonaktif</button>
                  ) : null}
                </div>
              ) }] : []),
            ]} />
          {!isDirector && <p className="text-xs text-slate-400 mt-3">Peran sekretaris hanya dapat melihat daftar akun; pengelolaan akun dilakukan oleh direktur.</p>}
        </div>
      ) : (
        <div className="card p-4">
          <Input placeholder="Cari pengguna, aksi, entitas, detail, atau IP..." value={logSearch} onChange={(e) => setLogSearch(e.target.value)} className="mb-3" />
          <Table loading={loading} rows={filteredLogs} empty="Tidak ada aktivitas untuk pencarian ini."
            columns={[
              { label: 'Waktu', render: (r) => <span className="text-xs whitespace-nowrap">{r.created_at}</span> },
              { label: 'Pengguna', render: (r) => <span className="font-semibold text-navy">{r.user_name || 'sistem'}</span> },
              { label: 'Aksi', render: (r) => <span className="font-mono text-[11px] bg-navy/5 px-2 py-0.5 rounded">{r.action}</span> },
              { label: 'Entitas', render: (r) => <span className="text-xs">{r.entity || '-'}{r.entity_id ? ` #${r.entity_id}` : ''}</span> },
              { label: 'Detail', render: (r) => <span className="text-xs text-slate-500 max-w-xs truncate inline-block align-middle">{r.detail || '-'}</span> },
              { label: 'IP', render: (r) => <span className="font-mono text-[11px]">{r.ip || '-'}</span> },
            ]} />
        </div>
      )}

      {/* Modal buat/ubah akun */}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? `Ubah Akun ${form.username}` : 'Buat Akun Baru'}
        footer={<><button className="btn-outline" onClick={() => setForm(null)}>Batal</button>
          <button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan'}</button></>}>
        {form && (
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Username" required><Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} disabled={!!form.id} /></Field>
            <Field label="Nama Lengkap" required><Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Peran" required><Select value={form.roleCode} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>
              {roles.filter((r) => r.code !== 'direktur' || isDirector).map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
            </Select></Field>
            {form.roleCode === 'tentor' && (
              <div className="sm:col-span-2">
                <Field label="Tautkan ke Tentor" required>
                  <Select value={form.tutorId} onChange={(e) => setForm({ ...form, tutorId: e.target.value })}>
                    <option value="">-- Pilih Tentor --</option>
                    {tutors.map((t) => <option key={t.id} value={t.id}>{t.fullName} ({t.employeeId})</option>)}
                  </Select>
                </Field>
              </div>
            )}
            {!form.id && (
              <div className="sm:col-span-2">
                <Field label="Password Awal" required hint="min. 6 karakter — wajib diganti saat login pertama">
                  <Input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                </Field>
              </div>
            )}
            {form.id && (
              <div className="sm:col-span-2 flex items-center gap-2">
                <input id="act" type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                <label htmlFor="act" className="text-sm">Akun aktif (bisa login)</label>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Reset password */}
      <Modal open={confirm?.mode === 'reset'} onClose={() => setConfirm(null)} title={`Reset Password — ${confirm?.username || ''}`}
        footer={<><button className="btn-outline" onClick={() => setConfirm(null)}>Batal</button>
          <button className="btn-primary" onClick={resetPw} disabled={busy}>{busy ? 'Memproses...' : 'Reset Password'}</button></>}>
        <div className="text-sm text-slate-600">
          <p className="mb-3">Masukkan password baru, atau biarkan kosong untuk menggunakan default <b>RumahPintar123</b>. Pengguna akan diminta mengganti password saat login berikutnya.</p>
          <Field label="Password Baru"><Input type="text" value={confirm?.newPassword || ''} onChange={(e) => setConfirm({ ...confirm, newPassword: e.target.value })} /></Field>
        </div>
      </Modal>

      {/* Nonaktifkan akun */}
      <Modal open={confirm?.mode === 'off'} onClose={() => setConfirm(null)} title="Nonaktifkan Akun"
        footer={<><button className="btn-outline" onClick={() => setConfirm(null)}>Batal</button>
          <button className="btn-danger" onClick={deactivate} disabled={busy}>{busy ? 'Memproses...' : 'Nonaktifkan'}</button></>}>
        <p className="text-sm text-slate-600">Akun <b>{confirm?.username}</b> akan dinonaktifkan dan tidak dapat digunakan untuk login. Data aktivitas sebelumnya tetap tersimpan.</p>
      </Modal>
    </div>
  );
}
