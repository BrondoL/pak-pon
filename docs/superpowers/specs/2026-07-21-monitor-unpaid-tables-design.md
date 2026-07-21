# Monitor Meja Belum Bayar — Design Spec

**Tanggal:** 2026-07-21
**Status:** Approved (brainstorm), pending implementation plan

## Tujuan

Layar operasional buat kasir memantau meja mana yang **belum bayar** hari ini. Kasir menandai lunas secara manual (transaksi hilang dari monitor). Undo dilakukan lewat detail transaksi. Near-real-time via polling.

Bukan fitur akuntansi — status bayar **tidak** mempengaruhi laporan/omzet.

## Keputusan kunci (hasil brainstorm)

- **Tanpa entitas meja terpisah.** Status bayar nempel **per-transaksi**, pakai `customer_name` + `table_no` yang sudah ada di `transactions`.
- **Yang masuk monitor:** transaksi `confirmed`, dine-in (`is_takeaway = false`), belum bayar, belum dihapus, dalam hari bisnis ini. Takeaway/bungkus di-skip (dianggap bayar langsung). `pending_review` (draft) tidak masuk.
- **Transport: polling** (~15 detik) + tombol Refresh manual. SSE/Supabase Realtime ditolak — overkill untuk layar kasir low-traffic; near-real-time cukup.
- **Tandai lunas:** tombol "Lunas" per kartu → dialog konfirmasi → kartu hilang (monitor hanya menampilkan yang belum bayar).
- **Undo:** di halaman detail transaksi (kasir cek dari history), bukan di monitor.
- **Laporan tidak disentuh.** `report_*` tetap agregasi `confirmed` seperti sekarang, mengabaikan `paid_at`. Data historis (`paid_at = NULL`) tidak jadi masalah, tidak perlu backfill.

## Data model

Migrasi baru `supabase/migrations/0036_transactions_paid_at.sql`:

```sql
ALTER TABLE transactions ADD COLUMN paid_at timestamptz;  -- NULL = belum bayar
```

- `NULL` = belum bayar; terisi timestamp = sudah bayar. Konsisten dengan pola `confirmed_at` / `deleted_at`.
- Partial index untuk query monitor (opsional, himpunan kecil — dievaluasi saat implementasi):
  `CREATE INDEX ... ON transactions (created_at) WHERE status='confirmed' AND is_takeaway=false AND paid_at IS NULL AND deleted_at IS NULL;`
- Tidak ada backfill. Transaksi lama `paid_at = NULL`, tapi tersaring keluar monitor oleh filter hari-bisnis-ini.

## Filter monitor

```
status = 'confirmed'
AND is_takeaway = false
AND paid_at IS NULL
AND deleted_at IS NULL
AND created_at ∈ businessDayRange(currentBusinessDate())
```

Urutan: `created_at` **ascending** (paling lama belum bayar di atas).

Total per transaksi = `Σ(qty × unit_price_snapshot)` dari `transaction_items` — pola sama dengan `app/(app)/transactions/page.tsx`. Himpunan dijamin kecil (belum-bayar dine-in hari ini) sehingga aman hitung count/sum di sisi fetched rows, bukan agregasi berisiko truncation 1000-row.

## Route & UI

### Home tile + navbar
- Tile baru di `components/home-tiles.tsx`: label **"Monitor"** → `/monitor`.
- Link di navbar (mengikuti pola link `/pos` yang sudah ada).
- Route `app/(app)/monitor/` (auth, sesuai konvensi `app/(app)/`).

### Layar monitor (`/monitor`)
- Server component fetch awal → client component untuk polling.
- Header ringkas: "N meja belum bayar · total Rp X" (dari fetched rows).
- Daftar kartu, tiap kartu menampilkan:
  - **No. meja** (menonjol) + nama customer
  - Jam masuk (WIB)
  - Total (`formatRp`)
  - Jumlah item
  - Tombol **"Lunas"**
  - **Tanpa** badge sumber (POS/OCR).
- Tombol **Refresh** manual + polling tiap 15 detik (interval via const, pola `printer-status-banner.tsx`; berhenti saat unmount).
- **Empty state:** "Semua meja sudah bayar 🎉".

### Interaksi
- Klik **"Lunas"** → **AlertDialog** konfirmasi ("Tandai meja X lunas?") → confirm → `PATCH { paid: true }` → kartu hilang (refetch/optimistic).
- **Tap kartu** (area selain tombol Lunas) → **Dialog modal detail** transaksi (bukan redirect — lebih cepat). Modal menampilkan: customer, meja, jam, daftar item (qty × harga, chips, catatan), total, status bayar. Reuse rendering detail sebisa mungkin dari komponen detail yang ada.

### Halaman detail transaksi (`app/(app)/transactions/[id]/page.tsx`)
- Tampilkan status bayar: **"Sudah bayar" / "Belum bayar"**.
- Tombol toggle undo/lunas: **"Batalkan lunas (undo)"** / **"Tandai lunas"** → `PATCH { paid: false | true }` dengan dialog konfirmasi.

## API

### `GET /api/monitor`
- Return daftar transaksi belum-bayar sesuai filter di atas + total per tx.
- Dipakai oleh polling client.
- Zod di boundary (tidak ada input selain implisit "hari ini"), wide-event logging (`newEvent`/`evt.emit`).

### `PATCH /api/transactions/[id]` (extend handler yang sudah ada)
- Terima field baru `{ paid: boolean }` (opsional, Zod).
- `paid: true` → set `paid_at = now()`.
- `paid: false` → set `paid_at = NULL`.
- Idempotent: set ulang nilai yang sama = no-op, tidak error. Dua device klik "Lunas" bareng aman.
- Wide-event logging include perubahan paid state.

## Edge cases

- Transaksi jadi paid lalu di-soft-delete → hilang otomatis (filter `deleted_at`).
- Toggle `is_takeaway=true` saat edit → hilang dari monitor otomatis.
- Dua device klik "Lunas" bersamaan → idempotent, no-op.
- `pending_review` → tidak muncul (belum confirmed).
- Ganti hari bisnis (lewat cut-off jam 12 siang WIB) → transaksi kemarin yang belum sempat ditandai lunas otomatis hilang dari monitor. **Diterima**: monitor adalah alat harian; residu kemarin bukan tanggung jawab layar ini.

## Logging (wide-event)

- `GET /api/monitor`: emit event dengan count baris, elapsed_ms.
- `PATCH /api/transactions/[id]` dengan `paid`: sertakan `paid_before`/`paid_after` di event.

## Testing (Vitest)

- Filter monitor: takeaway di-skip, `pending_review` di-skip, hari lain di-skip, sudah-bayar di-skip, soft-deleted di-skip.
- PATCH `paid`: set true → `paid_at` terisi; set false → `paid_at` NULL; idempotency (set sama = no-op).
- Perhitungan total per tx = `Σ(qty × unit_price_snapshot)`.

## Non-goals (YAGNI)

- Entitas/master meja.
- Laporan membedakan omzet vs kas diterima (butuh backfill; ditunda sampai benar-benar dibutuhkan).
- Supabase Realtime / SSE.
- Notifikasi/alarm meja lama belum bayar.
- Multi-hari / monitor lintas hari.
