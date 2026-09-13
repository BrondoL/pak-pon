# Multi-Akun & Role dengan Permission Dinamis — Design Spec

**Tanggal:** 2026-09-13
**Status:** Design disetujui, belum diimplementasi

## Masalah

Pak Pon dipakai dengan **satu akun Supabase Auth bersama** yang bisa melakukan apa saja. RLS berbunyi "authenticated boleh ALL" (migrasi 0001), dan satu-satunya penjagaan adalah "sudah login atau belum" di `proxy.ts` + `app/(app)/layout.tsx`.

Owner mau mempekerjakan kasir. Kasir perlu POS, monitor, dan laporan harian — tapi **tidak boleh melihat laporan bulanan**, tidak boleh menghapus transaksi, tidak boleh mengubah harga menu. Batasannya harus bisa diatur owner sendiri tanpa deploy, karena role masa depan ("kasir senior", "juru masak") belum diketahui bentuknya.

## Tujuan

1. Banyak akun, satu **superadmin** yang tidak bisa dibatasi dan tidak bisa mengunci dirinya sendiri di luar.
2. Role **dinamis**: owner membuat role sendiri dan mencentang izinnya lewat UI.
3. Penjagaan **di server**, bukan sekadar menyembunyikan tombol.
4. Jejak siapa yang menginput sebuah transaksi.

## Bukan tujuan (sengaja)

- Multi-role per orang — satu role per user sudah cukup, dan multi-role melipatgandakan pertanyaan "kenapa dia bisa X?".
- Izin per-cabang / multi-warung.
- Lupa password mandiri (reset dilakukan superadmin).
- Audit log perubahan role.
- RLS berbasis izin di `transactions` / `menus` / `print_history`. Lihat "Risiko yang diterima".

## Keputusan arsitektur

### Katalog izin hidup di kode, pemberiannya di DB

`lib/permissions.ts` memegang daftar kunci izin + label Indonesia + kelompok. DB (`roles`, `role_permissions`) cuma menyimpan role buatan owner dan izin mana yang dicentang.

Alasan: sebuah izin baru berarti **hanya kalau ada kode yang mengeceknya**. Katalog di kode membuat "tambah halaman = tambah satu baris di satu file", dan mustahil ada izin nyangkut di DB yang sebenarnya tidak menjaga apa-apa. Alternatif yang ditolak: tabel `permissions` di DB (janji "nambah izin tanpa deploy" itu semu — izin baru tetap butuh kode pengecek, hasilnya dua sumber kebenaran yang bisa lari sendiri-sendiri) dan kolom `jsonb` array di baris role (fungsi `has_permission()` di SQL jadi rewel, pertanyaan "role mana saja yang punya izin ini" jadi pemindaian).

### Manajemen user & role eksklusif superadmin — sengaja BUKAN izin

Tidak ada kunci `users.manage`. Kalau "kelola user" jadi izin biasa yang bisa dicentang, sebuah role bisa dipakai untuk mengangkat dirinya sendiri jadi superadmin. Menutup jalur eskalasi itu sepenuhnya lebih murah daripada menjaganya. Superadmin boleh lebih dari satu orang.

### Izin dihitung per-request dari DB, bukan ditanam di JWT

`getCurrentActor()` melakukan satu query gabungan dan dibungkus `cache()` React → **satu request = satu query**, walau dipanggil layout, page, dan komponen sekaligus. Alternatif yang ditolak: custom claims di JWT lewat Auth Hook — lebih cepat, tapi perubahan role baru berlaku setelah token refresh (~1 jam), dan owner yang mencabut izin mengharapkan itu berlaku sekarang.

### `proxy.ts` tidak disentuh

Dia jalan di Edge untuk **setiap** request; menambah query DB di sana membuat semua halaman bayar ongkos. Dia tetap mengurusi "sudah login atau belum". Izin dijaga di layout, server component, dan route handler.

## Model data

Migrasi `0042_roles_and_profiles.sql`:

| Tabel | Kolom |
|---|---|
| `roles` | `id uuid PK`, `name text UNIQUE NOT NULL`, `description text`, `created_at timestamptz` |
| `role_permissions` | `role_id uuid → roles ON DELETE CASCADE`, `permission_key text`, PK `(role_id, permission_key)` |
| `profiles` | `user_id uuid PK → auth.users ON DELETE CASCADE`, `display_name text NOT NULL`, `role_id uuid → roles ON DELETE RESTRICT NULL`, `is_superadmin boolean NOT NULL DEFAULT false`, `is_active boolean NOT NULL DEFAULT true`, `created_at timestamptz` |

Keputusan:

- **`role_id` pakai `ON DELETE RESTRICT`** — role yang masih dipakai orang tidak bisa dihapus; owner harus memindahkan orangnya dulu. Pola yang sama dengan DELETE primary agent yang diblok 409 di sistem print.
- **`role_id` nullable** — superadmin tidak butuh role.
- **Akun tanpa baris `profiles` = tanpa izin apa pun.** Gagal ke arah aman: kalau pembuatan akun putus setelah auth user dibuat tapi sebelum profil ditulis, orangnya bisa login tapi tidak bisa apa-apa. `/setup/users` menampilkan akun yatim ini supaya bisa dibereskan.
- **`is_active=false` ditolak di gerbang**, bukan dihapus — jejak `created_by` kasir yang berhenti kerja tetap terbaca.

**Backfill:** migrasi menyisipkan baris `profiles` untuk semua `auth.users` yang sudah ada dengan `is_superadmin=true`. Sekarang itu berarti akun bersama yang dipakai owner, jadi setelah deploy tidak ada yang terkunci di luar.

**Seed:** role `Kasir` beserta izinnya (lihat tabel katalog).

### RLS tabel baru

- `roles`, `role_permissions`: `SELECT` untuk `authenticated` (tidak sensitif, dan setiap user perlu membaca izinnya sendiri). `INSERT`/`UPDATE`/`DELETE` hanya superadmin.
- `profiles`: `SELECT` baris sendiri, atau semua baris kalau superadmin. Tulis hanya superadmin.

⚠️ **Jebakan rekursi:** policy di `profiles` yang mengecek "apakah saya superadmin" dengan membaca `profiles` menyebabkan **rekursi tak terhingga** — jebakan klasik Supabase. Pengecekannya lewat fungsi `SECURITY DEFINER` `public.is_superadmin(uuid)` dengan `search_path` dikunci, pola yang sama dengan RPC `report_*` di migrasi 0034.

`report_monthly` ditambahi penjagaan izin di dalam fungsinya sehingga menolak pemanggil yang tidak punya `reports.monthly.view` — angka omzet bulanan tidak bisa diambil lewat jalur PostgREST langsung.

## Katalog izin

| Kelompok | Kunci | Menjaga | Kasir |
|---|---|---|---|
| Operasional | `scan.use` | `/scan`, `POST /api/scan` | ✓ |
| | `pos.use` | `/pos`, `POST /api/pos` | ✓ |
| | `monitor.use` | `/monitor`, `GET /api/monitor`, tandai lunas, `POST /api/transactions/[id]/items` | ✓ |
| | `print.send` | `POST /api/print/send` | ✓ |
| Transaksi | `transactions.view` | `/transactions`, detail, ringkasan nominal di home, `GET /api/transactions` | ✓ |
| | `transactions.edit` | `/transactions/[id]/review`, `PATCH /api/transactions/[id]` | ✓ |
| | `transactions.delete` | hapus, `/transactions/trash`, restore | ✗ |
| Laporan | `reports.daily.view` | `/reports`, `/reports/daily`, `GET /api/reports/daily` | ✓ |
| | `reports.monthly.view` | `/reports/monthly`, `GET /api/reports/monthly`, RPC `report_monthly` | ✗ |
| Menu | `menu.view` | lihat menu master | ✓ |
| | `menu.manage` | tambah/ubah/hapus menu & chips, `POST/PATCH/DELETE /api/menus` | ✗ |
| Setup | `setup.printer` | `/setup/printer`, debug, settings, `PATCH /api/agent/[id]` | ✗ |
| | `setup.ai_usage` | `/setup/ai-usage` | ✗ |

`print.send` berdiri sendiri, bukan aturan "punya salah satu dari pos.use/monitor.use/transactions.edit", karena aturan majemuk begitu susah dibaca ulang setahun kemudian.

Ringkasan pemasukan di home dijaga `transactions.view`, bukan izin sendiri — angkanya sama dengan yang muncul di laporan harian, jadi izin terpisah cuma memberi rasa aman palsu.

## Gerbang izin

`lib/auth/session.ts`:

```
getCurrentActor() → { user, profile, isSuperadmin, permissions: Set<string> } | null
```

Satu query `profiles` → `roles` → `role_permissions`, dibungkus `cache()`. `null` kalau belum login, tidak punya profil, atau `is_active=false`. Superadmin melewati semua pengecekan tanpa melihat isi `permissions`.

Fungsi murni di `lib/permissions.ts` (bisa diuji tanpa DB):

- `PERMISSIONS` — katalog (kunci, label, kelompok)
- `resolvePermissions(profileRow)` → `Set<string>`
- `can(actor, key)` → boolean (superadmin selalu true)
- `filterNavLinks(links, actor)`

Dua pembungkus:

- **Server component**: `await requirePermission(key)` → kalau tidak punya, `redirect('/403')` — halaman yang menjelaskan "Halaman ini tidak tersedia untuk akun Anda", bukan error mentah.
- **Route handler**: `guard(evt, key)` mengembalikan `403 {error:'forbidden'}` dan menandai wide-event `permission_denied: '<key>'` + `actor_role`. Percobaan akses nyasar kelihatan di log, bukan hilang diam-diam. Dipasang setelah cek `user` yang sudah ada di tiap route, mengikuti pola `try/catch/finally` + `newEvent()`/`evt.emit()` yang berlaku.

## Layar baru

**`/setup/users`** (superadmin saja) — tabel akun: nama, email, role, status. Aksi: tambah akun (dialog nama/email/password/role), ubah role, aktif/nonaktifkan, reset password, hapus akun.

**`/setup/roles`** (superadmin saja) — daftar role + editor centang izin yang dikelompokkan seperti katalog. Hapus role yang masih dipakai ditolak dengan pesan "masih dipakai N akun, pindahkan dulu".

**`/403`** — halaman penjelasan.

Nav (`components/nav.tsx`, `mobile-nav.tsx`, `setup-menu.tsx`) dan ubin home disaring sesuai izin: kasir tidak melihat pintu yang tidak bisa dia buka.

Semua dialog memakai komponen di `components/ui/` (`Dialog`, `AlertDialog`, `Switch`) — bukan `window.confirm`. Warna lewat token di `app/globals.css`.

### Route `/api/users`

`POST` (buat akun), `PATCH` (role / status / password), `DELETE`. Superadmin-only, divalidasi Zod, dicatat wide-event.

⚠️ Membuat akun Supabase Auth menuntut **service-role key**, sementara `lib/supabase/admin.ts` bertuliskan *"NEVER import from user-facing API routes"*. Route ini adalah pengecualian pertama terhadap aturan itu. Komentar di `admin.ts` diperbarui jadi pengecualian yang eksplisit dan bersyarat (superadmin-only, tercatat di wide-event) — bukan diam-diam melanggar catatan yang sudah ada.

### Penjagaan superadmin terakhir

Ditolak: menurunkan superadmin terakhir, menonaktifkannya, atau menghapusnya. Dicek di server (bukan cuma tombol disable di UI) dan diuji sebagai fungsi murni `canDemoteSuperadmin(users, targetId)`.

## Jejak pembuat

Migrasi `0043_transactions_created_by.sql`: kolom `transactions.created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL` — hapus akun tidak menghapus transaksinya.

Diisi di `POST /api/pos` dan saat review scan dikonfirmasi (`PATCH /api/transactions/[id]` transisi ke `confirmed`). Tampil kecil di halaman detail: "Diinput oleh: Kasir 1". Transaksi lama `NULL`, tanpa backfill.

## Uji

Fungsi murni di `lib/permissions.test.ts` + `lib/auth/session.test.ts`:

- `resolvePermissions` — role normal, superadmin bypass, `is_active=false`, profil hilang
- `can()` untuk kunci yang tidak ada di katalog → false (bukan lempar)
- `filterNavLinks`
- `canDemoteSuperadmin` — superadmin terakhir ditolak, ada dua boleh
- **Uji katalog**: setiap kunci di `PERMISSIONS` benar-benar dipakai di suatu tempat di `app/` atau `lib/` — mencegah izin hantu yang dicentang owner tapi tidak menjaga apa-apa.

## Risiko yang diterima

**RLS di `transactions`/`menus`/`print_history` tetap "authenticated boleh ALL".** Kasir yang paham devtools masih bisa membaca data mentah lewat PostgREST memakai publishable key. Yang ditutup adalah jalur yang paling berbahaya: tabel role (tidak bisa mengangkat diri sendiri) dan omzet bulanan (penjagaan di dalam RPC). Menyentuh RLS tabel transaksi berisiko merusak jalur yang sudah stabil — RPC laporan, cron cleanup, agent print — dengan bug yang diam. Kalau kelak dianggap perlu, itu pekerjaan terpisah dengan pengujiannya sendiri.

**Ongkos satu query tambahan per request.** Terukur kecil (indexed, satu join, di-`cache()`), dan `auth.getUser()` sudah melakukan roundtrip di jalur yang sama.
