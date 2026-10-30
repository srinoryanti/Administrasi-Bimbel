export function tgl(d) {
  if (!d) return '-';
  const s = String(d).slice(0, 10).split('-');
  if (s.length !== 3) return String(d);
  return `${s[2]}-${s[1]}-${s[0]}`;
}

export function rupiah(n) {
  const v = Number(n || 0);
  return 'Rp ' + v.toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

export function hariNama(dow) {
  return ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'][dow] || '-';
}

export function hariPendek(dow) {
  return ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][dow] || '-';
}

export function statusBadge(status) {
  const map = {
    aktif: 'bg-emerald-100 text-emerald-700',
    lunas: 'bg-emerald-100 text-emerald-700',
    hadir: 'bg-emerald-100 text-emerald-700',
    disetujui: 'bg-emerald-100 text-emerald-700',
    diterbitkan: 'bg-sky-100 text-sky-700',
    selesai: 'bg-sky-100 text-sky-700',
    terjadwal: 'bg-sky-100 text-sky-700',
    menunggu: 'bg-amber-100 text-amber-700',
    sebagian: 'bg-amber-100 text-amber-700',
    revisi: 'bg-orange-100 text-orange-700',
    cuti: 'bg-amber-100 text-amber-700',
    sakit: 'bg-amber-100 text-amber-700',
    izin: 'bg-sky-100 text-sky-700',
    draf: 'bg-slate-200 text-slate-600',
    belum: 'bg-slate-200 text-slate-600',
    alpa: 'bg-red-100 text-red-700',
    jatuh_tempo: 'bg-red-100 text-red-700',
    batal: 'bg-red-100 text-red-700',
    berhenti: 'bg-red-100 text-red-700',
    nonaktif: 'bg-red-100 text-red-700',
    tidak_hadir: 'bg-red-100 text-red-700',
    privat: 'bg-violet-100 text-violet-700',
    kelompok: 'bg-sky-100 text-sky-700',
  };
  const label = {
    jatuh_tempo: 'Jatuh tempo',
    tidak_hadir: 'Tidak hadir',
    menunggu: 'Menunggu pemeriksaan',
  };
  const cls = map[status] || 'bg-slate-200 text-slate-600';
  return { cls, label: label[status] || String(status || '-').replace(/_/g, ' ') };
}

export const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

export function today() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })).toISOString().slice(0, 10);
}

export function monthNow() {
  return today().slice(0, 7);
}
