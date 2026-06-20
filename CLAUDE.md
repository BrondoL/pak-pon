# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project context

Pecel Lele Pak Pon — internal POS/reporting web app untuk warung pecel lele. Bukan public-facing. Dipakai kasir (foto nota → OCR Gemini → review → simpan) & owner (reporting harian/bulanan, menu master). 1 akun share, Supabase Auth.

See:
- `docs/brief.md` — product brief & user stories
- `docs/spec.md` — pointer ke spec lengkap
- `docs/tasks.md` — progress tracker
- `docs/superpowers/specs/2026-06-20-pak-pon-design.md` — design spec lengkap (sumber kebenaran)

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
- Schema source of truth: `supabase/migrations/*.sql`.
- Image: client compress dulu (`lib/compress.ts`) sebelum upload — diterapkan di Plan 2.
- Auth: pages dalam `app/(app)/` harus auth; `app/(auth)/` public.
- Soft delete: `transactions` pakai `deleted_at` timestamp (cron cleanup >7 hari). `menus` pakai `is_active=false` (permanent, preserve FK).
- Next.js 16: konsultasi `node_modules/next/dist/docs/01-app/` sebelum menulis route handler / middleware / server actions / dynamic APIs (banyak breaking changes vs versi sebelumnya).
