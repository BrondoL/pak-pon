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
- Image: client compress dulu (`lib/compress.ts`) sebelum upload — diterapkan di Plan 2.
- Auth: pages dalam `app/(app)/` harus auth; `app/(auth)/` public.
- Soft delete: `transactions` pakai `deleted_at` timestamp (cron cleanup >7 hari). `menus` pakai `is_active=false` (permanent, preserve FK).
- Next.js 16: konsultasi `node_modules/next/dist/docs/01-app/` sebelum menulis route handler / middleware / server actions / dynamic APIs (banyak breaking changes vs versi sebelumnya).

## Print system (Phase 1+2+3 shipped 2026-06-25)

- **Format**: kitchen ticket (dapur/minuman) pakai double-size ESC/POS, no price (`lib/escpos.ts:renderKitchenTicket`). Customer receipt format lengkap + footer (`renderCustomerReceipt`).
- **Dispatch**: `POST /api/print/send` cek `agent_heartbeats.status='online' AND last_seen_at>now()-24h AND fcm_token IS NOT NULL` → fan-out FCM dengan payload inline. **24h threshold** sengaja longgar supaya FCM bypass OEM freeze (HiOS/MIUI dll) — `last_seen_at` cuma tracker heartbeat, bukan liveness.
- **Agent state UI**: 3-state via `/api/agent/heartbeat` — `online` (status=online + heartbeat <1h), `stale` (status=online + heartbeat >=1h, warning kuning), `offline` (status=offline, alarm merah).
- **Audit**: agent insert ke `print_history` saat job done/failed. Trigger `mark_items_printed_history` set `transaction_items.printed_*_at` saat status=done dengan `item_ids` non-null. Customer print skip flag (item_ids null).
- **Delta logic**: edit save tx confirmed → cuma items dengan flag NULL yang di-print (`auto_additional`). Items existing dimodifikasi (qty/menu/notes) → modal pilihan reprint full ke target atau skip.
- **Cleanup**: cron 02:00 WIB hapus `print_history >7 hari`.
