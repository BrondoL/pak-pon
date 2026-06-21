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
- [ ] **Mark menu "habis hari ini"** — toggle harian per menu yang reset tengah malam (atau di awal shift). Kasir tau lele/ayam stok abis tanpa nelpon dapur. Tidak muncul di menu picker / di-flag di OCR.

### 📊 Reporting / Export
- [ ] **Export CSV closingan** — owner mau audit ke Excel/Google Sheets. Per hari + per bulan. Format kolom: tanggal, total, jumlah tx, top items.
- [ ] **Heatmap hari/jam tersibuk** — bantu owner plan staffing & stocking. Per minggu × per jam, dari `transactions.created_at`.
- [ ] **Comparison trend** — "bulan ini vs bulan lalu", "minggu ini vs minggu lalu" di /reports/monthly.

### 🖨️ Print
- [ ] **Print struk digital** — generate PDF struk yang bisa dibagi via WhatsApp ke pelanggan. Tidak perlu printer fisik kalau owner tidak punya.
- [ ] *(opsional)* **Bluetooth thermal printer integration** — kalau owner invest printer 80mm.

### 💾 Data retention (klarifikasi #4)
**Mispersepsi:** cron jam 02:00 WIB *tidak* menghapus semua data >7 hari. Hanya menghapus transaksi yang sudah di-**soft-delete** (`deleted_at IS NOT NULL`) lebih dari 7 hari + foto nota terkait. Transaksi normal **tetap selamanya** — data bulanan & historis aman.

Concern valid yang related:
- [ ] **Storage retention policy untuk foto nota** — kalau ratusan nota per bulan, Supabase Storage cost akan naik. Pilihan kebijakan: hapus foto nota >X bulan (data transaksi tetap, foto-nya saja yang dihapus), atau archive ke cold storage.
- [ ] **Backup harian otomatis ke owner** — export CSV/PDF closingan + kirim via email/WA jam 23:59 WIB. Owner punya offline copy kalau-kalau project down.

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

