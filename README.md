# Sistem Informasi Manajemen Bimbel — Rumah Pintar

Aplikasi web full-stack untuk operasional bimbel: data siswa & tentor, kelas & jadwal, absensi siswa/tentor, jurnal mengajar, penilaian, rapor + PDF, arsip digital, tagihan & pembayaran, laporan (Excel/PDF), dan audit log. Tiga peran: **Direktur**, **Sekretaris**, **Tentor** — seluruh hak akses ditegakkan di backend (middleware `requireRole`).

## Teknologi

- **Frontend**: React 18 + Vite + Tailwind CSS + React Router + Recharts (`client/`)
- **Backend**: Express + JWT (httpOnly cookie) + bcryptjs + multer + pdfkit + exceljs + AWS SDK v3 (`server/`)
- **Basis data**: **lokal** → SQLite file `server/data/bimbel.db` (bawaan `node:sqlite`, tanpa instalasi eksternal); **produksi** → **Cloudflare D1** via REST API. Pemilihan otomatis dari env `D1_*`
- **Penyimpanan berkas**: **lokal** → `server/uploads/`; **produksi** → **Backblaze B2** (S3-compatible). Pemilihan otomatis dari env `B2_*`

Kode memakai satu abstraksi yang sama untuk kedua backend: `server/src/drivers/{local,d1}.js` (API `prepare().run/get/all`, `exec`, `batch` — selalu `await`) dan `server/src/storage.js` (`put/get/exists/stream/remove`).

## Cara Menjalankan (Pengembangan)

Prasyarat: **Node.js ≥ 22.5** (fitur `node:sqlite` bawaan — sudah diverifikasi pada Node 24).

```powershell
# 1. Backend (port 4000)
cd server
npm install
node src/seed.js --reset      # buat DB + data simulasi (opsional untuk produksi)
node src/index.js

# 2. Frontend (port 5173, proxy /api → :4000) — terminal terpisah
cd client
npm install --include=dev     # penting: pakai --include=dev agar vite terpasang
npm run dev
```

Buka `http://localhost:5173`.

> Catatan Windows: jika `NODE_ENV=production` ter-set di sistem, `npm install` akan melewatkan devDependencies (vite tidak terpasang). Selalu gunakan `npm install --include=dev` di folder `client`.

## Cara Menjalankan (Produksi Lokal)

```powershell
cd client && npm run build    # hasil di client/dist (di-serve oleh Express)
cd ../server && node src/index.js
```

Buka `http://localhost:4000` (port bisa diubah lewat variabel lingkungan `PORT`).

## Deploy ke Render + Cloudflare D1 + Backblaze B2

File `render.yaml` sudah disediakan. Urutan pengerjaan:

**1. Cloudflare D1**

```powershell
# Buat database, lalu salin nilai dari dashboard (Workers & Pages → D1 → Overview & API)
$env:D1_ACCOUNT_ID="..."; $env:D1_API_TOKEN="..."; $env:D1_DATABASE_ID="..."
npm run seed:d1        # terapkan skema + migrasi kolom + roles/pengaturan default
npm run migrate:d1     # (opsional) salin data dari SQLite lokal ke D1
# npm run migrate:d1 -- --dry-run   # lihat jumlah baris tanpa mengirim apa pun
```

**2. Backblaze B2**

Buat bucket (mis. `bimbel-rumah-pintar`) + *App Key*, lalu catat `B2_KEY_ID`, `B2_KEY`, `B2_BUCKET`, `B2_REGION`.

**3. Render**

Buat **Web Service** dari repo ini (`render.yaml` terbaca otomatis). Isi env yang ditandai `sync: false`:

| Variabel | Isi |
|---|---|
| `JWT_SECRET` | sudah digenerate Render (atau ganti sendiri) |
| `D1_ACCOUNT_ID`, `D1_API_TOKEN`, `D1_DATABASE_ID` | dari langkah 1 |
| `B2_KEY_ID`, `B2_KEY`, `B2_BUCKET`, `B2_REGION` | dari langkah 2 |

Build: `npm install --prefix client && npm run build --prefix client && npm install --prefix server` · Start: `npm start --prefix server` · Health check: `/api/health`.

**4. Akun awal**

Di Render → Shell:

```powershell
npm run create-admin     # env ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD (opsional)
```

Atau set `ADMIN_*` sebagai env var lalu buka `GET /api/auth/bootstrap-director` (hanya aktif bila belum ada akun direktur sama sekali).

**Catatan**

- Tanpa env `D1_*` aplikasi memakai SQLite lokal; tanpa env `B2_*` berkas disimpan di `server/uploads/` — jadi pengembangan lokal tetap berjalan seperti biasa.
- Filesystem Render bersih tiap deploy → semua unggahan **wajib** lewat B2.
- `npm run seed` (data demo) hanya untuk SQLite lokal. Untuk D1 gunakan `npm run seed:d1` lalu `npm run migrate:d1`.

## Kredensial Simulasi (hasil seed)

| Username    | Password          | Peran      |
|-------------|-------------------|------------|
| `direktur`  | `Direktur#2026`   | Direktur   |
| `sekretaris`| `Sekretaris#2026` | Sekretaris |
| `tentor1`   | `Tentor#2026`     | Tentor (Dewi Lestari) |
| `tentor2`   | `Tentor#2026`     | Tentor (Rizky Pratama) |

**Ganti semua password di atas sebelum dipakai sungguhan** (menu Pengguna → Reset Password, hanya direktur). Saat login pertama, setiap akun diminta mengganti password.

## Membuat Akun Direktur Awal (tanpa data simulasi)

Jalankan backend **tanpa** seed, lalu di folder `server`:

```powershell
node create-admin.js
```

Script akan meminta username, nama lengkap, dan password, lalu membuat akun direktur. Alternatif: set variabel lingkungan lalu buka `http://localhost:4000/api/auth/bootstrap-director` (hanya aktif bila belum ada akun direktur sama sekali — lihat `server/src/index.js`).

## Menghapus Data Demo

Saat login sebagai direktur: **Pengguna** → (atau panggil) `POST /api/maintenance/purge-demo` — menghapus semua baris ber-flag `is_demo` (siswa, tentor, kelas, absensi, jurnal, nilai, rapor, tagihan, pembayaran, arsip demo) tanpa menyentuh akun login. Data yang Anda masukkan sendiri tidak ikut terhapus. Anda juga bisa reset penuh: matikan server, hapus `server/data/bimbel.db*`, lalu jalankan ulang `node src/seed.js --reset` (untuk lingkungan demo) atau biarkan kosong untuk produksi.

## Ringkasan Fitur per Modul

- **Dashboard** — statistik berbeda per peran, grafik pemasukan & siswa/bulan, aktivitas terbaru.
- **Program Bimbel** — master program berbasis durasi & kuota (mis. Calistung 90 mnt/12× per bulan, Reguler A SD/MI 90 mnt/12×, Reguler B 60 mnt/24×), dipakai oleh data siswa, kelas, dan penentu jam selesai jadwal otomatis. Program yang masih dipakai hanya dinonaktifkan, bukan dihapus.
- **Siswa** — CRUD, pilihan program dari master program, wali/penanggung jawab, detail multi-tab (profil, kelas, absensi, nilai, rapor, tagihan, arsip, dokumen). Siswa berhenti tidak dihapus permanen bila punya riwayat.
- **Tentor** — CRUD, penautan akun login tentor, reset password, detail (kelas + program diampu, jadwal, absensi).
- **Kelas & Jadwal** — kelas privat/kelompok berbasis program (mapel opsional untuk penilaian SD ke atas), penjadwalan mingguan, deteksi bentrok jadwal, **jam selesai otomatis dari durasi program** (bisa di-override), generate daftar pertemuan (rentang tanggal **atau per bulan sesuai kuota program**), rekap **Target Bulanan** (tercapai / belum) per kelas, ubah status pertemuan.
- **Absensi Siswa** — per pertemuan oleh tentor; koreksi oleh sekretaris/direktur wajib mencantumkan catatan perubahan (tercatat di audit log).
- **Rekap Absensi** — rekap bulanan & ringkasan; absensi tentor (kehadiran + status pelaksanaan).
- **Jurnal Mengajar** — tentor mengisi materi, tujuan, kendala, hasil per pertemuan.
- **Nilai / Evaluasi** — penilaian per mapel per periode (skala 1–4 untuk rapor), koreksi bernote.
- **Rapor** — alur `draf → menunggu → (revisi | disetujui) → diterbitkan`; rekap absensi otomatis; ekspor PDF + salinan otomatis ke arsip.
- **Arsip Digital** — unggah PDF/gambar/Office (maks 10 MB) ke penyimpanan internal (di luar folder publik), unduh terotorisasi, riwayat versi, pengelompokan per tahun, pembatasan akses tentor.
- **Tagihan & Pembayaran** — tagihan per periode, pembayaran penuh/sebagian (transaksi DB), kuitansi PDF, pembatalan pembayaran (direktur, wajib alasan, riwayat tetap tersimpan), ringkasan pemasukan & tunggakan.
- **Laporan** — 16 jenis laporan operasional/keuangan, ekspor **Excel** (`.xlsx`, format rupiah) dan **PDF**.
- **Pengguna & Audit** — manajemen akun per peran (hanya direktur), reset password, nonaktifkan akun, riwayat aktivitas (audit log) tercatat otomatis untuk semua aksi penting.

## Konvensi

- Seluruh tampilan berbahasa Indonesia; tanggal format **DD-MM-YYYY**; mata uang **Rp**; zona waktu **Asia/Jakarta**.
- Password minimal 6 karakter; akun baru wajib ganti password saat login pertama.
- Data penting **tidak dihapus permanen** bila memiliki riwayat — diberi status nonaktif/dibatalkan (soft-delete).
- Unggahan arsip: ekstensi whitelist, maks 10 MB, disimpan di `server/uploads/archive/YYYY-MM/` dengan nama acak; akses hanya melalui endpoint terproteksi yang memeriksa sesi & peran.

## Struktur Proyek

```
BIMBEL/
├── render.yaml           # konfigurasi deploy Render (build + start + env)
├── scripts/
│   ├── seed-d1.js        # skema + roles default ke Cloudflare D1
│   └── migrate-to-d1.js  # salin data SQLite lokal → D1 (--dry-run / --force)
├── server/
│   ├── src/
│   │   ├── index.js            # entry Express, mounting semua route, bootstrap DB
│   │   ├── db.js               # skema SQL + migrasi kolom + helper (audit, nextNumber, settings)
│   │   ├── drivers/            # local.js (node:sqlite) & d1.js (REST Cloudflare) — API identik
│   │   ├── storage.js          # lapisan berkas: lokal (uploads/) atau Backblaze B2
│   │   ├── seed.js             # data simulasi (--reset untuk buat ulang)
│   │   ├── create-admin.js     # buat akun direktur awal
│   │   ├── pdf.js              # generator PDF (rapor, kuitansi, tabel laporan)
│   │   ├── middleware/         # auth (JWT+RBAC), helpers
│   │   └── routes/             # auth, users, students, tutors, catalog, classes,
│   │                           # attendance, journals, assessments, reports,
│   │                           # archives, billing, dashboard, laporan
│   ├── .env.example            # template variabel lingkungan (D1_*, B2_*, JWT_SECRET, ...)
│   └── uploads/                # penyimpanan berkas lokal (dev) — diabaikan git
└── client/
    └── src/
        ├── App.jsx             # routing + guard per peran
        ├── auth.jsx, api.js    # sesi, fetch ber-cookie
        ├── ui.jsx, layout.jsx  # komponen dasar & shell sidebar
        └── pages/              # Login, Dashboard, Students, StudentDetail, Tutors,
                                # TutorDetail, Schedules, Attendance, AttendanceRecap,
                                # TutorAttendance, Journals, Assessments, Reports,
                                # ReportEditor, Archives, Billing, Laporan, Users
```

## Uji Cepat API (Opsional)

Dengan server berjalan di port 4000, contoh PowerShell / Node fetch login:

```js
const res = await fetch('http://localhost:4000/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'direktur', password: 'Direktur#2026' }),
});
// cookie sesi disimpan httpOnly — gunakan browser untuk alur lengkap
```

Endpoint kesehatan: `GET /api/health`.
