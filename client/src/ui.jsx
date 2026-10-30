import React, { createContext, useContext, useState, useCallback } from 'react';
import { statusBadge } from './format';

/* ---------- Toast ---------- */
const ToastCtx = createContext(null);
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((type, msg) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, type, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const toast = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  };
  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="fixed top-4 right-4 z-[100] space-y-2 w-[min(92vw,360px)]">
        {toasts.map((t) => (
          <div key={t.id}
            className={`rounded-lg px-4 py-3 text-sm font-medium shadow-lg border flex items-start gap-2 animate-[fadeIn_.2s_ease] ${
              t.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : t.type === 'error' ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-sky-50 border-sky-200 text-sky-800'}`}>
            <span className="mt-0.5">{t.type === 'success' ? '✓' : t.type === 'error' ? '✕' : 'ℹ'}</span>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- Modal ---------- */
export function Modal({ open, onClose, title, children, wide, footer }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`bg-white w-full ${wide ? 'max-w-4xl' : 'max-w-xl'} rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col`}>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <h3 className="font-bold text-navy">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none px-2">&times;</button>
        </div>
        <div className="p-5 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Konfirmasi hapus ---------- */
export function Confirm({ open, onClose, onConfirm, title, message, loading }) {
  return (
    <Modal open={open} onClose={onClose} title={title || 'Konfirmasi Tindakan'}
      footer={<>
        <button className="btn-outline" onClick={onClose} disabled={loading}>Batal</button>
        <button className="btn-danger" onClick={onConfirm} disabled={loading}>{loading ? 'Memproses...' : 'Ya, lanjutkan'}</button>
      </>}>
      <p className="text-sm text-slate-600 leading-relaxed">{message}</p>
    </Modal>
  );
}

/* ---------- Kartu statistik ---------- */
export function StatCard({ label, value, sub, icon, tone = 'navy' }) {
  const tones = {
    navy: 'bg-navy text-white', blue: 'bg-sky-500 text-white', green: 'bg-emerald-500 text-white',
    amber: 'bg-amber-500 text-white', red: 'bg-red-500 text-white', white: 'bg-white text-navy border border-slate-200',
  };
  return (
    <div className="card p-4 flex items-center gap-3">
      {icon && <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0 ${tones[tone]}`}>{icon}</div>}
      <div className="min-w-0">
        <div className="text-xl sm:text-2xl font-bold text-navy leading-tight truncate">{value}</div>
        <div className="text-xs text-slate-500 truncate">{label}</div>
        {sub && <div className="text-[11px] text-slate-400 truncate">{sub}</div>}
      </div>
    </div>
  );
}

/* ---------- Badge status ---------- */
export function Badge({ status, children }) {
  const b = statusBadge(status);
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${b.cls}`}>{children || b.label}</span>;
}

/* ---------- Field / Input ---------- */
export function Field({ label, required, children, hint }) {
  return (
    <label className="block mb-3">
      <span className="label">{label} {required && <span className="text-red-500">*</span>}</span>
      {children}
      {hint && <span className="text-[11px] text-slate-400 mt-0.5 block">{hint}</span>}
    </label>
  );
}

export function Input(props) { return <input {...props} className={`input ${props.className || ''}`} />; }
export function Select({ children, ...props }) { return <select {...props} className={`input ${props.className || ''}`}>{children}</select>; }
export function Textarea(props) { return <textarea {...props} className={`input ${props.className || ''}`} rows={props.rows || 3} />; }

/* ---------- Tabel ---------- */
export function Table({ columns, rows, empty = 'Belum ada data.', loading, onRowClick }) {
  if (loading) return <TableSkeleton cols={columns.length} />;
  if (!rows || rows.length === 0) {
    return <div className="py-10 text-center text-sm text-slate-400">{empty}</div>;
  }
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full border-collapse min-w-[600px]">
        <thead>
          <tr className="bg-navy">
            {columns.map((c, i) => <th key={i} className={`th ${c.center ? 'text-center' : ''} ${c.className || ''}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r.id ?? ri}
              className={`${onRowClick ? 'cursor-pointer hover:bg-sky-50/60' : 'odd:bg-white even:bg-slate-50/60'} transition-colors`}
              onClick={() => onRowClick && onRowClick(r)}>
              {columns.map((c, ci) => (
                <td key={ci} className={`td ${c.center ? 'text-center' : ''} ${c.className || ''}`}>
                  {c.render ? c.render(r) : (r[c.key] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TableSkeleton({ cols = 5, rows = 5 }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 rounded bg-slate-100 animate-pulse" style={{ opacity: 1 - i * 0.12 }} />
      ))}
    </div>
  );
}

export function Spinner({ label = 'Memuat data...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-slate-400 gap-3">
      <div className="w-9 h-9 border-4 border-slate-200 border-t-navy rounded-full animate-spin" />
      <span className="text-xs">{label}</span>
    </div>
  );
}

export function Empty({ text, action }) {
  return (
    <div className="py-12 text-center">
      <p className="text-sm text-slate-400 mb-3">{text}</p>
      {action}
    </div>
  );
}

/* ---------- Halaman header ---------- */
export function PageHead({ title, desc, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-navy">{title}</h1>
        {desc && <p className="text-xs sm:text-sm text-slate-500 mt-0.5">{desc}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="flex gap-1 border-b border-slate-200 overflow-x-auto mb-4">
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`px-4 py-2.5 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px transition-colors ${
            active === t.key ? 'border-navy text-navy' : 'border-transparent text-slate-500 hover:text-navy'}`}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 text-[11px] bg-slate-100 px-1.5 py-0.5 rounded-full">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
