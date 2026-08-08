# Pak Pon — Implementation Progress

## Plan 1 — Foundation, Auth, Menu Master ✅ COMPLETE
- [x] T1 Project bootstrap
- [x] T2 Supabase project + migrations
- [x] T3 Currency util + tests
- [x] T4 Supabase clients
- [x] T5 Auth: middleware + login
- [x] T6 (app) layout + Home
- [x] T7 Menu API routes
- [x] T8 Menu master UI
- [x] T9 vercel.ts + deploy verify
- [x] T10 UI redesign — warm warung visual identity (navy/gold/brick palette dari logo brand)
- [x] Final code review + cleanup fixes

## Plan 2 — Scan + OCR + Review + Save ✅ COMPLETE
- [x] T1 Install deps (@google/genai, browser-image-compression) + vercel.json
- [x] T2 lib/compress.ts client-side compression
- [x] T3 lib/prompts.ts OCR prompt + Zod schema (TDD)
- [x] T4 lib/gemini.ts SDK wrapper (Flash+Pro fallback saat awal, disederhanakan jadi single-Flash 2026-06-30 — lihat Plan 6)
- [x] T5 /api/scan POST handler
- [x] T6 lib/transactions.ts replace-items diff helper (TDD)
- [x] T7 /api/transactions/[id] GET + PATCH
- [x] T8 components/photo-uploader.tsx
- [x] T9 /scan page
- [x] T10 components/nota-item-row.tsx
- [x] T11 nota-item-modal + nota-review-form
- [x] T12 /transactions/[id]/review server component

End-to-end: foto nota → OCR Gemini → review editable → simpan ke DB + storage.

## Plan 3 — History + Reports + Cron ✅ COMPLETE
- [x] T1 lib/date.ts WIB helpers (TDD)
- [x] T2 GET /api/transactions list with filters + pagination
- [x] T3 DELETE /api/transactions/[id] + preserve confirmed_at
- [x] T4 components/date-filter + transaction-list
- [x] T5 /transactions history list page
- [x] T6 /transactions/[id] detail (read-only) + delete confirm
- [x] T7 GET /api/reports/daily
- [x] T8 GET /api/reports/monthly
- [x] T9 /reports/daily closingan page
- [x] T10 /reports/monthly CSS bar chart page
- [x] T11 /reports landing
- [x] T12 lib/supabase/admin + /api/cron/cleanup + vercel.json cron

End-to-end: history searchable + filtered + editable + soft-deletable, reports harian & bulanan dengan top-5, cron 02:00 WIB auto-clean.

### Hotfix: DB-side aggregation + row-cap guardrails (2026-07-13)
Konteks: owner report tanggal 11 hilang dari `/reports/monthly` walau di Supabase ada. Root cause: Supabase JS `.select()` tanpa `.range()`/`.limit()` diam-diam ke-cap `db-max-rows=1000` (PostgREST default). Juli 2026 punya 1779 tx confirmed non-deleted → 779 row hilang, physical row order dari storage bikin Jul 11 kebetulan drop full (247 tx / Rp 33 jt). Efek yang sama merambat ke total bulanan (under-report) + home ringkasan hari ini + summary card `/transactions` kalau range multi-hari.
- [x] Migrasi 0034: SQL functions `report_home_today` / `report_daily` / `report_monthly` / `report_transactions_summary` — semua aggregate di DB side, `LANGUAGE sql STABLE SECURITY INVOKER`, `GRANT EXECUTE TO authenticated`. Business-day cutoff dilempar sebagai `p_cutoff_hours` int dari JS supaya sumber kebenaran tetap satu (`lib/date.ts`).
- [x] Rewire 6 konsumer ke `.rpc()`: `/api/reports/monthly`, `/reports/monthly`, `/api/reports/daily`, `/reports/daily`, `/` (home), `/transactions` (summary card). JS cuma backfill zero-days array untuk chart bar-nya.
- [x] `/api/cron/cleanup` unbounded select → chunked loop (`LIMIT 500` per batch, order `deleted_at ASC`, hapus storage + DB per batch, ulang sampai kosong). Cegah bulk-delete backlog silently truncate.
- [x] `/transactions/trash` flat `LIMIT 100` → proper pagination (`PAGE_SIZE=50` + `?page=` URL param + `count: 'exact'` + Prev/Next `<Link>`). Owner bisa recover semua deletion di retention window, bukan cuma 100 terbaru.
- [x] CLAUDE.md convention bullet baru: aggregation lewat SQL function di DB side default; pagination default untuk row list.

**Hasil verifikasi**: monthly RPC Jul 2026 = 13 hari lengkap, Jul 11 = 247 tx / Rp 33.043.000, grand total = Rp 221.454.000 (vs pre-fix under-report parah). lint ✓, tsc ✓, 220/220 vitest ✓.

## Plan 5 — Print Revamp (Nota Format + FCM-Only) ✅ COMPLETE (web)
Spec: `docs/superpowers/specs/2026-06-25-print-revamp-design.md`
- [x] **Phase 1** — Format nota: kitchen ticket BIG (item+qty, no price) vs customer receipt (harga + total + footer "Terima kasih"). Item flag `printed_dapur_at`/`printed_minuman_at` per-target. Tombol "Cetak tambahan" (auto-delta), "Cetak ulang Dapur/Minuman/Keduanya", "Cetak nota customer". Auto-print delta only saat edit confirmed tx (re-prints baru item tambahan, ngga ngulang). `replaceItems` preserve flag lewat PATCH save. Plan: `docs/superpowers/plans/2026-06-25-print-revamp-phase1-nota-format.md`.
- [x] **Phase 2 (web)** — FCM-only architecture switch. Drop realtime watcher dependency. New `POST /api/print/send` cek `agent_heartbeats.status='online' AND last_seen_at>now()-90s`, kalau ngga ada → 503 `agent_offline` (toast warning di client). `print_history` table baru (audit-only, agent write saat job final). `agent_heartbeats.status` explicit online/offline. Trigger update `printed_*_at` pindah dari print_queue ke print_history. Debug page switch ke history source. Cron extend cleanup history >7 hari. Plan: `docs/superpowers/plans/2026-06-25-print-revamp-phase2-fcm-only-web.md`.
- [x] **Phase 3 (web)** — Cleanup: `DROP TABLE print_queue CASCADE`, delete `/api/print/queue/*` routes, rename `pushCheckQueue → pushPrintJob` + drop legacy `check_queue` fallback. Plan: `docs/superpowers/plans/2026-06-25-print-revamp-phase3-cleanup-web.md`.
- [x] **Phase 2 (agent)** — Strip realtime watcher + periodic + alarm trigger paths. FCM-only entry point. Start/Stop button → upsert `agent_heartbeats.status`. `PrintHistoryRepository` insert saat job final (done/failed). Tab History di agent app + Retry button. Plan: `docs/superpowers/plans/2026-06-25-print-revamp-phase2-agent.md`.
- [x] **Phase 3 (agent)** — Cleanup: remove `realtime-kt` dependency dari `build.gradle.kts`, drop dead code di agent repo.
- [x] **E2E test (2026-06-25)** — semua critical scenario PASS (A1/A3/A4, B1-B3, C1, D1/D2, E, G1, H1, I1, M1/M3, printed_*_at preservation, FCM bypass OEM freeze). Discovered + fixed: id-undefined NULL violation, cron cleanup dropped table, dispatch threshold defeat FCM (90s→24h), introduced 3-state agent UI (online/stale/offline 1h). Test plan: `docs/superpowers/plans/2026-06-25-print-revamp-e2e-test-plan.md`.

## Plan 4 — Shift Cut-off + shadcn Migration + Polish ✅ COMPLETE
- [x] Shift-aware business-day cut-off (`docs/superpowers/specs/2026-06-21-shift-cutoff-design.md`)
- [x] shadcn migration full primitive replacement + Dialog/AlertDialog/RadioGroup/Select/Sonner (`docs/superpowers/specs/2026-06-21-shadcn-migration-design.md`)
- [x] Favicon + PWA manifest
- [x] OCR loading spinner + aria-live
- [x] Soft-delete restore (`POST /api/transactions/[id]/restore` + `/transactions/trash`)
- [x] Sonner toasts + Undo action pada delete
- [x] Empty states ramah di Home/daily/monthly/menu
- [x] Menu edit form pindah ke Dialog modal (no more scroll-up)

## Plan 6 — OCR Token Reduction ✅ COMPLETE (2026-06-30 + 2026-07-01)

Bill kasir ~600k IDR/bulan @ 150 tx/hari. Dua putaran optimasi.

### Round 1: Single-model + prompt trim (2026-06-30)
Plan: `docs/superpowers/plans/2026-06-30-ocr-token-reduction.md`
- [x] Drop kolom `transactions.rescanned_at` (migrasi 0027)
- [x] Hapus `/api/transactions/[id]/rescan` endpoint + tombol "Scan ulang dengan Pro" di review page
- [x] `lib/gemini.ts` single-model (drop Pro fallback + `ScanOptions`)
- [x] `lib/prompts.ts` menu ref cuma nama (drop kategori+harga), trim system prompt 2400→~1400 char
- [x] Output JSON pakai short keys (m/q/n/c/a/t/cn/tn) + Zod `.transform()` re-expand → consumer code untouched
- [x] Skip null fields di prompt + Zod optional
- [x] Fix hallucination `handwritten_total` saat kasir ga nulis total

**Hasil**: 2530 → 1879 tok (-26% total). Correctness intact.

### Round 2: responseSchema + image compress (2026-07-01)
Plan: `docs/superpowers/plans/2026-07-01-ocr-image-schema-optimization.md`, spec: `docs/superpowers/specs/2026-07-01-ocr-image-schema-optimization-design.md`
- [x] Smoke verify Gemini `responseSchema` tidak count enum sebagai input token (`scripts/verify-response-schema.mjs`)
- [x] `buildScanResponseSchema()` builder — menu enum via schema, tidak lagi via prompt text
- [x] `lib/gemini.ts` pakai `responseSchema` config; drop `buildMenuRefText`
- [x] Prompt trim lanjut (schema enforce menu enum)
- [x] Fix regressi: `a` field vs verbose `n` notes (add contoh JSON di prompt)
- [x] `NEXT_PUBLIC_IMAGE_MAX_WIDTH` env var (default 1600, code-only lever)
- [x] Smoke verify image tok scaling (`scripts/verify-crop-tokens.mjs`)

**Hasil**: 1879 → 1512 tok (-19% dari Round-1, total -40% dari 2530 baseline). Bill ~540k IDR/bulan (estimate lama — belum count thinking tok, corrected di Round 3).

### Round 3: Thinking-level fix + accurate billing + alt removal (2026-07-03)
Konteks: web `output_tokens` (18.2k) mismatch Google dashboard (83.7k) — ternyata `thinkingBudget: 0` di code silently ignored karena Gemini 3.x pake `thinkingLevel`, bukan `thinkingBudget`. Model tetep mikir default `medium` → thinking tokens ~570/req di-bill sebagai output tapi ga tercatat.
- [x] Migrasi 0029: kolom `ai_usage_daily.thoughts_tokens bigint`, RPC signature include `p_thoughts`
- [x] `lib/gemini.ts` capture `usage.thoughtsTokenCount`; `output_tokens = candidates + thoughts` (match dashboard 1:1)
- [x] `lib/gemini.ts` swap `thinkingBudget: 0` → `thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }` (Gemini 3.x correct API)
- [x] UI `/setup/ai-usage` tambah kolom "Thinking"
- [x] Migrasi 0030: drop `transaction_items.alternatives` — feature "chip swap AI" dihapus, kasir edit manual via ✏️ modal. `a` field di prompt/schema/UI dihilangin. `confidence` tier highlight tetap.
- [x] A/B `medium` vs `minimal` (5 foto identik): akurasi 100% match, cost/scan −78% ($0.0167 → $0.0036), latency −75% (9.9s → 2.5s). Keep `minimal` permanent.

**Hasil**: cost real (dengan thinking) `medium` ~1.35M IDR/bulan (150 tx/hari) → `minimal` **~292k IDR/bulan** (~65 IDR/scan). Selisih **~1M IDR/bulan hemat**. Latency kasir 4× lebih cepat. Task OCR menu-enum-constrained ternyata ga butuh reasoning berat.

### Findings kritis (documented di spec)
- Gemini 3.5 Flash charge HARD MINIMUM ~1089 tok untuk apapun inline image (verified via cropping/resize test — bahkan 192×256 thumbnail 9KB tetap 1089 tok). **Image manipulation tidak turunkan bill.** Phase 2 (template crop) killed.
- `responseSchema` enum values = free input tokens.
- `a` field usage inconsistent di Flash 3.5 (stochastic — kadang isi, kadang dump ke `n`). Feature dihapus 2026-07-03.
- **Gemini 3.x pake `thinkingLevel` (minimal/low/medium/high, default medium), BUKAN `thinkingBudget`** — kalau salah pilih, silently ignored + tetep di-bill. Thinking tokens dibill sebagai output ($9/1M).
- Untuk task dengan `responseSchema` menu-enum ketat, `thinkingLevel: 'minimal'` cukup — reasoning berat ga dibutuhin. A/B evidence 2026-07-03.

### Round 4: Runaway guardrails + anomaly detection (2026-07-11)
Konteks: insiden 2026-07-11 — model degenerate loop di field `tn` (no. meja) sampai `finishReason: MAX_TOKENS`, 65,521 output tok = bill 40× normal, JSON invalid → kasir dapet EMPTY_RESULT. Tanpa cap default Gemini output limit >65k tok. Perlu safety fuse + observability.
- [x] `lib/gemini.ts` `maxOutputTokens: 700` — sized dari data historis 1298 scan / 9 hari (max nota 18 items ~490 tok, margin 43%)
- [x] `lib/prompts.ts` `buildScanResponseSchema` tambah `maxLength` di free-string field: `tn` 20, `cn` 40, `n` 60 — grammar-level rem cegah repetition loop
- [x] `lib/gemini.ts` track `finish_reason` per `ScanAttempt` dari `response.candidates[0].finishReason`
- [x] Migrasi 0033: kolom `ai_usage_daily.anomaly_count integer`, RPC signature include `p_anomaly`
- [x] `lib/ai-usage.ts` `recordUsageDaily` hitung anomaly = attempts.some(finish_reason !== 'STOP')
- [x] `app/api/scan/route.ts` wide-event tag `ocr_anomaly:true` + `ocr_anomaly_reasons:[]` biar bisa filter di Vercel Log Search
- [x] `/setup/ai-usage` UI: banner merah di SummaryCard kalau anomaly>0 bulan ini, badge `⚠ N` per row di tabel harian

**Hasil**: worst-case bill runaway di-cap ~11 IDR/scan (vs ~2600 IDR pre-fix, 236× reduction). Owner bisa monitor anomaly dari dashboard app sendiri tanpa buka Vercel/AI Studio.

### Round 5: Defense-in-depth + JSON repair salvage (2026-07-12)
Konteks: insiden Round 4 recur — model tetap degenerate loop di `tn` sampai `MAX_TOKENS` (bill di-cap tapi scan lost total). Root cause: `maxLength` di Gemini 3.x responseSchema treated as HINT, bukan hard cap (verified: `tn` output 685 tok meski `maxLength=20`). Butuh layer preemptive lebih strict + salvage logic.
- [x] `lib/prompts.ts` `OCR_SYSTEM_PROMPT` tambah "Max 10 karakter" hint di baris `cn, tn` (+~5 tok/scan)
- [x] `lib/prompts.ts` `buildScanResponseSchema` tambah `pattern` regex di `n`/`cn`/`tn` (strict character class). `tn` maxLength turun 20 → 10.
- [x] `lib/gemini.ts` `stopSequences: ['8888888','9999999',...,'7777777']` (10 run-of-7 digit) — model auto-stop di ~50 tok kalau loop trigger, `finishReason='STOP'`.
- [x] `lib/prompts.ts` `repairTruncatedJson()` + `balanceBrackets()` — regex-detect trailing unterminated `,"key":"...` → strip → close `{`/`[`. Salvage MAX_TOKENS truncation.
- [x] `lib/gemini.ts` `scanNota` — on `JSON.parse` fail, coba `repairTruncatedJson` sebelum bail ke `EMPTY_RESULT`. Success set `attempt.recovered_from_truncation:true`.
- [x] `app/api/scan/route.ts` wide-event top-level `ocr_recovered_from_truncation` flag (filter Vercel Log biar bisa track trend).
- [x] `lib/prompts.test.ts` — 8 test baru: repair unterminated tn/cn/n, first-field truncation, nested items, no-op on valid JSON, empty input, integration dengan Zod scan schema.

**Hasil**: verified via replay payload asli (2026-07-12 failure): 6 items + `cn:"Lili's"` **fully recovered**, kasir tinggal isi nomor meja manual. Scan yg tadinya total-loss sekarang usable. Cost overhead: +5 tok/scan input (~$0.00002 ≈ 0 IDR).

### Opsi cost-reduction lanjutan (belum urgent)
- Model switch: coba `gemini-flash-lite` atau `gemini-2.0-flash` — different pricing tier
- Context caching: pad prompt >1024 tok + explicit cache API (perlu verify SDK support)
- Batching multi-nota — TIDAK amortize (image tok tetap per-image)

---

## Plan 7 — POS Direct Order + Per-Menu Chips ✅ COMPLETE (2026-07-08)

Spec: `docs/superpowers/specs/2026-07-08-pos-direct-order-with-chips-design.md`
Plan: `docs/superpowers/plans/2026-07-08-pos-direct-order-with-chips.md`

- `/pos` hybrid layout (menu picker grid + cart), single-shot save = `confirmed` + auto-print kitchen (skip pending_review).
- Table `menu_chips` (label / price_delta ≥0 / mutex_group nullable / sort_order), hard-delete via ON DELETE CASCADE.
- `applied_chips` jsonb snapshot on `transaction_items` — historical safe, `mutex_group` intentionally NOT snapshotted.
- Multi-select chip picker dengan mutex_group section (radio behavior per grup, 0-selected allowed) + "Pilihan cepat" section (free multi-select).
- Kitchen ticket: chip labels (bold) + free-text notes lines. Customer receipt: chip yg `price_delta > 0` only, skip notes.
- Menu master (`components/menu-form.tsx`) extended inline chip editor. Menu list badge "N pilihan".
- `POST /api/pos` bikin tx `confirmed` dengan chip snapshot server-side (buildAppliedChipsSnapshot + validateChipMutex from `lib/menu-chips.ts`).
- `PATCH /api/transactions/[id]` accept `chip_labels` per item + snapshot server-side. `computeReplaceItems` preserve historical unit_price kalau menu + chips unchanged.
- Existing OCR flow zero-regression — items default `applied_chips = []`.
- Migration `0032_menu_chips_and_applied.sql` (also makes `scan_image_path` idempotently nullable for POS tx without foto).

---

## Plan 8 — Monitor Meja Belum Bayar ✅ COMPLETE (2026-07-21)

Spec: `docs/superpowers/specs/2026-07-21-monitor-unpaid-tables-design.md`
Plan: `docs/superpowers/plans/2026-07-21-monitor-unpaid-tables.md`

- Route `/monitor` (tile home + navbar) — daftar transaksi belum bayar hari ini, polling 15s + refresh manual.
- Migration `0036_transactions_paid_at.sql` — kolom `paid_at timestamptz` (NULL = belum bayar) + partial index `idx_transactions_unpaid`.
- Filter: `status='confirmed'` + `is_takeaway=false` + `paid_at IS NULL` + `deleted_at IS NULL` + business-day range. Urut `created_at` asc (paling lama di atas).
- `GET /api/monitor` (polling) reuse `fetchUnpaidRows` (`lib/monitor-server.ts`); helper murni + test di `lib/monitor.ts`.
- Tandai lunas via `PATCH /api/transactions/[id]` `{paid:true}` (extend, reuse `buildPaidUpdate`), optimistic remove + rollback. Undo di halaman detail (`{paid:false}`) + badge status bayar.
- Modal detail read-only (tap kartu, tanpa redirect) + tombol "Buka detail lengkap".
- Search client-side by meja/nama (filter `rows` yang sudah di-poll, tanpa API baru).
- **Laporan tidak disentuh** — `report_*` tetap agregasi `confirmed`, abaikan `paid_at`. Data historis `paid_at=NULL` aman (tersaring filter hari-ini).

---

## Plan 9 — Retensi Foto Nota 7 Hari ✅ COMPLETE (2026-07-23)

Spec: `docs/superpowers/specs/2026-07-23-scan-image-retention-design.md`
Plan: `docs/superpowers/plans/2026-07-23-scan-image-retention.md`

- Migration `0037_scan_image_retention.sql` — kolom `scan_image_purged_at timestamptz` (NULL = foto belum di-purge) + partial index `idx_transactions_photo_purgeable ON (created_at) WHERE scan_image_path IS NOT NULL`.
- Cron `/api/cron/cleanup` **pass-3** — purge foto nota transaksi >7 hari (`created_at < cutoff`, filter umur transaksi bukan `deleted_at`) TANPA hapus transaksinya: `storage.remove` dari bucket `notas` → `scan_image_path=NULL` + `scan_image_purged_at=now()`. Batch 500 (cegah PostgREST 1000-row cap), idempoten (path NULL → keluar dari index). Storage error non-fatal (warn), tetap update DB biar ga retry tiap hari. Wide-event `photos_purged_count`.
- Badge riwayat pakai helper murni `mapTransactionSource()` (`lib/transactions.ts`, + test) — POS = `scan_image_path` NULL **dan** `scan_image_purged_at` NULL; OCR yang fotonya sudah di-purge tetap OCR (fix proxy lama yang bakal salah-label POS).
- UI note "Foto nota sudah dihapus (retensi 7 hari)" di `/transactions/[id]` detail + `/transactions/[id]/review` saat `scan_image_path` NULL tapi `scan_image_purged_at` terisi (bukan broken image).
- **Konteks operasional (verifikasi 2026-07-22)**: Storage `notas` sempat 546 MB / 1 GB (3.586 foto, tumbuh ~23 MB/hari) — bottleneck utama free tier. Post-retensi steady-state ~130 MB (~7 hari). DB cuma 26 MB / 500 MB (aman bertahun-tahun). Cron `print-sweep` (*/5 min) dijalankan via crontab VPS owner, bukan `vercel.json`.

---

## Plan 10 — Tambah Item dari Card Monitor ✅ COMPLETE (shipped 2026-08-08)

Spec: `docs/superpowers/specs/2026-08-07-monitor-add-item-design.md`
Plan: `docs/superpowers/plans/2026-08-07-monitor-add-item.md`

- Route `/monitor` — tombol `+ Item` di setiap card meja belum bayar. Modal picker menu + daftar draft multi-item, tap menu bisa langsung naik qty (jika baris tanpa chip) atau bikin baris baru (jika sudah ada chip). Simpan sekali → `POST /api/transactions/[id]/items` (append-only, tidak `PATCH`), server `INSERT` saja sehingga `printed_*_at` item lama utuh & tidak ada read-modify-write race antar device. Auto-dispatch kitchen print hanya untuk item baru (`trigger: 'auto_additional'`).
- Helper murni `lib/transactions.ts::buildAppendItemRows` + test. Shared helpers `lib/menus-server.ts::fetchActiveMenusWithChips` + `lib/print-dispatch.ts::splitItemsByPrintTarget` dipake juga di `/pos`. Modal tidak perlu fetch saat dibuka (menus + printerSettings di-SSR dari `monitor/page.tsx`).
- Error handling: gagal simpan (jaringan/500) → modal tetap terbuka + draft utuh. Sukses tapi agent offline (503) → tutup + toast peringatan. 404/409 → tutup + refresh. `chip_labels` invalid (400) → toast error, modal tetap terbuka.

---

## Plan 11 — Tap-to-Add Seragam di POS, Review, dan Monitor ✅ COMPLETE (shipped 2026-08-08)

Spec: `docs/superpowers/specs/2026-08-07-unified-tap-to-add-design.md`
Plan: `docs/superpowers/plans/2026-08-07-unified-tap-to-add.md`

- **Satu perilaku di tiga halaman**: tap menu = item masuk daftar qty 1, tap lagi = qty naik, tapi baris yg sudah punya chip/catatan tidak ikut naik (tap bikin baris baru). Aturan murni di `lib/cart-draft.ts` (`addOrIncrementDraft`, `needsChipConfig`) + test `lib/cart-draft.test.ts` (10 test).
- **Pengecualian mutex_group**: menu dengan chip bergrup (produksi: cuma Ayam goreng — Dada/Paha) tetap buka `PosItemConfigModal` saat di-tap; batal di modal = tidak ada baris yg ditambah. Tujuannya keseragaman & memastikan pilihan wajib dicatat.
- **Shared modal `components/add-items-modal.tsx`** (baru, diangkat dari `MonitorAddItemModal`): grid menu + draft list + confirm button. Tidak tahu soal menyimpan — parent inject `onConfirm` callback. Dipakai `MonitorAddItemModal` (simpan ke API + cetak) dan `nota-review-form` (simpan ke state lokal). `PosClient` **tidak** pakai modal ini — cuma share `lib/cart-draft.ts` untuk aturan tap yang sama, tap menu langsung update cart tanpa modal.
- **`MonitorAddItemModal` menyusut** ke logika simpan+cetak. Seluruh error handling (400/401/404/409/503), kunci `submitLock`, urutan `saved=true` sebelum `res.json()` **tidak berubah** — termasuk modal tetap terbuka + draft utuh kalau simpan gagal.
- **`/pos` (`PosClient.onMenuTap`)**:  needsChipConfig → buka `PosItemConfigModal` (sekarang). Sebaliknya → `addOrIncrementDraft()` langsung ke cart. ✏️ baris tetap buka `PosItemConfigModal`.
- **Review (`nota-review-form`)**:  "+ Tambah item" → `AddItemsModal`. `onConfirm` map draft → `NotaItem` (qty, notes, applied_chips baru; `id=null` → item baru). ✏️ baris lama tetap lewat `NotaItemModal` (bisa ganti menu + hapus).
- **Cetak tidak berubah**: item baru tetap `auto_additional` (tidak ada modal "Cetak ulang"). `computeReplaceItems`, `detectModalContext`, `dispatchKitchenPrintJob` tetap.

---

## Plan 12 — Nota Customer Otomatis untuk Pesanan Bungkus ✅ COMPLETE (shipped 2026-08-08)

Spec: `docs/superpowers/specs/2026-08-07-takeaway-auto-customer-receipt-design.md`
Plan: `docs/superpowers/plans/2026-08-07-takeaway-auto-customer-receipt.md`

- Nota customer tercetak otomatis saat transaksi bungkus pertama kali menjadi `confirmed` (simpan `/pos` atau review OCR saat `wasConfirmedBefore=false`), barengan tiket dapur. Edit setelah confirmed atau toggle bungkus belakangan tidak memicu cetak ulang — kasir pakai tombol manual di halaman detail.
- `dispatchCustomerReceiptJob` di `lib/print-dispatch.ts` (helper baru, sharing private `buildTicketInput`/`postPrintJob` dengan `dispatchKitchenPrintJob`). Kirim `item_ids: null` sehingga trigger `mark_items_printed_history` tidak menyala — cegah item ditandai tercetak ke dapur kalau nota customer saja yang dikirim.
- Semua jalur nota customer (otomatis + cetak ulang manual) lewat helper bersama. Cetak ulang nota customer kini identik dengan nota otomatis. Bug lama duplikasi chip labels ketika cetak ulang sekarang fixed — dapur dan customer nota keduanya mendapat chip labels lengkap.
- Perilaku "kapan tercetak" (saat `isTakeaway && pertama kali confirmed`) hidup di komponen React, belum ada test otomatis — hanya bisa diverifikasi manual dengan printer sungguhan.

---

## Plan 13 — Bungkus di Monitor + Nota Saat Ditandai Lunas ✅ COMPLETE (shipped 2026-08-08)

Spec: `docs/superpowers/specs/2026-08-08-monitor-takeaway-and-receipt-on-paid-design.md`
Plan: `docs/superpowers/plans/2026-08-08-monitor-takeaway-and-receipt-on-paid.md`

- Pesanan bungkus (takeaway) kini muncul di papan `/monitor` dengan badge BUNGKUS, untuk kasir bisa menandai lunas pesanan bungkus juga.
- Nota customer tidak lagi tercetak otomatis saat simpan. Kini dicetak saat tombol Lunas di kartu monitor dipilih — dua aksi "Lunas saja" dan "Lunas + nota" sama-sama selalu tersedia di semua jenis pesanan, cuma tombol yang disorot yang ikut jenis pesanan (bungkus → "Lunas + nota", dine-in → "Lunas saja").
- Penjaga ketuk ganda via `useRef<Set<string>>` di `components/monitor-board.tsx` cegah dua ketukan cepat menghasilkan dua nota.
- Perilaku dialog & double-tap guard sudah ditutup test komponen di `components/monitor-board.test.tsx`. Verifikasi manual tetap butuh printer sungguhan untuk memastikan kertas yang benar-benar keluar dari printer.

---

## Backlog (belum dijadwalkan)

### 🍽️ POS / Order entry
- [x] **POS direct order + per-menu chips** — shipped 2026-07-08. `/pos` route hybrid layout (menu picker grid + cart), per-menu chips (multi-select + optional `mutex_group` radio behavior + optional `price_delta`), snapshot in `transaction_items.applied_chips` jsonb. Kitchen ticket render chip labels + free-text notes; customer receipt render paid chips only. Menu master extended dengan inline chip editor (label / +Harga / Grup). Spec: `docs/superpowers/specs/2026-07-08-pos-direct-order-with-chips-design.md`. Plan: `docs/superpowers/plans/2026-07-08-pos-direct-order-with-chips.md`.
- [ ] **Mark menu "habis hari ini"** — toggle harian per menu yang reset jam 12 siang (mengikuti business-day cutoff). Kasir tau lele/ayam stok abis tanpa nelpon dapur. Tidak muncul di POS menu picker, di-flag di OCR scan ("⚠️ menu ini sudah ditandai habis hari ini, masih mau tetap simpan?")

### 📊 Reporting / Export
- [ ] **Export CSV closingan** — owner mau audit ke Excel/Google Sheets. Per hari + per bulan. Format kolom: tanggal, total, jumlah tx, top items.
- [ ] **Heatmap hari/jam tersibuk** — bantu owner plan staffing & stocking. Per minggu × per jam, dari `transactions.created_at`.
- [ ] **Comparison trend** — "bulan ini vs bulan lalu", "minggu ini vs minggu lalu" di /reports/monthly.

### 🖨️ Print

- [x] **Auto-print nota dapur + minuman ke LAN thermal printer (ESC/POS)** — done via Android print-agent app. Format receipt-style mirip nota fisik: header (`header_text` setting), Date / Order Number (POS-DDMMYY-seq) / Customer / Meja, list items dengan `qty x unit_price` dan line total right-aligned, Total Item count, Total bold. Lihat `lib/escpos.ts`.
- [x] **Background print bypass OS freeze (Transsion HiOS, MIUI, dst)** — FCM high-priority data message bawa inline payload (job_id, target, bytes_b64), agent process langsung di FCM thread tanpa nunggu coroutine scope. Auth session di-persist via SettingsSessionManager + dedicated SharedPreferences. Detail lengkap di `pak-pon-print-agent/docs/firebase-fcm-plan.md`.
- [ ] **Print struk digital (PDF/WhatsApp)** — generate PDF struk yang bisa dibagi via WhatsApp ke pelanggan. Complementary feature, untuk warung tanpa printer fisik atau request struk by pelanggan.
- [ ] *(opsional)* **Bluetooth thermal printer integration** — kalau ada device tanpa LAN printer. Currently semua print lewat TCP socket ke printer ESC/POS (port 9100) di LAN yang sama dengan kasir.

### 💾 Data retention (Supabase free tier)

**Quota free tier**: 500 MB database + 1 GB storage. Bottleneck = **storage** (foto nota ~300 KB × 24 nota/hari = penuh dalam ~4,5 bulan). Database transaksi sendiri kecil (~2 KB/tx → 28 tahun kapasitas).

**Keputusan**: pakai **Opsi A — hapus foto saja, data transaksi tetap selamanya.**

- [x] **Extend cron `/api/cron/cleanup`** — shipped 2026-07-23 (Plan 9). Pass-3 purge foto nota >7 hari (`storage.remove` + `scan_image_path=NULL` + `scan_image_purged_at=now()`), transaksi row tetap utuh, batch 500, idempoten. Implementasi menambah kolom `scan_image_purged_at` (di luar rencana awal) untuk fix badge POS/OCR yang lama pakai proxy `scan_image_path === null`.
- [x] **UI handle foto hilang** — shipped 2026-07-23 (Plan 9). Note "Foto nota sudah dihapus (retensi 7 hari)" di detail + review saat `scan_image_path` NULL & `scan_image_purged_at` terisi (bedakan dari POS yang dua-duanya NULL).
- [ ] **Backup harian otomatis ke owner** — export CSV/PDF closingan + kirim via email/WA jam 23:59 WIB. Owner punya offline copy + kalau Supabase down.

### 💰 Kas / cash management
- [x] **Monitor meja belum bayar** — shipped 2026-07-21. Lihat Plan 8. Layar operasional `/monitor` mantau meja dine-in confirmed yang belum bayar hari ini (`transactions.paid_at`), tandai lunas manual (dialog konfirmasi, hilang dari monitor), undo di detail. Polling 15s, search client-side. Laporan tidak terpengaruh.
- [ ] **Kas drawer reconciliation** — input modal awal kas, kas keluar (belanja bahan siang hari), kas akhir → reconcile dengan total sistem. Owner sering bingung "kok uang di laci kurang dari catatan?".

### 👥 Customer / pelanggan
- [ ] **Note pelanggan tetap** — `customer_name` yang sering muncul → list pelanggan langganan dengan preferensi ("Pak Budi - pedas extra", "Bu Siti - tanpa kol").
- [ ] **Top regulars** — top-N pelanggan by frequency atau revenue, untuk apresiasi.

### 📈 Bisnis insight (kalau owner serius)
- [ ] **HPP / cost tracking per menu** — masukkan biaya bahan per menu → margin profit per item terlihat. Bantu decide menu mana yang dipromosikan vs dihapus.
- [ ] **Promo / paket kombo** — diskon flat / persen untuk paket (cth: "Pecel Lele + Es Teh hemat Rp 5.000").

### 🔐 Operasional / hygiene
- [ ] **Recovery password owner** — sekarang via Supabase Dashboard saja. Kalau owner lupa & nggak akses dashboard, stuck.
- [ ] **Pin protect untuk delete/edit** — supaya kasir tidak bisa hapus transaksi orang lain tanpa konfirmasi owner (kalau nanti multi-kasir).
- [ ] **PWA service worker** — offline support kalau internet warung putus di tengah shift (nota tetap bisa di-input, sync saat online lagi).

### 🪵 Observability
- [ ] **Remote log sink** — `lib/logger.ts` sudah wide-event tapi cuma console.log. Ke Axiom/Logflare/Datadog supaya bisa debug saat issue di production.

### 🧪 Testing
- [ ] **Component test harness (testing-library + msw) untuk `MonitorAddItemModal.handleConfirm`** — enam perilaku hardened di sana (double-tap lock via `submitLock`, urutan `saved=true` sebelum `res.json()` yang cegah dobel-insert, empat cabang status HTTP 400/401/404/409, pencocokan `sort_order` tanpa fabrikasi UUID, tiga cabang hasil print, dan cabang `catch` berdasar `saved`) sekarang cuma dijaga komentar, tanpa test otomatis. File ini sudah ditulis ulang dua kali. Khususnya urutan `saved = true` sebelum `await res.json()` — kalau ada yang mindahin baris itu di refactor berikutnya, tidak ada test yang bakal gagal.

- [x] **Test: retry setelah gagal tandai lunas** (`components/monitor-board.tsx:102`) — yang belum dijaga bukan guard `inFlight` menyala, tapi guard itu **dilepas**. Di jalur PATCH gagal barisnya balik muncul di papan; kalau id-nya bocor di set, tombol Lunas kartu itu mati permanen sampai halaman di-reload — kasir menekan tombol yang tidak melakukan apa-apa di tengah jam ramai. Test yang ada (`monitor-board.test.tsx`, PATCH gagal) sudah sampai di state itu, tinggal 3 baris: ubah mock jadi sukses, klik Lunas lagi, pastikan PATCH kedua terkirim.
- [x] **Test: simpan pesanan bungkus TIDAK boleh mencetak nota customer** — kelas bug ini sudah dua kali muncul (dipasang di momen salah, lalu dicabut). Sekarang tidak ada yang menjaganya. Bentuk termurah: render `PosClient` dengan satu menu, tambah item, nyalakan bungkus, simpan, pastikan tidak ada panggilan `/api/print/send` dengan `body.target === 'customer'`.
- [x] **Test: cetak ulang tiket dapur harus memuat label chip** — decode `bytes_b64` dan pastikan "Dada" muncul. Mengunci perbaikan 2026-08-08; sebelum itu label bagian ayam hilang saat cetak ulang dan dapur bisa masak bagian yang salah.
- [x] **Test: cabang printer offline / gagal kirim di monitor** (`monitor-board.tsx:144-151`) — `mockFetch` di `monitor-board.test.tsx` sudah punya parameter `printStatus` yang tidak pernah dipakai; 503 → `toast.warning`, 500 → `toast.error`. Sekitar 10 baris.

### 🧹 Rapikan kode (utang dari branch 2026-08-08)
- [x] **Rebuild `idx_transactions_unpaid`** — predicate lamanya membawa `is_takeaway = false`, jadi sejak monitor menampilkan bungkus, Postgres tidak bisa memakainya untuk query monitor sama sekali. Dibangun ulang tanpa klausa itu lewat `supabase/migrations/0038_monitor_unpaid_index_include_takeaway.sql`, **diterapkan ke database 2026-08-08**. Terverifikasi: `EXPLAIN (ANALYZE)` query monitor menunjukkan `Index Scan using idx_transactions_unpaid` (11 baris, 3,8 ms), bukan lagi seq scan.
- [x] **`pos-client.tsx:115` masih memalsukan UUID** (`?? crypto.randomUUID()`) kalau server mengembalikan baris lebih sedikit dari cart. Id palsu tidak match trigger `mark_items_printed_history`, jadi item tercetak di kertas tapi tercatat permanen belum tercetak. Versi monitor sudah dibereskan; yang ini belum. Risiko rendah karena `POST /api/pos` selalu insert semua item.
- [x] **`sumChipPriceDeltas` tidak dipakai di dua tempat** yang menghitung ulang manual (`lib/transactions.ts:159`, `computeReplaceItems:116`). Harus disentuh berdua sekaligus — memperbaiki satu saja malah bikin makin tidak konsisten.
- [x] **Peringatan lint `_localId`** di `components/add-items-modal.tsx` — obatnya `ignoreRestSiblings: true` di konfigurasi ESLint, bukan mengubah bentuk destructuring-nya.
- [x] **Konvensi `^_` "sengaja tidak dipakai"** sekarang dikonfigurasi repo-wide (`argsIgnorePattern`/`varsIgnorePattern: "^_"` di `eslint.config.mjs`, sejalan dengan `ignoreRestSiblings` di atas). Efek sampingnya: ini juga meredam peringatan lint untuk parameter `_request` yang memang tidak dipakai di `app/api/monitor/route.ts` (wajib ada di signature route handler Next) — sengaja, bukan kebetulan.

### 📦 Stock management (lightweight, bukan full inventory)

Goal: owner autopilot, tidak perlu nanya kasir tiap hari "lele sisa berapa". Bukan full inventory system (overkill untuk warung scale).

- [ ] **Stock harian terintegrasi** (kombinasi 3 layer):
  - Pagi: kasir input "datang lele 30 ekor, ayam 15 potong"
  - Sistem otomatis kurangi tiap order yang match menu terkait (need: per-menu stock mapping)
  - Real-time: dashboard tampil "lele sisa 5, ayam 0"
  - Sore: auto-mark "habis" kalau stok ≤ 0, sync ke #mark-menu-habis
  - Estimasi: "rata-rata habis lele jam 21:00 → besok kira-kira perlu 35 ekor"
- [ ] **Belanja prediction** — sistem belajar dari data 30 hari terakhir: "Sabtu rata-rata 35 porsi lele". Jumat sore push WA owner "Besok belanja: lele 40 ekor, ayam 20 potong"

### 🤖 Autopilot — owner minimum touch

Owner tidak mau buka app setiap hari. Sistem proaktif kirim info & alert.

- [ ] **WhatsApp daily digest** — jam 22:00 / setelah closingan, WA owner: "Hari ini Rp 1.245.000 dari 24 nota. Top: Pecel Lele (8), Ayam Goreng (6). Kas drawer cocok." Sekali baca selesai. Implementasi: Vercel cron + WhatsApp Business API atau Twilio/Fonnte/WANotif Indonesia.
- [ ] **Anomaly alerts** — push WA owner sekali kalau terdeteksi:
  - Revenue hari ini < (rata-rata 30 hari × 70%) → "Pemasukan turun 40%, hari sepi atau ada transaksi belum dicatat?"
  - Kas drawer selisih > Rp 20k → "Kas selisih, cek kasir"
  - OCR fail rate > 20% hari ini → "Foto nota banyak gagal, mungkin kamera buram"
  - Menu habis sejak pagi (jam <17:00) → "Lele habis jam 15:00, stok kurang"
- [ ] **Monthly digest auto-generate** — awal bulan, owner dapet "Juni vs Mei: revenue +12%, AOV +4%, top menu shift dari Ayam ke Lele, anomali: 3 hari pemasukan di bawah threshold."
- [ ] **Belanja prediction → WA owner** (link ke stock management section)
- [ ] **Foto nota belanja → auto-categorize expense** — owner foto nota belanja di pasar → OCR Gemini extract → masuk kas keluar dengan kategori (bahan baku / gaji / utilities / lainnya). Mirror flow `/scan` income tapi sebaliknya. Output: monthly P&L auto-generate.

