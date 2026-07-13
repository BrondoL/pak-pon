# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project context

Pecel Lele Pak Pon — internal POS/reporting web app untuk warung pecel lele. Bukan public-facing. Dipakai kasir (foto nota → OCR Gemini → review → simpan) & owner (reporting harian/bulanan, menu master). 1 akun share, Supabase Auth.

See:
- `docs/brief.md` — product brief & user stories
- `docs/spec.md` — pointer ke spec lengkap
- `docs/tasks.md` — progress tracker
- `docs/logging.md` — wide-event logging pattern (loggingsucks.com style)
- `docs/superpowers/specs/2026-06-20-pak-pon-design.md` — design spec lengkap (sumber kebenaran)
- `docs/superpowers/specs/2026-06-25-print-revamp-design.md` — arsitektur print sekarang (kitchen + customer format, FCM-only dispatch, print_history)
- `docs/superpowers/specs/2026-07-01-ocr-image-schema-optimization-design.md` — arsitektur OCR sekarang (single-model, `responseSchema` menu enum, empirical Gemini image tok findings)
- `docs/superpowers/specs/2026-07-08-pos-direct-order-with-chips-design.md` — arsitektur POS direct order (`/pos` route) + per-menu chips (mutex_group + price_delta), snapshot `applied_chips` di transaction_items

## Commands

- `npm run dev` — start dev server http://localhost:3000
- `npm run build` — production build
- `npm run start` — serve production build
- `npm run lint` — ESLint
- `npm run test` — Vitest sekali jalan
- `npm run test:watch` — Vitest watch mode

## Conventions

- Money: simpan `bigint` rupiah (tanpa sen). Format dengan `formatRp()` dari `lib/currency.ts` → "Rp 120.000".
- Timezone: Asia/Jakarta (WIB) untuk semua date display & cut-off harian.
- Validation: Zod di semua API route boundaries.
- Logging: wide-event pattern di semua route handler — `try/catch/finally`, `newEvent()` di awal, `evt.emit()` di finally. Lihat `docs/logging.md`.
- Schema source of truth: `supabase/migrations/*.sql`.
- Image: client compress dulu (`lib/compress.ts`) sebelum upload — max width dari `NEXT_PUBLIC_IMAGE_MAX_WIDTH` env (default 1600, range 256-4096).
- Auth: pages dalam `app/(app)/` harus auth; `app/(auth)/` public.
- Soft delete: `transactions` pakai `deleted_at` timestamp (cron cleanup >7 hari). `menus` pakai `is_active=false` (permanent, preserve FK).
- Reporting: agregasi total/count di **DB side via SQL function** (`report_*` di migrasi 0034), jangan iterasi row di JS. PostgREST default `db-max-rows=1000` diam-diam truncate → total under-report + hari acak hilang dari grafik (insiden 2026-07-13, bulan Juli 779/1779 tx hilang). Kalau perlu list per-row (pagination), pakai `.range()` + `count: 'exact'`.
- Next.js 16: konsultasi `node_modules/next/dist/docs/01-app/` sebelum menulis route handler / middleware / server actions / dynamic APIs (banyak breaking changes vs versi sebelumnya).

## OCR system (single-model + responseSchema, shipped 2026-06-30 + 2026-07-01)

- **Model**: `gemini-3.5-flash` only, single attempt (no fallback). Env `GEMINI_FAST_MODEL` override. Kalau gagal → `EMPTY_RESULT`, kasir input manual via "+ Tambah item".
- **Prompt**: `lib/prompts.ts` — short-key JSON output (m/q/n/c/t/cn/tn). Zod `.transform()` re-expand ke long-key untuk consumer code. Instruksi menu enum tidak di prompt lagi. Field `a` (alternatives) di-remove per 2026-07-03 — UX pakai swap manual via ✏️ modal saja.
- **Schema**: `buildScanResponseSchema(menus)` = Gemini `responseSchema` config, constrain `m` ke enum menu names. **Enum values gratis di input tokens** (verified via `scripts/verify-response-schema.mjs`).
- **Thinking config**: `thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }`. Gemini 3.x **tidak honor** `thinkingBudget` (itu API 2.5 — silently ignored di 3.x). Level = minimal/low/medium/high, default medium. A/B 2026-07-03 (5 foto × medium+minimal) → akurasi 100% match, cost −78%, latency −75%. Stuck di minimal.
- **Wide-event log**: `ocr_attempts[]` include `input_tokens`, `output_tokens` (candidates + thoughts), `thoughts_tokens`, `total_tokens` per attempt. `ocr_fell_back` always false (kept untuk log-shape backward compat).
- **Image tok quirk**: Gemini 3.5 Flash charge HARD MIN ~1089 tok untuk apapun inline image (bahkan thumbnail 192×256). Kompresi/crop **tidak** turunkan bill di model ini. Cuma bantu bandwidth kasir HP.
- **Cost baseline `minimal`** (2026-07-03, A/B 5 scan): avg 1,452 tok input + 157 tok output/scan (0 thinking) = **~$0.0036/scan** ≈ **65 IDR/scan**. Proyeksi 150 scan/hari: **~292k IDR/bulan** (@18000). Latency avg ~2.5 detik (medium: ~9.9 detik).
- **Cost tracking**: `ai_usage_daily.output_tokens = candidatesTokenCount + thoughtsTokenCount` (match dashboard Google 1:1). `thoughts_tokens` di-kolom terpisah biar bisa lihat porsi thinking.
- **Runaway guardrails (2026-07-11, defense-in-depth 2026-07-12)**: 3 layer, urut dari preemptive → salvage:
  1. **Schema constraints** di `buildScanResponseSchema`: `maxLength` (`tn`:10, `cn`:40, `n`:60) + `pattern` regex (`tn`:`^[A-Za-z0-9 ]{1,10}$`, `cn`:`^[A-Za-z0-9 .\-'()]{1,40}$`). ⚠️ `maxLength` di Gemini 3.x = HINT bukan hard cap (verified 2026-07-12: `tn` output 685 tok meski maxLength=20). `pattern` lebih strict, tapi jangan pernah trust sebagai satu-satunya rem.
  2. **`stopSequences`** di `lib/gemini.ts`: `['0000000','1111111','8888888','9999999','2222222']` — max 5 (Gemini API hard limit, verified via 400 error 2026-07-12). Pilih digit paling common di degenerate loop: 0/1/8/9 (overflow bias) + 2 dari observed sample. Model auto-stop begitu detect → `finishReason='STOP'` di ~50 tok bukan 700. Real content ga akan trigger (rupiah 6 digit max, nomor meja ≤3 char). Digit lain (3-7) skip — kalau loop di sana, tertangkap layer JSON repair.
  3. **`maxOutputTokens: 700`** di config — hard fuse terakhir kalau layer 1+2 miss. Sized dari data historis 1298 scan / 9 hari (nota terpadat 18 items ~490 tok, margin 43%). Worst-case bill kalau trigger: ~11 IDR/scan.
- **JSON repair (2026-07-12)**: kalau MAX_TOKENS tetap ke-trigger dan JSON invalid, `repairTruncatedJson()` di `lib/prompts.ts` regex-detect trailing `,"key":"...` unterminated → strip fieldnya → `balanceBrackets` tutup `{`/`[` sisa. Zod parse ulang. Field yg loop hilang (null), rest of scan (items/total/customer_name) preserved. `ScanAttempt.recovered_from_truncation:true` di attempt log; wide-event top-level `ocr_recovered_from_truncation`. Insiden 2026-07-11 pre-fix: full scan lost. Post-fix (verified via replay 2026-07-12): 6 items + cn recovered, kasir tinggal isi nomor meja manual.
- **Anomaly detection**: kolom `ai_usage_daily.anomaly_count` (migrasi 0033) increment tiap scan yg (a) `finishReason !== 'STOP'` (MAX_TOKENS runaway, SAFETY, dst) ATAU (b) `finishReason === 'STOP'` tapi `outcome !== 'success'` (added 2026-07-12 — cover stopSequences false positive kayak nota ≥10jt trigger `0000000` → JSON parse fail; tanpa cek outcome silent failure). UI `/setup/ai-usage` tampil banner merah + badge per hari. Wide-event log tag `ocr_anomaly:true` + `ocr_anomaly_reasons` untuk forensic. `recordUsageDaily` sengaja skip insert kalau tokens 0 → mismatch AI Studio dashboard = signal ada API error tanpa response.

## Print system (Phase 1+2+3 shipped 2026-06-25, primary agent + pending state 2026-06-26)

- **Format**: kitchen ticket (dapur/minuman) pakai double-size ESC/POS, no price (`lib/escpos.ts:renderKitchenTicket`). Customer receipt format lengkap + footer (`renderCustomerReceipt`). Flag `is_takeaway` (kolom `transactions.is_takeaway`, migrasi 0031) → kitchen ticket render banner "*** BUNGKUS ***" (double-size, center, bold) + label "Tipe: BUNGKUS" di info block; customer receipt render "Tipe: Bungkus" kecil. Edit tx confirmed + toggle bungkus → semua target existing di-mark modified → modal reprint keluar biar dapur dapet tiket baru.
- **Dispatch**: `POST /api/print/send` cek `agent_heartbeats.is_primary=true AND status='online' AND last_seen_at>now()-24h AND fcm_token IS NOT NULL` → **INSERT `print_history` (status='pending')** sebagai proof of dispatch → kirim FCM ke 1 primary agent (no fan-out, no race). Agent UPDATE row jadi done/failed saat selesai (bukan INSERT). Primary di-set owner via `/setup/printer/debug` (`PATCH /api/agent/[id]` → RPC `set_primary_agent` atomic swap). Route by row `id` (PK uuid) bukan `agent_label` karena label boleh duplikat (UNIQUE dipindah ke `agent_uuid` di retrofit 0011a). Backfill migrasi 0024 pilih agent dengan heartbeat terbaru. **24h threshold** sengaja longgar supaya FCM bypass OEM freeze (HiOS/MIUI dll) — `last_seen_at` cuma tracker heartbeat, bukan liveness. Primary offline → 503 dengan `detail='primary agent offline or not set'`.
- **Polling fallback**: agent app polling tiap 60s (`PendingJobPoller`, primary device only) — fetch `print_history WHERE status='pending' AND created_at > now()-5min`. In-process `JobProcessor.inFlight` set cegah FCM × poll double-process job sama. Manual "Cek pending" button di agent app trigger immediate tick.
- **Stale sweep**: cron `/api/cron/print-sweep` (*/5 min) UPDATE `status='pending' AND created_at < now()-5min` → `status='failed', failure_reason='timeout: agent did not ack'`.
- **Agent state UI**: 3-state via `/api/agent/heartbeat` — `online` (status=online + heartbeat <1h), `stale` (status=online + heartbeat >=1h, warning kuning), `offline` (status=offline, alarm merah). Banner `printer-status-banner.tsx` fokus ke status primary, bukan agent generik. DELETE primary diblok 409 kalau masih ada agent lain (owner harus pindahin dulu).
- **Audit**: web INSERT `print_history` status=pending saat dispatch; agent UPDATE jadi done/failed via `markDone`/`markFailed` (claim filter `.eq("status","pending")` = no-op kalau sudah ke-update worker lain). Trigger `mark_items_printed_history` fire di transisi pending→done (`AFTER UPDATE OF status`), set `transaction_items.printed_*_at` kalau `item_ids` non-null. Customer print skip flag (item_ids null).
- **Delta logic**: edit save tx confirmed → cuma items dengan flag NULL yang di-print (`auto_additional`). Items existing dimodifikasi (qty/menu/notes) → modal pilihan reprint full ke target atau skip.
- **Cleanup**: cron 02:00 WIB hapus `print_history >7 hari`.

## POS direct order + per-menu chips (shipped 2026-07-08)

- **Route `/pos`**: single-page hybrid — menu picker grid (kiri, kategori tabs + search) + cart (kanan, header form nama/meja/bungkus). Tablet landscape primer, HP responsif 1-kolom stacked dengan fixed bottom bar `Simpan & Cetak {total}`. Skip `pending_review` — save langsung `confirmed` + auto-print kitchen. Home tile "Buat Pesanan" + link "POS" di navbar. Edit tx belakangan tetap via `/transactions/[id]/review` existing.
- **Chips per menu (table `menu_chips`)**: label + `price_delta ≥0` (bigint) + `mutex_group text nullable` + `sort_order`. Owner CRUD via inline editor di `menu-form` (label / +Harga / Grup). Mutex behavior: chip dengan `mutex_group` sama → radio section di picker (pilih satu, boleh 0 selected). `mutex_group = NULL` → multi-select section "Pilihan cepat". Hard-delete di master aman karena snapshot udah frozen.
- **Snapshot `applied_chips` jsonb** di `transaction_items` (migrasi 0032): `[{label, price_delta}]` frozen at save. `mutex_group` sengaja **tidak** disnapshot (cuma constraint saat picker input, redundan di history). `unit_price_snapshot = base + Σ price_delta`. `computeReplaceItems` preserve historical price kalau menu + chips unchanged; recompute kalau chip diubah saat edit.
- **`POST /api/pos`** (baru): validate Zod → fetch menus + `fetchChipsByMenu` → `validateChipMutex` + `buildAppliedChipsSnapshot` server-side (client kirim `chip_labels: string[]`, bukan price — cegah tampering) → daily_seq computed sama seperti PATCH confirm → insert tx `confirmed` + items batch. Wide-event `pos_transaction_created` include `chip_count`, `has_free_notes`, `elapsed_ms`. Sync `useRef` lock cegah double-tap create dua tx.
- **`PATCH /api/transactions/[id]`** extended: `items[].chip_labels` optional (default []). Server snapshot sama seperti POS. `detectModalContext` di review-form pakai `chipsKey` (sorted labels join) untuk deteksi chip change → reprint modal.
- **Kitchen ticket**: chip labels (bold) di baris terpisah + free-text notes di baris kedua. Customer receipt: **cuma chip `price_delta > 0`** yg tampil (justify harga), zero-delta chip + free-text skip.
- **Shared helpers** (extract 2026-07-08): `lib/print-dispatch.ts` (`dispatchKitchenPrintJob` dipake POS + review-form), `components/chip-picker.tsx` (dipake `NotaItemModal` + `PosItemConfigModal`), `lib/menu-chips.ts::fetchChipsByMenu` (dipake POST /api/pos + PATCH transactions).
- **History indicator**: transaction list badge kecil "POS" di baris yg `scan_image_path === null` (proxy: reliable sampai cron retention foto shipped).
