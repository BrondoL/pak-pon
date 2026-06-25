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
- [x] T4 lib/gemini.ts SDK wrapper with Flash → Pro fallback
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

---

## Backlog (belum dijadwalkan)

### 🍽️ POS / Order entry
- [ ] **POS direct order** — input order langsung dari menu picker, tanpa foto nota. Komplemen dari /scan untuk dine-in cepat atau saat nota fisik habis.
  - **Notes per item** — sudah ada `transaction_items.notes` (text nullable, dipakai OCR untuk "DP", "Dada"). POS pakai field yang sama untuk input bebas: "jangan terlalu garing", "tanpa sambel", "extra pedas"
  - **Quick-pick chips untuk notes** — di modal pick item, kasih chip suggestion umum (Dada, Paha, DP, No sambel, Extra pedas) supaya kasir tap-tap aja tanpa ngetik
  - **Harga tetap (notes = kitchen instruction, BUKAN variant)** — kalau dada vs paha beda harga, daftarin sebagai menu terpisah di master ("Ayam Goreng Dada" Rp 19k, "Ayam Goreng Paha" Rp 22k). Notes cuma instruksi dapur, tidak ubah harga. Konsisten dengan keputusan Q3 spec utama.
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

- [ ] **Extend cron `/api/cron/cleanup`**:
  1. Soft-deleted transaksi >7 hari → hard-delete (sudah ada, jangan diubah)
  2. **Foto nota >7 hari → hapus dari Storage + set `scan_image_path = NULL`** (BARU). Transaksi row tetap, cuma scan_image_path-nya di-null-kan
  3. SQL: `UPDATE transactions SET scan_image_path = NULL WHERE scan_image_path IS NOT NULL AND created_at < now() - interval '7 days'` (lalu batch delete Storage object dari path lama)
- [ ] **UI handle foto hilang**:
  - `/transactions/[id]` detail: kalau `scan_image_path IS NULL`, tampilkan placeholder "Foto sudah dihapus sesuai retensi 7 hari" sebagai ganti thumbnail
  - `/transactions/[id]/review`: route ini cuma buat draft (pending_review status, masih dalam 7 hari), foto pasti masih ada
- [ ] **Backup harian otomatis ke owner** — export CSV/PDF closingan + kirim via email/WA jam 23:59 WIB. Owner punya offline copy + kalau Supabase down.

### 💰 Kas / cash management
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

