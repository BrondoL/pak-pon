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

## Print system (Phase 1+2+3 shipped 2026-06-25, primary agent + pending state 2026-06-26)

- **Format**: kitchen ticket (dapur/minuman) pakai double-size ESC/POS, no price (`lib/escpos.ts:renderKitchenTicket`). Customer receipt format lengkap + footer (`renderCustomerReceipt`).
- **Dispatch**: `POST /api/print/send` cek `agent_heartbeats.is_primary=true AND status='online' AND last_seen_at>now()-24h AND fcm_token IS NOT NULL` → **INSERT `print_history` (status='pending')** sebagai proof of dispatch → kirim FCM ke 1 primary agent (no fan-out, no race). Agent UPDATE row jadi done/failed saat selesai (bukan INSERT). Primary di-set owner via `/setup/printer/debug` (`PATCH /api/agent/[label]` → RPC `set_primary_agent` atomic swap). Backfill migrasi 0024 pilih agent dengan heartbeat terbaru. **24h threshold** sengaja longgar supaya FCM bypass OEM freeze (HiOS/MIUI dll) — `last_seen_at` cuma tracker heartbeat, bukan liveness. Primary offline → 503 dengan `detail='primary agent offline or not set'`.
- **Polling fallback**: agent app polling tiap 60s (`PendingJobPoller`, primary device only) — fetch `print_history WHERE status='pending' AND created_at > now()-5min`. In-process `JobProcessor.inFlight` set cegah FCM × poll double-process job sama. Manual "Cek pending" button di agent app trigger immediate tick.
- **Stale sweep**: cron `/api/cron/print-sweep` (*/5 min) UPDATE `status='pending' AND created_at < now()-5min` → `status='failed', failure_reason='timeout: agent did not ack'`.
- **Agent state UI**: 3-state via `/api/agent/heartbeat` — `online` (status=online + heartbeat <1h), `stale` (status=online + heartbeat >=1h, warning kuning), `offline` (status=offline, alarm merah). Banner `printer-status-banner.tsx` fokus ke status primary, bukan agent generik. DELETE primary diblok 409 kalau masih ada agent lain (owner harus pindahin dulu).
- **Audit**: web INSERT `print_history` status=pending saat dispatch; agent UPDATE jadi done/failed via `markDone`/`markFailed` (claim filter `.eq("status","pending")` = no-op kalau sudah ke-update worker lain). Trigger `mark_items_printed_history` fire di transisi pending→done (`AFTER UPDATE OF status`), set `transaction_items.printed_*_at` kalau `item_ids` non-null. Customer print skip flag (item_ids null).
- **Delta logic**: edit save tx confirmed → cuma items dengan flag NULL yang di-print (`auto_additional`). Items existing dimodifikasi (qty/menu/notes) → modal pilihan reprint full ke target atau skip.
- **Cleanup**: cron 02:00 WIB hapus `print_history >7 hari`.
