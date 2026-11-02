import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { get, post, put } from '../api';
import { PageHead, Spinner, Badge, Tabs, Field, Textarea, useToast, Modal } from '../ui';
import { tgl } from '../format';
import { exportRaporPdf } from '../export';

const STATUS_FLOW = [
  { key: 'draf', label: 'Draf' },
  { key: 'menunggu', label: 'Menunggu Pemeriksaan' },
  { key: 'revisi', label: 'Perlu Revisi' },
  { key: 'disetujui', label: 'Disetujui' },
  { key: 'diterbitkan', label: 'Diterbitkan' },
];

export default function ReportEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('isi');
  const [form, setForm] = useState({ indicators: [], mastered: '', improve: '', difficulties: '', positive: '', suggestion: '', parent: '', conclusion: '' });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [note, setNote] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);

  const downloadPdf = async () => {
    setPdfBusy(true);
    try {
      await exportRaporPdf(data);
      toast.success('PDF rapor berhasil diunduh.');
    } catch (e) { toast.error(e.message); } finally { setPdfBusy(false); }
  };

  const load = useCallback(() => {
    get(`/reports/${id}`).then((d) => {
      setData(d.data);
      setForm({
        indicators: d.data.indicators || [],
        mastered: d.data.notes.mastered || '', improve: d.data.notes.improve || '',
        difficulties: d.data.notes.difficulties || '', positive: d.data.notes.positive || '',
        suggestion: d.data.notes.suggestion || '', parent: d.data.notes.parent || '',
        conclusion: d.data.conclusion || '',
      });
    }).catch((e) => { toast.error(e.message); nav('/rapor'); });
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (!data) return <Spinner />;
  const editable = ['draf', 'revisi'].includes(data.status) && (user.role !== 'tentor' || data.tutorId === user.tutorId);
  const meta = (() => {
    const d = new Date(`${data.period.start_date || ''}T00:00:00`);
    const dt = isNaN(d) ? new Date() : d;
    const m = dt.getMonth() + 1;
    const y = dt.getFullYear();
    return { semester: m >= 7 ? 'I (SATU)' : 'II (DUA)', ta: m >= 7 ? `${y}/${y + 1}` : `${y - 1}/${y}` };
  })();

  const setInd = (i, patch) => {
    setForm((f) => {
      const arr = [...f.indicators];
      arr[i] = { ...arr[i], ...patch };
      return { ...f, indicators: arr };
    });
  };

  const save = async (silent) => {
    setBusy(true);
    try {
      const d = await put(`/reports/${id}`, {
        indicators: form.indicators.map((x) => ({ indicator: x.indicator, score: x.score ? Number(x.score) : null, note: x.note })),
        mastered: form.mastered, improve: form.improve, difficulties: form.difficulties,
        positive: form.positive, suggestion: form.suggestion, parent: form.parent, conclusion: form.conclusion,
      });
      if (!silent) toast.success(d.message);
      load();
      return true;
    } catch (e) { toast.error(e.message); return false; } finally { setBusy(false); }
  };

  const act = async () => {
    setBusy(true);
    try {
      let d;
      if (confirm.kind === 'submit') d = await post(`/reports/${id}/submit`, {});
      else if (confirm.kind === 'check') d = await post(`/reports/${id}/check`, { action: confirm.action, note });
      else if (confirm.kind === 'approve') d = await post(`/reports/${id}/approve`, {});
      else if (confirm.kind === 'publish') d = await post(`/reports/${id}/publish`, {});
      toast.success(d.message);
      setConfirm(null); setNote('');
      load();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  const submitFlow = async () => {
    if (editable) {
      const ok = await save(true);
      if (!ok) return;
    }
    setConfirm({ kind: 'submit' });
  };

  const filled = form.indicators.filter((i) => i.score).length;

  return (
    <div>
      <PageHead
        title={`Rapor ${data.reportCode}`}
        desc={`${data.student.fullName} • ${data.period.name} • ${data.className || '-'}`}
        actions={<>
          <Link to="/rapor" className="btn-outline">← Daftar Rapor</Link>
          {['disetujui', 'diterbitkan'].includes(data.status) || (data.status !== 'diterbitkan' && user.role !== 'tentor')
            ? <button className="btn-outline" disabled={pdfBusy} onClick={downloadPdf}>{pdfBusy ? 'Menyiapkan...' : 'Lihat PDF'}</button>
            : null}
        </>} />

      {/* Status timeline */}
      <div className="card p-4 mb-4 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {STATUS_FLOW.filter((s) => s.key !== 'revisi').map((s, i) => {
            const order = { draf: 0, menunggu: 1, disetujui: 2, diterbitkan: 3 };
            const cur = order[data.status] ?? (data.status === 'revisi' ? 0 : 0);
            const done = data.status === 'revisi' ? false : i <= cur;
            const activeStep = (data.status === 'revisi' && s.key === 'draf') || (data.status !== 'revisi' && order[data.status] === i);
            return (
              <React.Fragment key={s.key}>
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${
                  activeStep ? 'bg-navy text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                  <span>{done && !activeStep ? '✓' : i + 1}</span>{s.label}
                </div>
                {i < 3 && <div className={`w-6 h-0.5 ${done ? 'bg-emerald-300' : 'bg-slate-200'}`} />}
              </React.Fragment>
            );
          })}
          {data.status === 'revisi' && <span className="ml-2 text-xs font-bold text-orange-600 bg-orange-100 px-3 py-1.5 rounded-full">↺ Dikembalikan untuk revisi</span>}
        </div>
        {data.checkNote && <p className="text-xs text-orange-700 mt-2">Catatan pemeriksa: "{data.checkNote}"</p>}
        {data.status === 'revisi' && (
          <div className="mt-3 rounded-lg bg-orange-50 border border-orange-200 p-3 text-xs text-orange-800">
            Rapor ini dikembalikan untuk direvisi. Perbaiki bagian yang diminta lalu kirim ulang.
          </div>
        )}
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'isi', label: 'Isi Rapor' },
        { key: 'absensi', label: 'Rekap Absensi' },
        { key: 'nilai', label: 'Nilai Akademik' },
        { key: 'alur', label: 'Alur & Tindakan' },
      ]} />

      {tab === 'isi' && (
        <div className="card p-4 sm:p-5">
          {/* Identitas */}
          <div className="grid sm:grid-cols-4 gap-3 mb-5 bg-navy/[0.04] rounded-xl p-4">
            {[['Nama Siswa', data.student.fullName], ['NIS', data.student.nis],
              ['Program', data.student.program || '-'], ['Jenjang / Kelas', `${data.student.educationLevel || '-'} / ${data.student.schoolGrade || '-'}`],
              ['Kelas Bimbel', data.className || '-'], ['Tentor', data.tutorName],
              ['Periode', data.period.name], ['Tahun Ajaran', meta.ta]].map(([k, v]) => (
              <div key={k}><div className="text-[10px] uppercase text-slate-400 font-bold">{k}</div>
                <div className="text-sm font-semibold text-navy">{v}</div></div>
            ))}
          </div>

          {/* Indikator perkembangan */}
          <h4 className="font-bold text-navy text-sm mb-1">4. Penilaian Non-Akademik (Sikap & Keterampilan)</h4>
          <p className="text-[11px] text-slate-500 mb-3">Skala: {form.indicators.length ? data.scaleLabels.map((l, i) => `${i + 1} = ${l}`).join(' • ') : ''}</p>
          <div className="space-y-3 mb-6">
            {form.indicators.map((ind, i) => (
              <div key={ind.indicator} className="border border-slate-200 rounded-lg p-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <div className="flex-1 text-sm font-semibold text-slate-700">{ind.indicator}</div>
                  <div className="flex gap-1 shrink-0">
                    {[1, 2, 3, 4].map((s) => (
                      <button key={s} disabled={!editable}
                        onClick={() => setInd(i, { score: s })}
                        className={`w-8 h-8 rounded-lg text-xs font-bold border transition-colors ${
                          Number(ind.score) === s ? 'bg-navy border-navy text-white' : 'bg-white border-slate-300 text-slate-500 hover:border-navy disabled:opacity-40'}`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <input className="input mt-2 !py-1.5 text-xs" placeholder="Catatan indikator ini (opsional)" value={ind.note || ''}
                  disabled={!editable} onChange={(e) => setInd(i, { note: e.target.value })} />
              </div>
            ))}
          </div>

          <h4 className="font-bold text-navy text-sm mb-3">5. Catatan Tentor</h4>
          <div className="grid sm:grid-cols-2 gap-x-4">
            <Field label="Materi yang sudah dikuasai"><Textarea value={form.mastered} disabled={!editable} onChange={(e) => setForm({ ...form, mastered: e.target.value })} /></Field>
            <Field label="Materi yang perlu ditingkatkan"><Textarea value={form.improve} disabled={!editable} onChange={(e) => setForm({ ...form, improve: e.target.value })} /></Field>
            <Field label="Kesulitan yang dihadapi siswa"><Textarea value={form.difficulties} disabled={!editable} onChange={(e) => setForm({ ...form, difficulties: e.target.value })} /></Field>
            <Field label="Perkembangan positif"><Textarea value={form.positive} disabled={!editable} onChange={(e) => setForm({ ...form, positive: e.target.value })} /></Field>
            <Field label="Saran untuk pembelajaran selanjutnya"><Textarea value={form.suggestion} disabled={!editable} onChange={(e) => setForm({ ...form, suggestion: e.target.value })} /></Field>
            <Field label="Catatan tambahan untuk orang tua"><Textarea value={form.parent} disabled={!editable} onChange={(e) => setForm({ ...form, parent: e.target.value })} /></Field>
          </div>

          <h4 className="font-bold text-navy text-sm mb-2 mt-2">6. Kesimpulan & Rekomendasi</h4>
          <Field label="Catatan tutor pengampu & rekomendasi" hint="Tampil sebagai paragraf utama pada bagian “Catatan Tutor Pengampu dan Rekomendasi” di PDF. Sistem tidak mengarang pencapaian — tulis berdasarkan data riil.">
            <Textarea rows={4} value={form.conclusion} disabled={!editable} onChange={(e) => setForm({ ...form, conclusion: e.target.value })} />
          </Field>

          {editable ? (
            <div className="flex gap-2 justify-end border-t border-slate-100 pt-4">
              <button className="btn-outline" onClick={() => save()} disabled={busy}>{busy ? 'Menyimpan...' : 'Simpan Draf'}</button>
              <button className="btn-primary" onClick={submitFlow} disabled={busy}>
                {busy ? 'Memproses...' : `Kirim untuk Pemeriksaan (${filled}/${form.indicators.length} indikator terisi)`}
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 mt-2">
              {['menunggu', 'disetujui', 'diterbitkan'].includes(data.status)
                ? 'Rapor terkunci menunggu proses pemeriksaan/persetujuan. Hanya pengelola yang dapat mengambil tindakan alur.'
                : 'Anda tidak memiliki izin mengubah rapor ini.'}
            </p>
          )}
        </div>
      )}

      {tab === 'absensi' && (
        <div className="card p-5">
          <h4 className="font-bold text-navy mb-3">3. Rekap Kehadiran Periode {data.period.name}</h4>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
            {[['Pertemuan Dijadwalkan', data.attendance.scheduled, 'text-navy'],
              ['Hadir', data.attendance.hadir, 'text-emerald-600'], ['Izin', data.attendance.izin, 'text-sky-600'],
              ['Sakit', data.attendance.sakit, 'text-amber-600'], ['Alpa', data.attendance.alpa, 'text-red-600'],
              ['Persentase', `${data.attendance.percentage}%`, 'text-navy']].map(([l, v, c]) => (
              <div key={l} className="bg-slate-50 rounded-lg p-3 text-center">
                <div className={`text-xl font-bold ${c}`}>{v}</div>
                <div className="text-[11px] text-slate-500 leading-tight">{l}</div>
              </div>
            ))}
          </div>
          <div className="w-full h-3 bg-slate-200 rounded-full mt-4 overflow-hidden">
            <div className={`h-full ${data.attendance.percentage >= 80 ? 'bg-emerald-500' : data.attendance.percentage >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
              style={{ width: `${data.attendance.percentage}%` }} />
          </div>
          <p className="text-[11px] text-slate-500 mt-3">
            Dihitung dari pertemuan yang benar-benar dijadwalkan (status dibatalkan dikecualikan) dan catatan absensi yang ada.
            Data diperbarui otomatis setiap kali isi rapor disimpan.
          </p>
        </div>
      )}

      {tab === 'nilai' && (
        <div className="card p-5">
          <h4 className="font-bold text-navy mb-3">2. Penilaian Akademik — {data.period.name}</h4>
          {data.grades.length === 0 ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
              Belum ada data nilai untuk siswa dan periode ini. Nilai tidak ditampilkan/dibuat otomatis agar tidak mengarang data.
              Mintakan tentor menginput nilai pada modul <b>Nilai & Evaluasi</b>.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[760px]">
                <thead><tr className="bg-navy">
                  {['Mata Pelajaran', 'Kondisi Awal Masuk', 'Nilai Awal', 'Tugas', 'Latihan', 'Akhir', 'Ketercapaian'].map((h) => <th key={h} className="th">{h}</th>)}
                </tr></thead>
                <tbody>
                  {data.grades.map((g, i) => (
                    <tr key={i} className={i % 2 ? 'bg-slate-50' : ''}>
                      <td className="td font-semibold">{g.subject}</td>
                      <td className="td text-xs">{g.initialCondition || <span className="text-slate-400">belum diisi</span>}</td>
                      <td className="td text-center">{g.initial ?? <span className="text-amber-600 text-xs">belum ada data</span>}</td>
                      <td className="td text-center">{g.task ?? '-'}</td>
                      <td className="td text-center">{g.practice ?? '-'}</td>
                      <td className="td text-center font-bold text-navy">{g.final ?? '-'}</td>
                      <td className="td text-xs">{g.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'alur' && (
        <div className="card p-5">
          <h4 className="font-bold text-navy mb-3">Riwayat & Tindakan Alur Rapor</h4>
          <ul className="space-y-2 text-sm mb-5">
            <li className="flex justify-between border-b border-slate-50 pb-2"><span className="text-slate-500">Status saat ini</span><Badge status={data.status} children={STATUS_FLOW.find((s) => s.key === data.status)?.label || data.status} /></li>
            <li className="flex justify-between border-b border-slate-50 pb-2"><span className="text-slate-500">Dikirim untuk pemeriksaan</span><span className="font-semibold">{data.submittedAt || '-'}</span></li>
            <li className="flex justify-between border-b border-slate-50 pb-2"><span className="text-slate-500">Diperiksa sekretaris</span><span className="font-semibold">{data.checkedAt || '-'}</span></li>
            <li className="flex justify-between border-b border-slate-50 pb-2"><span className="text-slate-500">Persetujuan direktur</span><span className="font-semibold">{data.approvedAt || '-'}</span></li>
            <li className="flex justify-between border-b border-slate-50 pb-2"><span className="text-slate-500">Diterbitkan</span><span className="font-semibold">{data.publishedAt || '-'}</span></li>
          </ul>

          <div className="flex flex-wrap gap-2">
            {user.role === 'tentor' && ['draf', 'revisi'].includes(data.status) && (
              <button className="btn-primary" onClick={submitFlow} disabled={busy}>Kirim untuk Pemeriksaan</button>
            )}
            {['sekretaris', 'direktur'].includes(user.role) && data.status === 'menunggu' && <>
              <button className="btn-primary" onClick={() => setConfirm({ kind: 'check', action: 'approve' })} disabled={busy}>Periksa & Setujui</button>
              <button className="btn-outline !text-orange-600" onClick={() => setConfirm({ kind: 'check', action: 'revisi' })} disabled={busy}>Kembalikan untuk Revisi</button>
            </>}
            {user.role === 'direktur' && data.status === 'disetujui' && (
              <button className="btn-primary" onClick={() => setConfirm({ kind: 'approve' })} disabled={busy}>Persetujuan Akhir Direktur</button>
            )}
            {['sekretaris', 'direktur'].includes(user.role) && data.status === 'disetujui' && (
              <button className="btn-primary" onClick={() => setConfirm({ kind: 'publish' })} disabled={busy}>Terbitkan</button>
            )}
            {['disetujui', 'diterbitkan'].includes(data.status) && (
              <button className="btn-outline" disabled={pdfBusy} onClick={downloadPdf}>{pdfBusy ? 'Menyiapkan...' : 'Buka PDF'}</button>
            )}
          </div>

          <div className="mt-5 text-[11px] text-slate-500 bg-slate-50 rounded-lg p-3 leading-relaxed">
            <b>Aturan alur:</b> tentor menyimpan draf & mengirim → sekretaris memeriksa kelengkapan administrasi → direktur memberi persetujuan → sekretaris menerbitkan rapor. PDF dapat diunduh kapan saja setelah disetujui/diterbitkan.
          </div>
        </div>
      )}

      <Modal open={!!confirm} onClose={() => setConfirm(null)}
        title={confirm?.kind === 'submit' ? 'Kirim Rapor untuk Pemeriksaan'
          : confirm?.kind === 'check' ? (confirm.action === 'revisi' ? 'Kembalikan untuk Revisi' : 'Setujui Rapor')
          : confirm?.kind === 'approve' ? 'Persetujuan Akhir' : 'Terbitkan Rapor'}
        footer={<>
          <button className="btn-outline" onClick={() => setConfirm(null)}>Batal</button>
          <button className="btn-primary" onClick={act} disabled={busy || (confirm?.kind === 'check' && confirm.action === 'revisi' && !note.trim())}>
            {busy ? 'Memproses...' : 'Konfirmasi'}
          </button>
        </>}>
        {confirm?.kind === 'check' && confirm.action === 'revisi' ? (
          <Field label="Alasan pengembalian ke tentor (wajib)" required>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. Lengkapi catatan kesulitan siswa dan indikator konsentrasi" />
          </Field>
        ) : confirm?.kind === 'publish' ? (
          <p className="text-sm text-slate-600">Status rapor menjadi <b>Diterbitkan</b>. PDF rapor dapat diunduh kapan saja. Rapor terkunci setelah diterbitkan.</p>
        ) : confirm?.kind === 'check' ? (
          <Field label="Catatan pemeriksa (opsional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        ) : (
          <p className="text-sm text-slate-600">Rapor akan dikunci dari perubahan oleh tentor dan masuk antrean pemeriksaan sekretaris. Yakin?</p>
        )}
      </Modal>
    </div>
  );
}
