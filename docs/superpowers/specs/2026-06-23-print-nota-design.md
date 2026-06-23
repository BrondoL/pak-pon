# Print Nota Dapur & Minuman — Design Spec

**Date:** 2026-06-23
**Status:** Approved (brainstorming phase complete, ready for implementation plan)
**Depends on:** `0001_schema.sql` (kolom `customer_name`, `table_no`, `menus.category` sudah ada). Selaras dengan `2026-06-21-shift-cutoff-design.md` untuk logika business-day cutoff WIB.

## 1. Latar belakang

Owner punya 2 thermal printer iWare (LAN, port standar 9100 ESC/POS). Sebelumnya pakai Luna POS native Android — di Luna, print otomatis ke 2 printer (dapur + minuman) setelah order. Sekarang owner pindah ke web app Pak Pon, tapi belum ada fitur print → dapur masih harus baca nota tulisan tangan & minuman dibuat manual berdasarkan teriakan kasir. Pain: lambat saat ramai, salah baca tulisan, lupa item.

Goal: setelah kasir confirm scan nota, app otomatis cetak 2 struk paralel — satu ke printer dapur (item kategori `makanan` + `nasi`) dan satu ke printer minuman (item kategori `minuman`). Plus reprint manual di halaman detail transaksi.

## 2. Kendala fundamental (tech context)

Web app Pak Pon di-host di Vercel (cloud). Printer di LAN warung di belakang NAT — Vercel TIDAK BISA reach printer. Browser di tab Android TIDAK BISA open raw TCP socket ke port 9100 printer (web security restriction). Ini beda dengan Luna POS yang native Android — bisa langsung socket.

**Solusi: pakai bridge app di tab Android.** Web app generate ESC/POS bytes → trigger intent URL → bridge app (RawBT — gratis, populer di POS Indonesia) terima → forward via TCP ke printer LAN yang sudah dikonfig.

**Kendala kedua: dev tidak punya akses hardware.** Owner yang test. Owner tidak paham IT. Konsekuensi: app harus shipped dengan **logging extensive** + **diagnostic UI owner-friendly** supaya dev bisa diagnose remote dari Supabase logs + screenshot WhatsApp dari owner.

## 3. Decisions ringkas

| # | Decision | Reason |
|---|---|---|
| Q1 | Trigger: **auto-print saat confirm** + reprint manual di detail | Owner request; reprint untuk safety net |
| Q2 | Konten: header + tanggal/jam + nomor antrian + nama (opsional) + meja (opsional) + items (qty + nama + note) | Mirror nota fisik; field optional skip line kalau kosong |
| Q3 | Routing item: `category='minuman'` → printer minuman; `category in ('makanan','nasi')` → printer dapur | Field `menus.category` sudah ada |
| Q4 | Tech approach: **RawBT bridge app** (Plan A); fallback **IP-direct via settings** (Plan B) | Balance effort vs UX, didukung ekosistem |
| Q5 | Konfigurasi printer di RawBT (profile name), bukan di app — Plan A | Loose coupling; owner ganti printer tanpa redeploy |
| Q6 | Print logic 100% client-side (browser) | Server tidak bisa reach printer LAN |
| Q7 | Status printer per-device (localStorage), bukan shared di DB | Status sangat lokal (tergantung tab + WiFi) |
| Q8 | Nomor antrian: `transactions.daily_seq int`, reset harian basis WIB cutoff | Stable untuk reprint |
| Q9 | Notif status: banner home — merah (not_configured/failed), kuning (>24h stale), hidden (success ≤24h) | Visible tanpa noisy |
| Q10 | Tutorial setup: page `/setup/printer` dengan step + tombol test | Owner self-service |
| Q11 | Fire-and-forget intent — gak tunggu callback success/fail | URL scheme tidak punya callback; konfirmasi manual via modal |
| Q12 | Logging: extend wide-event pattern (`docs/logging.md`); semua print event ke server | Dev diagnose remote tanpa akses tab |

## 4. Architecture & data flow

```
┌──────────────────────────────────────────────────────────────┐
│  Tab Android Samsung (browser Chrome)                        │
│                                                              │
│  ┌────────────────────┐    ┌───────────────────────┐         │
│  │  Next.js web app   │    │  RawBT (Android app)  │         │
│  │  /scan, /transac…  │    │  - profile "Dapur"    │         │
│  │  /setup/printer    │    │  - profile "Minuman"  │         │
│  │                    │    │                       │         │
│  │  Generate ESC/POS  │───▶│  Forward via TCP:9100 │         │
│  │  Trigger intent    │    └───────┬──────────┬────┘         │
│  └─────────┬──────────┘            │          │              │
│            │                       ▼          ▼              │
└────────────┼─────────────┬─────────────┬──────────┬──────────┘
             │             │ LAN         │ LAN      │
             │ HTTPS       │             │          │
             ▼             ▼             ▼          ▼
   ┌───────────────┐ ┌──────────────┐ ┌─────────────────┐
   │  Vercel       │ │ Supabase     │ │ Printer iWare   │
   │  (data + log) │ │ (DB)         │ │ Dapur / Minuman │
   └───────────────┘ └──────────────┘ └─────────────────┘
```

- App TIDAK simpan IP printer (Plan A). App kirim parameter `profile=Dapur|Minuman` ke RawBT, RawBT lookup IP dari profile-nya.
- Plan B fallback: app simpan IP per target di tabel `settings`, pass IP via URL scheme ke RawBT.

## 5. Data model

### 5.1 Migration baru — `0004_print_nota.sql`

```sql
-- daily_seq: nomor antrian harian per transaksi, reset basis business-day WIB
ALTER TABLE transactions ADD COLUMN daily_seq int;

-- Lookup harian (untuk generate next seq dan reprint)
CREATE INDEX transactions_daily_seq_idx
  ON transactions (
    ((created_at AT TIME ZONE 'Asia/Jakarta')::date),
    daily_seq
  );
```

Field nullable: transaksi `pending_review` belum punya seq, baru ter-set saat status berubah ke `confirmed` di PATCH endpoint. Basis tanggal harus selaras dengan business-day cutoff di `2026-06-21-shift-cutoff-design.md` (akan dibaca saat implementasi plan).

**Race condition handling:** 2 PATCH bersamaan bisa generate `daily_seq` duplicate. Mitigasi yang dipilih: lock baris terkait via `SELECT ... FOR UPDATE` di awal PATCH transaction, lalu `COALESCE(MAX(daily_seq), 0) + 1` filter business-day. Implementasi konkret di plan.

### 5.2 Client state — `localStorage`

Key: `pak_pon_printer_status`

```ts
type PrinterStatusState = 'success' | 'failed' | 'not_configured';
type PrinterStatus = {
  state: PrinterStatusState;
  last_check: string;        // ISO timestamp
  last_outcome_note?: string; // optional: "test print 14:32", "auto print tx #0042"
};
type PrinterStatusMap = {
  dapur: PrinterStatus;
  minuman: PrinterStatus;
};
```

Default kalau belum ada di localStorage: keduanya `not_configured`, `last_check=null`.

### 5.3 Wide-event types (extend `docs/logging.md`)

Event yang di-emit via `POST /api/print/log` (client → server):

| Event | Field tambahan |
|---|---|
| `print.dispatched` | `tx_id`, `daily_seq`, `target` (dapur\|minuman), `trigger` (auto\|reprint\|test), `items_count`, `url_scheme_variant`, `user_agent` |
| `print.reported_success` | `tx_id`, `target`, `trigger` |
| `print.reported_failed` | `tx_id`, `target`, `trigger`, `failure_note` (opsional dari user) |

Selain itu, PATCH `/api/transactions/[id]` saat confirm sudah ada wide-event existing — di-extend dengan field `daily_seq` yang ter-generate.

### 5.4 Tidak ada (sengaja)

- ❌ Table `print_jobs` — wide-event sudah cukup audit
- ❌ Kolom `transactions.printed_at` — derive dari log
- ❌ Table `printers` config — IP di RawBT (Plan A) atau settings table (Plan B)

## 6. UI / UX flow

### 6.1 Touchpoint 1 — Setup pertama kali (`/setup/printer`)

Page baru, step-by-step:

1. **Install RawBT** (link Play Store, screenshot)
2. **Buat profile "Dapur"** — buka RawBT → Settings → Printers → Add → Type: Network → Name: `Dapur` → IP: (input owner) → Port: 9100 → Save
3. **Buat profile "Minuman"** — sama, beda IP, name `Minuman`
4. **Test koneksi** — 2 button: `Tes Printer Dapur` & `Tes Printer Minuman`
5. **Selesai** — tombol "Selesai" → redirect home, banner hilang

Embed screenshot/gambar di `public/setup-printer/` untuk panduan visual.

### 6.2 Touchpoint 2 — Home banner status

Component `<PrinterStatusBanner />`:

| State (keduanya digabung worst-state) | Tampilan | Aksi |
|---|---|---|
| `not_configured` | Banner merah, persistent | Tombol "Setup printer" → `/setup/printer` |
| `failed` | Banner merah, persistent | Tombol "Tes ulang" → trigger test modal |
| `success` tapi `last_check > 24h` | Banner kuning kecil | Tombol "Tes printer" |
| `success` dan `last_check <= 24h` | Hidden | — |

### 6.3 Touchpoint 3 — Scan flow (modifikasi)

`/scan/review` page — tombol existing **"Simpan"** → rename **"Simpan & Cetak"**:

1. PATCH `/api/transactions/[id]` dengan items final → server set `status=confirmed`, `confirmed_at=now()`, `daily_seq=<next>`
2. Response 200 dengan transaction lengkap (termasuk daily_seq)
3. Client: tentukan target printer berdasarkan kategori items
4. Trigger intent URL ke RawBT untuk tiap target **secara sequential dengan jeda ~300ms** antar target (RawBT belum tentu handle 2 intent burst dengan baik; sequential lebih predictable, latency total masih sub-1s)
5. POST `/api/print/log` event `print.dispatched` × N
6. Update `localStorage` state heuristic (intent dispatched without error → `success`)
7. Toast: "Transaksi tersimpan, mencetak ke dapur & minuman..."
8. Redirect ke `/transactions`

**Edge UX:**
- Kalau `printer_status` belum `success` untuk target yang dibutuhkan → tetap save, toast warning: "Transaksi tersimpan tapi printer belum di-setup. Pergi ke setup?" + tombol → `/setup/printer`
- Kalau cuma 1 kategori (semua minuman atau semua makanan) → cuma trigger 1 printer
- Kalau confirm gagal (PATCH error) → tidak trigger print apapun

### 6.4 Touchpoint 4 — Detail page reprint

`/transactions/[id]` — tambah card di bawah card existing:

```
┌─ Cetak Ulang ─────────────────────┐
│ Terakhir auto-print: 14:32 ✓      │
│                                   │
│ [Cetak Dapur]   [Cetak Minuman]   │
│        [Cetak Keduanya]           │
└───────────────────────────────────┘
```

- Tombol target spesifik di-disable kalau gak ada item kategori relevan (mis. semua minuman → "Cetak Dapur" disabled)
- Tap tombol → trigger intent → modal "Berhasil dicetak? [✓ Ya] [✗ Tidak]" → POST log

### 6.5 Touchpoint 5 — Test printer flow

Reused di `/setup/printer` dan banner. Modal `<TestPrintDialog />`:

```
Cetak tes printer DAPUR
─────────────────────────
Pastikan kertas terpasang di printer dapur,
lalu tekan tombol di bawah.

         [Cetak Tes Sekarang]

(setelah tap)

Apakah kertas keluar dengan tulisan
"Pak Pon - Tes Print Dapur - 14:32"?

   [✓ Berhasil]   [✗ Gagal]
```

- "Berhasil" → `localStorage.dapur.state = 'success'`, POST `print.reported_success`, close modal
- "Gagal" → expand modal: optional textarea "Apa yang terjadi?" (kertas gak keluar, error, dst) + 2 tombol: **[Coba Lagi]** (re-trigger intent, kembali ke pertanyaan) atau **[Tutup]** (set `state = 'failed'`, POST `print.reported_failed` dengan `failure_note`, close)

### 6.6 Touchpoint 6 — Diagnostic page (`/setup/printer/debug`)

Hidden page (gak ada di nav, akses via URL langsung). Tujuan: dev kasih owner instruksi via WA "buka URL ini, screenshot, kirim ke saya".

Isi:
- Current `localStorage` state — JSON dump
- Last 20 print event dari `POST /api/print/log/recent` (sama user)
- Manual test panel: pilih target + URL scheme variant + tombol fire
- Toggle URL scheme variant (untuk Plan B switch, lihat §8)

## 7. Error handling & state

### 7.1 Error register

| # | Skenario | Detectable? | Mitigasi |
|---|---|---|---|
| 1 | RawBT belum install | ❌ (silent fail) | `not_configured` default → banner → tutorial |
| 2 | Printer offline / kabel lepas | ❌ | Modal "Berhasil?" → reprint button |
| 3 | Kertas habis | ❌ | Reprint setelah ganti kertas |
| 4 | RawBT crash mid-print | ❌ | Reprint button |
| 5 | Network down saat PATCH confirm | ✅ HTTP error | Toast existing, print NOT triggered |
| 6 | iWare reject ESC/POS command lanjutan | ❌ (swallow) | Pakai subset minimal: init, text, line feed, cut, bold, double-size |
| 7 | Race `daily_seq` duplicate | ✅ unique constraint | DB transaction + retry; selaras shift-cutoff |
| 8 | localStorage cleared | ✅ data hilang | Auto-recovery: banner muncul → user re-test |
| 9 | 1 printer sukses, 1 gagal | ❌ no callback | Reprint per target di detail |
| 10 | URL scheme mismatch / RawBT version | ❌ silent | Diagnostic page; env-switchable variants |
| 11 | Multi-profile RawBT gak support | **Spike unknown** | Plan B: switch ke IP-direct via settings table (env flag) |
| 12 | Owner salah ketik IP / nama profile | ❌ | Test print flow catches it; banner kuning |

### 7.2 State management

| State | Tempat | Lifetime |
|---|---|---|
| `transactions.daily_seq` | Supabase | Persistent, set 1× saat confirm |
| `pak_pon_printer_status` per target | localStorage (per device) | Persistent sampai cleared |
| Print event log | Wide-event JSON di Vercel logs + (kalau Opsi B §8.2 dipilih) tabel `print_events` di Supabase | Vercel ~7 hari, tabel persistent |
| Toast / modal | React state | Per interaction |

### 7.3 Yang sengaja NOT handled

- ❌ Realtime "printer connected ✓" indicator (impossible di browser)
- ❌ Print queue retry otomatis di background (warung kecil, manual cukup)
- ❌ Print buffer offline (app butuh online untuk save dulu)

## 8. API endpoint baru

### 8.1 `POST /api/print/log`

Body:
```ts
{
  tx_id: string,            // UUID
  daily_seq: number | null, // null untuk event type 'test'
  target: 'dapur' | 'minuman',
  trigger: 'auto' | 'reprint' | 'test',
  outcome: 'dispatched' | 'reported_success' | 'reported_failed',
  failure_note?: string,
  url_scheme_variant?: string, // mis. 'rawbt-v1', 'intent-android'
  user_agent?: string
}
```

Auth: required (sama dengan endpoint lain).
Side effect: emit wide-event via `newEvent('POST /api/print/log')`, no DB write. Return `204 No Content`.

### 8.2 `GET /api/print/log/recent`

Query: `?limit=20`

Returns: array of recent print event (dispatched/success/failed) untuk dipakai di diagnostic page. Implementation choice ditentukan di plan:
- **Opsi A:** query Vercel logs API (kalau tersedia di plan owner)
- **Opsi B:** persist subset event ke tabel `print_events` baru di Supabase

Default rekomendasi: Opsi B (lebih reliable, queryable, gampang test). Trade-off: tambah tabel kecil. Diputuskan di implementation plan.

## 9. Testing strategy

### 9.1 Reality check

Dev TIDAK punya akses ke printer iWare. Owner gak paham IT. Konsekuensi:
- **Spike di hardware** = guided remote test oleh owner via WhatsApp setelah deploy ke preview/prod
- **Logging extensive** = wajib, dev diagnose dari Supabase logs + screenshot owner
- **Diagnostic UI owner-friendly** = section `/setup/printer/debug` (lihat §6.6)
- **Build everything assuming Plan A** lalu deploy. Plan B switch tersedia via env flag tanpa rebuild

### 9.2 Unit tests (Vitest)

- **`lib/escpos.ts`** — generator ESC/POS bytes
  - Golden snapshot: render kitchen ticket dengan mix items → bytes match expected
  - Edge: note kosong, meja kosong, nama kosong, all-minuman, all-makanan
- **`lib/daily-seq.ts`** — generator nomor antrian
  - Race scenario: 2 concurrent PATCH simulasi → 2 nomor unik (atau test trigger jelas berbeda)
  - Cutoff WIB: tx jam 23:30 WIB → seq tertentu, tx jam 00:30 WIB hari berikut → seq reset
- **`lib/print-intent.ts`** — intent URL builder
  - Build URL untuk dapur dengan items makanan/nasi → URL valid, base64 sesuai
  - Build URL untuk minuman dengan items minuman → URL valid
  - Skip target tanpa item
  - Toggle URL scheme variant via env

### 9.3 Component tests (RTL)

- `<PrinterStatusBanner />` — 4 state visualisasi & CTA
- `<ReprintCard />` — disabled state kalau gak ada kategori relevan
- `<TestPrintDialog />` — flow Ya/Tidak/Coba lagi + localStorage update

### 9.4 Integration tests (Vitest + MSW atau Supabase test client)

- `PATCH /api/transactions/[id]` confirm → `daily_seq` ter-set, unique per business-day WIB
- `POST /api/print/log` → wide-event emit, payload valid, requires auth

### 9.5 Owner-guided E2E (post-deploy)

Setelah feature deployed ke preview/prod, dev kirim panduan WA ke owner:
1. Install RawBT, setup 2 profile
2. Buka `/setup/printer`, klik tes — screenshot result
3. Scan nota beneran, klik "Simpan & Cetak" — observe printer
4. Detail tx, klik reprint — observe printer
5. Buka `/setup/printer/debug`, screenshot kirim ke dev

Dev paralel monitor Vercel logs untuk event `print.*`. Diagnose:
- Tidak ada event `print.dispatched` → JS error di client; minta owner buka console
- Ada `print.dispatched` tapi `reported_failed` → bridge/printer issue; minta IP confirmation, RawBT setting screenshot
- Ada `print.dispatched` dan `reported_success` → working ✅

### 9.6 Plan B switch protocol

Kalau setelah debugging Plan A gak workable:
1. Dev set env `PAK_PON_PRINTER_MODE=ip_direct`
2. Tambah halaman admin sederhana `/setup/printer/ip` (kasi input IP dapur + IP minuman, simpan di `settings` table)
3. Client logic switch ke variant baru, kirim IP langsung di URL scheme
4. Re-test dengan owner

Detail Plan B di-defer ke implementation plan kalau perlu, atau bikin spec tambahan.

## 10. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| RawBT multi-profile URL scheme gak support | Medium | High | Owner-guided test post-deploy; Plan B siap di-switch via env |
| iWare printer reject ESC/POS lanjutan | Low | Medium | Subset minimal command |
| URL scheme syntax salah → silent fail di owner | Medium | High | Diagnostic page; env-switchable variants; logging extensive |
| Owner skip setup, lupa, complain | Medium | Low | Banner persistent merah |
| Owner gak ngerti tutorial | Medium | Medium | Screenshot/embed gambar; WA support dev |
| Dev gak bisa diagnose dari jauh | Medium | High | Wide-event ke semua step + diagnostic page screenshot-able |
| localStorage cleared di tab | Low | Low | Auto-recovery banner |
| Race condition `daily_seq` | Low | Medium | DB transaction lock |

## 11. Out of scope

- ❌ Bluetooth thermal printer fallback
- ❌ Cloud print queue / offline mode
- ❌ Print struk PDF untuk pelanggan (separate backlog: `docs/tasks.md` §🖨️ Print)
- ❌ Multi-warung config
- ❌ Custom layout per printer
- ❌ Auto-detect printer / mDNS discovery
- ❌ Print logo bitmap (subset ESC/POS minimal)

## 12. File touchpoints (estimasi)

- `supabase/migrations/0004_print_nota.sql` (NEW)
- `lib/escpos.ts` (NEW) — ESC/POS bytes generator
- `lib/print-intent.ts` (NEW) — URL scheme builder, env-switchable variants
- `lib/daily-seq.ts` (NEW) — nomor antrian generator (helper untuk PATCH route)
- `lib/printer-status.ts` (NEW) — localStorage helper
- `components/PrinterStatusBanner.tsx` (NEW)
- `components/ReprintCard.tsx` (NEW)
- `components/TestPrintDialog.tsx` (NEW)
- `app/(app)/setup/printer/page.tsx` (NEW) — tutorial
- `app/(app)/setup/printer/debug/page.tsx` (NEW) — diagnostic
- `app/api/print/log/route.ts` (NEW) — POST log endpoint
- `app/api/print/log/recent/route.ts` (NEW) — GET recent endpoint
- `app/api/transactions/[id]/route.ts` (MOD) — set `daily_seq` saat confirm
- `app/(app)/scan/review/page.tsx` (MOD) — rename tombol, trigger print
- `app/(app)/transactions/[id]/page.tsx` (MOD) — tambah ReprintCard
- `app/(app)/page.tsx` (MOD) — embed PrinterStatusBanner
- `public/setup-printer/*` (NEW) — screenshot panduan
- `docs/logging.md` (MOD) — dokumentasi event `print.*` baru

## 13. Open questions deferred ke implementation plan

- Exact ESC/POS layout (font size, line width 32/48 char untuk 58mm/80mm)
- Exact URL scheme syntax RawBT (resolve via spike post-deploy)
- Format default URL scheme variant: `rawbt:` vs `intent://` Android intent
- Mekanisme query recent log (Vercel logs API, atau persist subset di tabel)
- UI styling — selaras dengan migration shadcn (`2026-06-21-shadcn-migration-design.md`) jika sudah landed
