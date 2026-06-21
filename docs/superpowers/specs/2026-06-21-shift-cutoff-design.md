# Shift-Aware Cut-off (Business Day) — Design Spec

**Date:** 2026-06-21
**Status:** Approved (brainstorming phase complete, pending implementation plan)
**Supersedes:** Decision Q5 di `2026-06-20-pak-pon-design.md` (midnight-to-midnight cut-off)

## 1. Latar belakang

Warung Pecel Lele Pak Pon buka jam 17:00 dan tutup variabel (paling sering antara 23:00–02:00 dini hari, kadang bisa lebih malam). Cut-off midnight-to-midnight membuat satu shift kerja terbelah jadi dua "hari" di reporting: closingan tanggal 21 Juni hanya berisi transaksi sampai jam 23:59, sedangkan transaksi setelah jam 00:00 — yang secara fisik masih shift yang sama — masuk ke closingan tanggal 22 Juni.

Spec ini mengganti cut-off harian dengan konsep **business day** yang diatur via env var, agar satu shift kerja = satu business date di reporting tanpa kasir perlu klik tombol apa pun.

## 2. Tujuan

- Satu sesi buka–tutup warung selalu masuk ke **satu** business date di laporan harian.
- Kasir tidak perlu menekan tombol "Buka Shift" atau "Tutup Shift". Zero manual input.
- Jam cut-off bisa diubah lewat env tanpa migration DB.
- Tidak menambah kolom DB atau memerlukan backfill data.

## 3. Non-goals

- Tracking shift sebagai entitas (siapa yang buka, siapa yang tutup, durasi shift).
- Lebih dari satu shift per business day (misal shift sore + shift malam beda kasir).
- Cut-off berbeda per hari (misal weekend tutup lebih malam).
- Audit trail per shift.
- UI tombol "Tutup Shift Sekarang" untuk force snapshot.

Kalau salah satu jadi kebutuhan, di-desain ulang sebagai entity terpisah (`shifts` table) di fase selanjutnya.

## 4. Konsep

Definisi formal:

```
business_date(created_at) = ((created_at AT TIME ZONE 'Asia/Jakarta') - interval 'N hours')::date
```

Di mana **N** = `BUSINESS_DAY_CUTOFF_HOURS` (default 12).

Konsekuensinya: business date X mencakup periode `[X 12:00 WIB, (X+1) 12:00 WIB)`.

### Kenapa cut-off jam 12 siang aman

Warung pasti tutup di rentang jam 05:00–17:00. Cut-off di tengah window itu (jam 12:00 siang) menjamin tidak ada transaksi yang salah-klasifikasi:

| Skenario tutup | Last transaksi | Hasil business_date |
|---|---|---|
| Tutup 22:00 | 21 Jun 21:50 | 21 Jun ✓ |
| Tutup 01:00 dini hari | 22 Jun 00:55 | 21 Jun ✓ |
| Tutup 04:00 subuh | 22 Jun 03:50 | 21 Jun ✓ |
| Buka kembali 21 Jun 17:00 | 21 Jun 17:30 | 21 Jun ✓ |

Asumsi yang membuat aturan ini bekerja: **tidak ada transaksi antara jam 05:00 dan 17:00 WIB** (warung benar-benar tutup di rentang itu). Kalau suatu hari warung buka siang, aturan ini bisa salah-klasifikasi sampai cut-off direvisi via env.

## 5. Konfigurasi

Env var baru:

```
NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS=12
```

- Prefix `NEXT_PUBLIC_` karena dipakai juga di client (Home footer, default date picker).
- Validasi: integer 0–23. Throw error saat helper module load kalau di luar range atau bukan integer.
- Default kalau env tidak diset: `12`.
- Tambah ke `.env.local`, Vercel env (Production + Preview), dan dokumentasi `docs/spec.md` / `README` kalau ada section env.

Ganti nilai = ganti env + redeploy. Tidak ada migration DB.

## 6. Helper module (`lib/date.ts`)

Sumber kebenaran tunggal. Semua kode app (server route handlers, client components) baca dari sini.

```ts
const CUTOFF_HOURS = Number(
  process.env.NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS ?? '12'
);

if (!Number.isInteger(CUTOFF_HOURS) || CUTOFF_HOURS < 0 || CUTOFF_HOURS > 23) {
  throw new Error('NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS must be integer 0-23');
}

export const BUSINESS_DAY_CUTOFF_HOURS = CUTOFF_HOURS;

// Convert wall-clock timestamp → business date string "YYYY-MM-DD" (WIB).
export function businessDate(ts: Date): string;

// Today's business date in WIB. Equivalent to businessDate(new Date()).
export function currentBusinessDate(): string;

// Inverse: business date "YYYY-MM-DD" → [start, end) UTC range of created_at
// that belongs to that business day.
// e.g. businessDayRange("2026-06-21") with cutoff=12 returns:
//   start = 2026-06-21T05:00:00.000Z  (21 Jun 12:00 WIB)
//   end   = 2026-06-22T05:00:00.000Z  (22 Jun 12:00 WIB)
export function businessDayRange(businessDate: string): { start: Date; end: Date };

// Generate inclusive list of business dates dalam bulan target "YYYY-MM".
// Berguna untuk monthly report bucket presetting (fill gap hari kosong dengan 0).
export function businessDatesInMonth(ym: string): string[];
```

Catatan implementasi:
- Implementasi bisa pakai `Intl.DateTimeFormat` dengan timezone `'Asia/Jakarta'`, atau library tipis seperti `date-fns-tz`. Library pilihan difinalkan saat implement; spec ini tidak mengikat.
- Helper bersifat pure (tidak baca `new Date()` kecuali di `currentBusinessDate`) supaya gampang di-unit-test dengan input deterministik.

## 7. Query strategy

Tidak menambah kolom DB, tidak ada SQL function helper, tidak ada generated column atau expression index. Semua filter dilakukan dengan **range `created_at`** yang di-precompute di app, sehingga index `transactions(created_at DESC)` yang sudah ada tetap optimal.

### Daily report

```sql
SELECT
  COALESCE(SUM(ti.qty * ti.unit_price_snapshot), 0)::bigint AS total,
  COUNT(DISTINCT t.id)::int AS count
FROM transactions t
JOIN transaction_items ti ON ti.transaction_id = t.id
WHERE t.created_at >= $1
  AND t.created_at <  $2
  AND t.deleted_at IS NULL
  AND t.status = 'confirmed';
```

App pass `$1 = start`, `$2 = end` dari `businessDayRange(date)`.

### Monthly report (bucket per business date)

Bisa ditulis dengan 2 cara — pilih saat implement:

**Opsi A — group di SQL pakai expression** (1 query, paling efisien):

```sql
SELECT
  ((t.created_at AT TIME ZONE 'Asia/Jakarta' - make_interval(hours => $3))::date) AS business_date,
  COALESCE(SUM(ti.qty * ti.unit_price_snapshot), 0)::bigint AS total,
  COUNT(DISTINCT t.id)::int AS count
FROM transactions t
JOIN transaction_items ti ON ti.transaction_id = t.id
WHERE t.created_at >= $1
  AND t.created_at <  $2
  AND t.deleted_at IS NULL
  AND t.status = 'confirmed'
GROUP BY business_date
ORDER BY business_date;
```

`$1` = `businessDayRange(<first business date of month>).start`
`$2` = `businessDayRange(<last business date of month>).end`
`$3` = `BUSINESS_DAY_CUTOFF_HOURS`

**Opsi B — fetch range whole month, group di app code**. Lebih portable kalau nanti pindah backend, tapi over-fetch ke memory.

Default: **Opsi A** karena bench-able dan tetap pakai index `created_at`.

Setelah grouping, app fill business_dates yang kosong dengan `{ total: 0, count: 0 }` pakai `businessDatesInMonth(ym)`.

### Top items (di daily & monthly endpoint)

Filter range pakai pola yang sama (`created_at >= start AND < end`). Aggregation `GROUP BY menu_name_snapshot` tidak terkait business_date.

## 8. API contract

**Endpoint URL & response shape tidak berubah.** Hanya semantik parameter `date` dan `date_from`/`date_to` yang berubah.

| Route | Parameter | Sebelum | Sesudah |
|---|---|---|---|
| `GET /api/reports/daily` | `?date=YYYY-MM-DD` | calendar date, filter `created_at::date = date` | **business_date**, filter `businessDayRange(date)` |
| `GET /api/reports/monthly` | `?ym=YYYY-MM` | bucket per calendar date | bucket per business_date; bulan = bulan dari business_date pertama |
| `GET /api/transactions` | `?date_from=&date_to=` | calendar dates | **business dates** |

Response field `daily[].date` di monthly endpoint sekarang berisi business_date string. Default value param di backend (kalau `date` tidak dikirim) = `currentBusinessDate()`.

Tidak ada perubahan validasi Zod (tetap string `YYYY-MM-DD`).

## 9. UI changes

### Home (`/`)

Footer "Hari ini" → ganti jadi label business date eksplisit, baca dari `currentBusinessDate()`:

```
📅 Shift 21 Jun 2026
Rp 1.245.000 • 24 nota
```

Wording "Shift" dipakai supaya jelas saat lewat tengah malam (jam 00:30 22 Jun, label tetap "Shift 21 Jun 2026" bukan "Hari ini Rp …" yang ambigu).

### `/reports/daily`

- Date picker default = `currentBusinessDate()`.
- Label kolom tetap "Tanggal" (jangan pakai jargon "business date" di UI).
- Tambahkan **info hint sekali**, contoh sub-text kecil di bawah angka total atau tooltip dari icon ⓘ:
  > "Closingan satu hari = transaksi sejak jam **12:00 siang** tanggal pilihan sampai 11:59 siang besoknya."
  
  Angka jam (`12:00 siang`) dihitung dari `BUSINESS_DAY_CUTOFF_HOURS` — jangan hardcode supaya konsisten kalau cut-off diubah.

### `/reports/monthly`

- Bar chart per business_date. X-axis label tetap angka tanggal (1–31).
- Total bulanan = SUM semua business_date di bulan target.
- "Bulan ini" / default `ym` = bulan dari `currentBusinessDate()` (bukan `new Date().getMonth()`).
- Date stepper bulan (← →) tidak berubah.

### `/transactions` (history list)

- Filter date range → **business dates** (semantik baru). Default range tetap.
- Display kartu/baris transaksi tetap tampilkan `created_at` apa adanya (jam + tanggal sebenarnya). User melihat waktu fisik transaksi terjadi, sementara filter beroperasi di business date — dua hal berbeda di tempat berbeda, tidak membingungkan.

### `/transactions/[id]` (detail)

Tidak berubah.

### `/scan`, `/transactions/[id]/review`, `/menu`, `/login`

Tidak berubah.

## 10. Backfill / data migration

**Tidak ada.** Data historis tetap; hanya semantik query yang berubah. Akibatnya:

- Closingan historis akan **berubah** untuk transaksi yang terjadi antara `00:00` dan `<cutoff>:00` WIB. Contoh: transaksi 22 Jun 01:30 yang dulu dihitung di closingan 22 Jun, sekarang muncul di closingan 21 Jun.
- Total seluruh bulan tidak berubah; hanya distribusi per hari yang shift.
- Tidak ada data hilang.

Implikasinya: setelah rollout, owner mungkin lihat angka harian historis berbeda dari catatan manual. Wajar dan bisa dijelaskan oleh new cut-off rule. Tidak perlu announce/onboarding khusus untuk MVP — hanya 1 user.

## 11. Testing

Unit test `lib/date.ts`:
- `businessDate(ts)` dengan beberapa input deterministik (jam 11:00 WIB → hari kemarin, jam 12:00 WIB → hari ini, jam 23:59 WIB → hari ini, jam 00:30 WIB next day → hari kemarin).
- `businessDayRange(date)` return `start`/`end` yang ekivalen UTC.
- `currentBusinessDate()` di-mock pakai inject `Date` source supaya deterministik.
- Validasi env var (out-of-range / non-integer throw).
- DST/edge: Asia/Jakarta tidak DST, jadi tidak perlu test DST transition. Pastikan helper tidak pakai `getTime()` lokal yang bisa salah di developer machine non-WIB.

Integration test `/api/reports/daily`:
- Seed transaksi pada beberapa jam (17:00, 23:50, 00:30 next day, 11:00 next day, 13:00 next day).
- Query daily dengan business_date target, verify hanya transaksi 17:00, 23:50, 00:30, 11:00 ter-include (13:00 next day masuk business_date berikutnya).

## 12. Out of scope (defer kalau muncul kebutuhan)

- Tabel `shifts` dengan `opened_at`/`closed_at`/`opener_name`.
- Tombol manual "Buka Shift" / "Tutup Shift".
- Multiple shifts per business day.
- Cut-off berbeda per hari (weekend dll).
- Shift snapshot permanen (closingan beku saat tombol ditekan, tidak berubah meski transaksi di-edit setelahnya).
- Tooltip / onboarding khusus menjelaskan migrasi cut-off.

## 13. Update spec utama

Setelah merge, edit `docs/superpowers/specs/2026-06-20-pak-pon-design.md`:

- Decision Q5 (Cut-off harian): catat superseded oleh spec ini, link.
- Section "Out of scope (MVP)" → hapus bullet "Buka warung lewat tengah malam".
- Section 14 "Conventions" → tambah baris business_date.
- Section 11 "Deployment / Env vars" → tambah `NEXT_PUBLIC_BUSINESS_DAY_CUTOFF_HOURS`.
