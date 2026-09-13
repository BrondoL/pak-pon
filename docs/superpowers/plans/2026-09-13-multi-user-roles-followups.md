# Multi-Akun & Role — Sisa Pekerjaan Setelah Implementasi

**Tanggal:** 2026-09-13
**Branch:** `feat/multi-user-roles` (28 commit, 369 test lulus, belum di-merge)
**Spec:** `2026-09-13-multi-user-roles-design.md` · **Plan:** `2026-09-13-multi-user-roles.md`

Migrasi 0042–0048 **sudah diterapkan ke DB produksi**. Kodenya belum di-merge ke `master`.

## ⚠️ Gerbang sebelum merge: uji klik 8 langkah

Belum pernah dijalankan siapa pun — butuh sesi Supabase Auth sungguhan, tidak bisa headless.
Jalankan dengan **build produksi** (`npm run build && npm run start`), bukan dev server:
perilaku `redirect()` di server component berbeda antara keduanya.

1. Sebagai owner, buka `/setup/users`, buat akun `kasir1@pakpon.local` dengan role **Kasir**.
2. Jendela penyamaran, login sebagai kasir itu.
3. Navbar **tidak** memuat "Menu"; ikon gerigi setup **tidak** muncul; beranda tanpa ubin Menu Master.
4. Ketik `/reports/monthly` langsung → halaman 403 yang menyebut izin yang kurang.
5. Ketik `/setup/users` → 403.
6. `/pos` dan `/monitor` bisa dibuka, pesanan tersimpan seperti biasa.
7. **Paling penting:** dari jendela owner, nonaktifkan akun kasir. Muat ulang jendela kasir →
   harus mendarat di `/no-access` dengan tombol keluar. **Bukan** `ERR_TOO_MANY_REDIRECTS`.
   Inilah bug yang ditemukan review akhir (loop `/` ↔ `/login` karena `proxy.ts` memantulkan
   sesi yang masih hidup); langkah ini yang membuktikan perbaikannya jalan.
8. Coba turunkan diri sendiri dari superadmin → ditolak "Ini superadmin terakhir."

Tambahan untuk `/setup/roles`: buat role, ubah izinnya, hapus role yang belum dipakai,
lalu coba hapus role yang masih dipakai (harus muncul toast 409 berbahasa Indonesia),
dan tab keyboard menyusuri matriks izin.

## Temuan minor yang sengaja ditunda (tidak menghalangi merge)

| # | Temuan | Putusan |
|---|---|---|
| 1 | `assert_superadmin_remains()` (migrasi 0048) dibuat dengan grant `anon` | Tidak bisa dipanggil (fungsi `RETURNS trigger`, PostgREST tak mengekspos), tapi melanggar aturan yang ditulis branch ini sendiri. Satu baris `REVOKE` — kerjakan saat menyentuh 0048 lagi. |
| 2 | Dokumen menyebut `report_daily`/`report_home_today`/`report_transactions_summary` "granted ke authenticated"; nyatanya juga punya `anon` | Paparan nol (`SECURITY INVOKER` + RLS `transactions` hanya `TO authenticated` → nol baris). Perbaiki kalimatnya. |
| 3 | `requirePermission`/`requireAnyPermission`/`requireSuperadmin` masih `redirect('/login')` saat actor null → `/scan` jadi 3 lompatan sebelum mendarat di `/no-access` | Berhenti, tidak loop. Kosmetik. |
| 4 | Trigger 0048 menuntut superadmin aktif **ada**, bukan **tersisa** → DB dengan nol superadmin aktif tidak bisa update/delete baris `profiles` sama sekali | Produksi tak terjangkau (1/1). Catat di komentar migrasi. |
| 5 | Argumen penutupan balapan di 0048 bergantung pada isolasi `READ COMMITTED` | Terverifikasi berlaku di cluster ini, tanpa override. Catat sebagai prasyarat. |
| 6 | `listUsers({ perPage: 200 })` plafon senyap; `PATCH` user tak ada → 200; UUID rusak → 500 mentah | Semua superadmin-only, gagal ke arah aman. |
| 7 | `app/(app)/setup/users/page.tsx` menduplikasi logika query `GET /api/users` (begitu juga roles) | Dua salinan deteksi akun yatim harus berubah bersamaan. Ekstrak saat salah satunya disentuh. |

## Risiko yang memang diterima (bukan bug)

RLS `transactions`/`menus`/`print_history` sengaja tetap permisif — lihat bagian
"Risiko yang diterima" di spec. Kasir yang paham devtools masih bisa membaca tabel
transaksi lewat PostgREST, termasuk mengagregasi omzet sebulan lewat `report_daily`
dengan rentang tanggal bebas. Yang ditutup rapat hanya tabel role (mustahil mengangkat
diri sendiri) dan RPC `report_monthly`.
