# Retensi Foto Nota 7 Hari (tanpa hapus transaksi)

**Tanggal:** 2026-07-23
**Status:** Design — disetujui, siap plan

## Masalah

Supabase free tier punya kuota Storage terbatas. Foto nota hasil scan OCR (`transactions.scan_image_path` → bucket `notas`) numpuk terus dan cuma dibuang lewat cron `cleanup` **kalau transaksinya di-soft-delete dulu** (hard-delete >7 hari sekalian hapus fotonya). Transaksi yang tidak pernah dihapus → fotonya tersimpan selamanya → Storage cepat penuh.

## Tujuan

Hapus **foto nota** dari Storage untuk transaksi yang usianya sudah lewat 7 hari (`created_at`), **tanpa menghapus transaksinya**. Data transaksi (item, total, customer, dll) tetap utuh — cuma foto + path-nya yang dibuang.

## Non-Goals

- Tidak menyentuh laporan (`report_*` tetap agregasi seperti biasa).
- Tidak mengubah alur soft-delete / hard-delete transaksi yang sudah ada.
- Tidak mengubah insert di `/api/pos` & `/api/scan`.
- Bukan fitur re-upload / restore foto. Foto yang sudah dibuang hilang permanen.

## Prinsip

Perluas cron `cleanup` yang **sudah jalan harian 02:00 WIB** (Vercel, `/api/cron/cleanup`, `0 19 * * *`). Pakai **jendela 7 hari yang sama** (variabel `cutoff` yang sudah ada = `now − RETENTION_DAYS hari`). Tidak ada cron/jadwal baru.

## Jebakan yang ditangani: badge "POS" di riwayat

`app/(app)/transactions/page.tsx:110-113` saat ini menentukan sumber transaksi dengan proxy:

```ts
// scan_image_path === null reliably means POS (created via POST /api/pos).
source: tx.scan_image_path === null ? 'pos' : 'ocr',
```

Kalau foto OCR lama dihapus lalu `scan_image_path` dikosongkan, transaksi OCR lama akan **salah tampil jadi "POS"** (jadi sama-sama null). CLAUDE.md sudah menandai ini: *"proxy: reliable sampai cron retention foto shipped"*. Spec ini men-ship itu, jadi proxy harus diganti jadi eksplisit via kolom penanda baru.

## Desain

### 1. Migrasi DB — `supabase/migrations/0037_scan_image_retention.sql`

- Tambah kolom penanda:
  ```sql
  ALTER TABLE transactions ADD COLUMN scan_image_purged_at timestamptz;
  ```
  Nullable, default null. Terisi saat foto dibuang cron.
- Index parsial untuk mempercepat query purge walau riwayat besar:
  ```sql
  CREATE INDEX idx_transactions_photo_purgeable
    ON transactions (created_at)
    WHERE scan_image_path IS NOT NULL;
  ```
- Idempotent guard (cek kolom belum ada) sesuai pola migrasi lain di repo.

### 2. Cron `cleanup` — pass ke-3 (purge foto)

Di `app/api/cron/cleanup/route.ts`, setelah pass-1 (hard-delete soft-deleted tx) dan pass-2 (print_history), tambah pass batch (CHUNK 500, pola sama seperti pass-1):

```
loop:
  batch = select id, scan_image_path
          from transactions
          where scan_image_path is not null and created_at < cutoff
          order by created_at asc
          limit 500
  if batch empty: break
  storage.remove(batch.scan_image_path[])           // bucket 'notas'
  update transactions
    set scan_image_path = null, scan_image_purged_at = now()
    where id in batch.ids
  if batch.length < 500: break
```

- `cutoff` = variabel yang sudah ada (`now − 7 hari`). Satu jendela untuk semua pass.
- **Idempoten otomatis:** begitu `scan_image_path` jadi null, row tidak match lagi di run berikutnya. Tidak perlu filter `deleted_at`.
- Error storage → `evt.warn` (partial), lanjut (pola sama dengan pass-1). DB update tetap jalan supaya tidak retry foto yang sama terus.
- Catat `photos_purged_count` (+ opsional `photo_storage_paths_count`) di wide-event via `evt.merge`.
- Return JSON boleh ditambah field `photos_purged`, tapi backward-compat: `deleted_count` tetap ada.

### 3. Badge riwayat — `app/(app)/transactions/page.tsx`

- Tambah `scan_image_purged_at` ke `.select(...)`.
- Tambah helper murni ke `lib/transactions.ts` (modul + testnya sudah ada — `buildItemInsertRows`, `computeReplaceItems`):
  ```ts
  export function mapTransactionSource(
    scanImagePath: string | null,
    scanImagePurgedAt: string | null,
  ): 'pos' | 'ocr' {
    return scanImagePath === null && scanImagePurgedAt === null ? 'pos' : 'ocr';
  }
  ```
- Ganti proxy inline dengan pemanggilan helper. Transaksi OCR yang fotonya sudah dibuang → tetap `'ocr'`.

### 4. Halaman detail + review

`app/(app)/transactions/[id]/page.tsx` dan `app/(app)/transactions/[id]/review/page.tsx`:

- Tambah `scan_image_purged_at` ke `.select(...)`.
- Logika area foto:
  - `scan_image_path` ada → tampilkan foto (signed URL, seperti sekarang).
  - `scan_image_path` null **dan** `scan_image_purged_at` terisi → teks kecil **"Foto nota sudah dihapus (retensi 7 hari)"**.
  - dua-duanya null (POS) → tidak ada area foto (perilaku sekarang).

### 5. Test

- `app/api/cron/cleanup/route.test.ts` (**baru** — cron cleanup belum punya test): assert pass-3 memanggil select `scan_image_path is not null` + `storage.remove` + update `scan_image_path=null, scan_image_purged_at`. Assert idempotensi: batch kosong → tidak ada storage.remove.
- `lib/transactions.test.ts` (**sudah ada** — tambah case): unit test `mapTransactionSource` untuk 3 kasus (POS, OCR aktif, OCR purged).

### 6. Dokumentasi

- `CLAUDE.md` bagian Print/cleanup + History indicator:
  - Tambah pass purge foto di deskripsi cron `cleanup`.
  - Ganti caveat *"proxy: reliable sampai cron retention foto shipped"* → jelaskan badge POS sekarang pakai `scan_image_purged_at` (POS = `scan_image_path` null **dan** `purged_at` null).

## Konsekuensi yang disadari

- **Run pertama menghapus foto SEMUA transaksi >7 hari sekaligus** (bisa ribuan). Itu tujuannya, tapi permanen — tidak bisa dibatalkan.
- Transaksi soft-deleted <7 hari yang usianya sudah >7 hari (`created_at`) akan kehilangan fotonya lebih dulu lewat pass-3; saat window 7 hari sejak delete tercapai, pass-1 tinggal hapus row (path sudah null). Aman.
- Signed URL tidak pernah dibuat untuk path null → tidak ada broken image.

## File yang disentuh

| File | Aksi |
|------|------|
| `supabase/migrations/0037_scan_image_retention.sql` | Baru — kolom + index |
| `app/api/cron/cleanup/route.ts` | Tambah pass-3 purge foto |
| `app/(app)/transactions/page.tsx` | Pakai `mapTransactionSource` + select kolom baru |
| `app/(app)/transactions/[id]/page.tsx` | Note "foto dihapus" + select kolom baru |
| `app/(app)/transactions/[id]/review/page.tsx` | Note "foto dihapus" + select kolom baru |
| `lib/transactions.ts` | Sudah ada — tambah helper `mapTransactionSource` |
| `lib/transactions.test.ts` | Sudah ada — tambah test helper |
| `app/api/cron/cleanup/route.test.ts` | Baru — test pass-3 (cleanup belum punya test) |
| `CLAUDE.md` | Update dok cleanup + badge |
