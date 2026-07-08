# Laporan Aplikasi Pecel Lele Pak Pon

**Untuk:** Pemilik warung
**Tanggal laporan:** 8 Juli 2026
**Status aplikasi:** Aktif digunakan

---

## 1. Ringkasan

Aplikasi **Pecel Lele Pak Pon** adalah sistem POS (kasir) + laporan internal yang dibangun khusus untuk warung ini. Aplikasi berjalan di **tablet kasir** (utamanya) dan bisa juga dibuka di HP. Tidak dibagikan ke pelanggan — hanya untuk operasional warung.

**Yang bisa dikerjakan lewat aplikasi:**
- Kasir input nota masuk (dua cara: foto nota fisik yang di-baca otomatis oleh AI, atau input langsung dari daftar menu).
- Otomatis cetak nota ke printer thermal dapur & minuman.
- Owner lihat laporan pemasukan harian dan bulanan (menu terlaris, total, dst).
- Owner atur daftar menu + harga.

**Prinsip desain:** minimal input manual, kasir sesedikit mungkin ngetik. Semua yang bisa di-otomatiskan sudah di-otomatiskan.

---

## 2. Fitur Utama

### 2.1. Input transaksi — dua jalur

**A. Foto nota (OCR AI Gemini)**
Kasir foto nota tulisan tangan → sistem otomatis baca menu + jumlah + total → kasir tinggal cek & konfirmasi. Cocok untuk warung sibuk yang tetap pakai nota kertas.

**B. Input langsung (POS)** *(baru shipped 8 Juli 2026)*
Kasir tap menu di layar → pilih variasi (mis. "Dada", "Paha atas +Rp 3.000") → tambah ke cart → simpan. Cocok untuk pesanan cepat atau saat nota fisik habis.

### 2.2. Sistem "Chip" per menu — variasi & catatan sekali tap

Owner bisa setup **pilihan cepat** per menu (mis. "Dada" / "Paha" / "Paha atas" untuk Ayam Goreng), lengkap dengan:
- **Tambahan harga opsional** — chip "Paha atas" bisa nambah Rp 3.000, chip "Goreng garing" tetap gratis
- **Grup eksklusif** — chip "Dada", "Paha", "Sayap" dikelompokkan jadi grup "bagian", kasir cuma bisa pilih 1

Kasir ga perlu ngetik variasi tiap kali — cukup tap chip. Historical harga tersimpan aman kalau owner ubah harga chip nanti.

### 2.3. Cetak nota otomatis (thermal printer + Android print-agent)

Setiap transaksi confirmed → otomatis **dua nota kitchen tercetak**:
- **Dapur** — pesanan makanan + nasi, format besar tanpa harga (cukup untuk dapur masak)
- **Minuman** — pesanan minuman, format sama

**Nota customer** (dengan harga + total + "Terima kasih") tersedia manual by request dari halaman detail transaksi.

Dukungan tambahan:
- Flag **📦 Bungkus** → nota dapur otomatis pakai banner besar "*** BUNGKUS ***" biar kelihatan jelas
- Print bypass OS freeze — pakai teknologi Firebase Cloud Messaging (FCM), tetap tercetak walau tablet lock screen atau OS batasi background app (khususnya HP Transsion HiOS / Xiaomi MIUI)
- Kalau agent printer offline, kasir dapat warning + bisa cetak manual dari detail transaksi setelah agent nyala

### 2.4. Laporan (untuk Owner)

**Harian ("Closingan")**
- Total pemasukan hari ini
- Jumlah transaksi
- 5 menu terlaris
- Angka bisa disamakan dengan uang fisik di kasir

**Bulanan**
- Chart bar pemasukan per hari
- Top menu bulan ini
- Trend visual

**History transaksi**
- Cari & filter per tanggal, per status (confirmed/draft), per takeaway
- Bisa edit transaksi lama kalau salah input (auto reprint delta ke dapur kalau ada perubahan)
- Soft delete 7 hari (bisa restore kalau salah hapus)

### 2.5. Menu Master

Owner CRUD menu:
- Nama, harga, kategori (makanan / nasi / minuman)
- Chip per menu (dengan tambahan harga + grup mutex opsional)
- Bisa nonaktifkan menu tanpa hilang dari transaksi lama

### 2.6. Multi-device

- **Tablet kasir** (primer) — layout 2-kolom, cepat untuk operasional
- **HP kasir / owner** (responsif) — layout 1-kolom stacked dengan tombol Simpan sticky di bawah
- **Login shared** — 1 akun untuk semua (owner + kasir), Supabase Auth

---

## 3. Arsitektur & Teknologi

### 3.1. Tech stack

| Komponen | Teknologi | Kenapa |
|---|---|---|
| **Frontend web** | Next.js 16 (App Router) + React 19 + TypeScript | Framework modern, cepat, mudah maintain |
| **UI** | Tailwind CSS + shadcn/ui | Komponen berkualitas, custom brand warm warung (navy/gold/brick) |
| **Database** | Supabase (Postgres) | Managed database, murah, backup otomatis |
| **Auth** | Supabase Auth | Session cookie based, aman |
| **AI OCR** | Google Gemini 3.5 Flash (via Google AI Studio) | Model AI paling cost-efficient untuk baca tulisan tangan |
| **Storage foto** | Supabase Storage | Terintegrasi dengan database, murah |
| **Hosting web** | Vercel | Deploy otomatis dari GitHub, edge network cepat, gratis di tier hobby |
| **Cron job** | Vercel Cron | Auto cleanup foto lama, print history lama, dsb |
| **Print agent** | Android native app (Kotlin) | Terhubung ke printer LAN via TCP socket, background service tahan OS freeze |
| **Push notification** | Firebase Cloud Messaging (FCM) | Cara paling andal kirim print job ke agent walau HP idle |
| **Testing** | Vitest | Unit + integration test, saat ini 205 test |

### 3.2. Alur data

```
┌──────────────────┐
│  Kasir (tablet)  │
└────────┬─────────┘
         │
         ├─── Foto nota ────► Gemini OCR ──► Review edit ──┐
         │                                                 │
         └─── POS input ────► Cart + chips ────────────────┤
                                                           ▼
                                                  ┌────────────────┐
                                                  │  Supabase DB   │◄──── Owner
                                                  │  (transactions │      (laporan,
                                                  │  + items       │      menu master)
                                                  │  + menu_chips) │
                                                  └────────┬───────┘
                                                           │
                                                           ▼
                                              ┌────────────────────┐
                                              │  FCM push          │
                                              │  ke print agent    │
                                              │  (HP + Android app)│
                                              └────────┬───────────┘
                                                       │
                                                       ▼
                                        ┌──────────────────────────┐
                                        │  Printer thermal LAN     │
                                        │  Dapur + Minuman         │
                                        └──────────────────────────┘
```

### 3.3. Keamanan

- Semua data (transaksi, menu, chip) di database Supabase yang di-encrypt at rest.
- Row Level Security (RLS) — cuma user yang login yang bisa akses data.
- Session cookie httpOnly + secure di production.
- Zod validation di semua endpoint API — cegah data corrupt / injection.
- Rahasia (API key Gemini, Supabase key) tidak pernah masuk ke source code — pakai environment variable di Vercel.

### 3.4. Backup & retensi

- **Foto nota**: auto-hapus setelah 7 hari (menghemat storage). Data transaksi tetap.
- **Soft delete transaksi**: 7 hari bisa restore, setelah itu permanen.
- **Print history**: 7 hari untuk audit, lalu auto-cleanup.
- **Database backup**: Supabase auto-backup harian.

---

## 4. Biaya

### 4.1. Pengembangan (satu kali)

**Rp 5.000.000** — mencakup:
- Semua fitur di atas (input OCR, POS direct, chip system, print system, laporan, menu master)
- Deploy ke production Vercel
- Setup Supabase database + storage
- Android print-agent app (dari nol)
- Test coverage 205 tes otomatis
- Dokumentasi teknis lengkap

### 4.2. Maintenance tahunan

**Rp 500.000 / tahun** — mencakup:
- Bug fix kalau ada
- Update ringan sesuai request kecil
- Monitor kesehatan sistem (database quota, storage quota, error rate)
- Update dependency security patch

### 4.3. Biaya operasional bulanan

| Komponen | Perkiraan | Catatan |
|---|---|---|
| **AI Gemini OCR** | **Rp 150.000 – 300.000** | Tergantung volume — 150 foto/hari ≈ Rp 292.000/bulan @Rp 65/foto. Kalau kasir lebih sering pakai POS (input manual), biaya turun proporsional. |
| **Storage foto nota** | **Rp 50.000** | Storage Supabase paid tier untuk foto nota. Foto auto-hapus setelah 7 hari, jadi ga akan membengkak. |
| **Hosting Vercel** | Gratis | Tier hobby cukup untuk skala warung (10-500 request/hari). |
| **Database Supabase** | Gratis (tier free) | 500 MB cukup untuk >20 tahun data transaksi. |
| **Firebase (FCM print)** | Gratis | Push notification unlimited di free tier. |
| **Total per bulan** | **Rp 200.000 – 350.000** | |

### 4.4. Total biaya tahun pertama (skenario realistis)

| Item | Biaya |
|---|---|
| Pengembangan (one-time) | Rp 5.000.000 |
| Maintenance tahun pertama | Rp 500.000 |
| Operasional 12 bulan @Rp 275.000 | Rp 3.300.000 |
| **Total tahun pertama** | **Rp 8.800.000** |

### 4.5. Total biaya tahun berikutnya

| Item | Biaya |
|---|---|
| Maintenance | Rp 500.000 |
| Operasional 12 bulan | Rp 3.300.000 |
| **Total per tahun** | **Rp 3.800.000** |

---

## 5. Perbandingan Nilai

### 5.1. Kalau bikin dari nol pakai developer freelance

Aplikasi seperti ini kalau di-order ke developer freelance di Indonesia biasanya biayanya:
- Freelance junior: Rp 15.000.000 – Rp 25.000.000
- Freelance mid-senior: Rp 25.000.000 – Rp 50.000.000
- Agency: Rp 50.000.000 – Rp 100.000.000+

**Yang menaikkan harga vs POS generic:**
- OCR AI custom (bukan sekadar template)
- Print system dengan bypass OS freeze (susah, banyak edge case Android)
- Chip system dengan mutex_group (mirip fitur SaaS besar seperti Toast, Square)
- Auto delta print (edit transaksi cuma cetak yang berubah)

### 5.2. Kalau langganan SaaS POS (alternatif)

| Layanan | Biaya | Kelemahan untuk warung ini |
|---|---|---|
| MokaPOS Pro | Rp 299.000/bulan | Ga ada OCR foto nota, chip terbatas |
| Pawoon | Rp 250.000/bulan | Sama, ga bisa dikustomisasi |
| Luna POS | Rp 200.000-500.000/bulan | Pakainya lama pas rush (yang jadi motivasi bikin app ini) |
| Majoo | Rp 300.000+/bulan | Fitur bagus tapi kaku, ga cocok flow warung |

**Perbandingan 5 tahun:**
- **Pak Pon app:** Rp 5.000.000 + (Rp 3.800.000 × 4) = **Rp 20.200.000**
- **MokaPOS Pro:** Rp 299.000 × 60 = **Rp 17.940.000** (tapi ga ada OCR + ga sesuai flow warung + data ga bisa export)
- **Custom developer:** Rp 30.000.000+ dev + Rp 3.800.000 × 5 op = **Rp 49.000.000**

Aplikasi custom Pak Pon **cost-effective** dan sekaligus **fit ke workflow warung**, sesuatu yang SaaS umum ga bisa kasih.

### 5.3. Nilai jangka panjang

- **Data owned** — semua data transaksi milik warung, ga terkunci di vendor SaaS
- **Offline resilient** — print agent LAN, ga bergantung 100% internet (worst case, kasir tetap bisa input & transaksi tetap tersimpan)
- **Extensible** — kalau owner mau tambah fitur (stok management, WA daily digest, expense tracking), tinggal build di atas fondasi yang ada
- **Zero vendor lock-in** — kalau owner mau pindah host suatu saat, semua open source (Next.js, Supabase, Postgres), tidak terkunci

---

## 6. Roadmap (yang belum shipped, dalam backlog)

Yang **sudah dijalankan** hari ini (tinggal pakai):
- ✅ Foto nota OCR + review + simpan
- ✅ POS input langsung + chip variasi
- ✅ Print dapur + minuman + customer
- ✅ Print bypass OS freeze
- ✅ Laporan harian + bulanan + top menu
- ✅ Menu master + chip editor
- ✅ Soft delete + restore
- ✅ Multi-device responsif
- ✅ Backup otomatis (Supabase managed)

Yang **belum shipped** (opsi untuk pengembangan lanjut kalau owner tertarik):
- 🔜 **Mark menu "habis hari ini"** — kasir tau lele/ayam abis tanpa nelpon dapur, reset jam 12 siang
- 🔜 **Export CSV closingan** — untuk audit ke Excel
- 🔜 **Chip terlaris report** — chip mana yang paling sering dipesan (data sudah tersimpan, tinggal dashboard)
- 🔜 **Kas drawer reconciliation** — input kas awal + kas keluar, reconcile dengan sistem
- 🔜 **Stok harian** — tracking sederhana "lele sisa berapa"
- 🔜 **WhatsApp daily digest** — auto kirim laporan hari ini ke owner via WA jam 22:00
- 🔜 **Foto nota belanja → auto-categorize expense** — kebalikan OCR (untuk kas keluar)

Item ini kalau dikerjakan bisa ditambahkan bertahap, budget per fitur tergantung kompleksitas (perkiraan Rp 500rb – Rp 2 jt per fitur).

---

## 7. Statistik teknis (untuk gambaran ke owner)

- **Total baris kode:** ~15.000 baris (TypeScript + Kotlin agent app)
- **Test coverage:** 205 test otomatis, semua passing
- **Database:** 32 migrasi (evolusi skema selama ~3 minggu development)
- **Halaman aplikasi:** 20 route (Home, POS, Scan, Transaksi, Detail, Review, Reports harian, Reports bulanan, Menu master, Setup printer, dll)
- **Endpoint API:** 25+ endpoint
- **Waktu OCR foto nota:** ~2.5 detik/foto (setelah optimasi Gemini thinking level)
- **Latency print job:** <2 detik dari kasir tap Simpan ke printer keluar kertas (jika agent online)

---

## 8. Kontak & Dukungan

Untuk pertanyaan, bug report, atau request fitur baru, silakan hubungi developer.

Dokumentasi teknis lengkap tersimpan di source code repository — bisa diakses developer kapan saja untuk maintenance jangka panjang.

---

*Laporan ini dibuat 8 Juli 2026, mencerminkan status aplikasi setelah shipment fitur POS direct order + per-menu chip system.*
