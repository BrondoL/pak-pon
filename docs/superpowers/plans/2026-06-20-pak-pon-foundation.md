# Pak Pon — Plan 1: Foundation, Auth, Menu Master

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working app dimana owner bisa login, melihat home dashboard, dan CRUD menu master di Supabase Postgres. Foundation untuk Plan 2 (scan + OCR) dan Plan 3 (history + reports).

**Architecture:** Next.js 16 App Router (sudah scaffold) + Supabase (Postgres + Auth + Storage) + Tailwind v4. Migrations di `supabase/migrations/`. Auth via `@supabase/ssr` cookies + Next.js middleware. Money disimpan sebagai bigint rupiah.

**Tech Stack:** Next.js 16.2 · React 19.2 · TypeScript 5 strict · Tailwind v4 · `@supabase/supabase-js` + `@supabase/ssr` · `zod` (validation) · `vitest` + `jsdom` (tests).

**Source spec:** `docs/superpowers/specs/2026-06-20-pak-pon-design.md`

---

## File map

```
pak-pon/
├── .env.example                     # (T1) template env vars
├── .env.local                       # (T1) local dev env (gitignored)
├── vitest.config.ts                 # (T1) test runner config
├── CLAUDE.md                        # (T1) replace with proper version
├── docs/
│   ├── brief.md                     # (T1) product brief
│   ├── spec.md                      # (T1) tech spec pointer
│   └── tasks.md                     # (T1) progress tracker
├── vercel.ts                        # (T9) vercel config
├── supabase/migrations/
│   ├── 0001_schema.sql              # (T2) tables + RLS + storage bucket
│   └── 0002_seed_menus.sql          # (T2) menu seed data
├── lib/
│   ├── currency.ts                  # (T3) formatRp() helper
│   ├── currency.test.ts             # (T3) currency unit tests
│   └── supabase/
│       ├── server.ts                # (T4) createServerClient(cookies())
│       ├── client.ts                # (T4) createBrowserClient()
│       └── admin.ts                 # (T4) service-role client
├── middleware.ts                    # (T5) auth gate
├── app/
│   ├── (auth)/login/page.tsx        # (T5) login form
│   ├── (app)/
│   │   ├── layout.tsx               # (T6) auth-gated layout + nav
│   │   ├── page.tsx                 # (T6) home / dashboard
│   │   └── menu/
│   │       └── page.tsx             # (T8) menu master UI
│   ├── api/
│   │   ├── menus/
│   │   │   ├── route.ts             # (T7) GET list, POST create
│   │   │   ├── route.test.ts        # (T7) API tests
│   │   │   └── [id]/route.ts        # (T7) PATCH, DELETE
│   │   └── auth/signout/route.ts    # (T6) POST signout
│   └── layout.tsx                   # (existing) root layout, minor tweak
└── components/
    ├── nav.tsx                      # (T6) top nav
    ├── ui/
    │   ├── button.tsx               # (T6) Button primitive
    │   ├── input.tsx                # (T6) Input primitive
    │   └── label.tsx                # (T6) Label primitive
    ├── home-tiles.tsx               # (T6) 4 home tiles
    └── menu-form.tsx                # (T8) add/edit menu modal/form
```

**One-file responsibility principle:** UI primitives di `components/ui/` dipakai berkali-kali. Page components di `app/` minim logic — delegasi ke `lib/` (data ops) + `components/` (UI).

---

## Task 1: Project bootstrap — git, deps, env, config, docs

**Files:**
- Create: `.gitignore` (sudah ada, append items kalau perlu — sudah dilakukan saat brainstorming)
- Create: `.env.example`
- Create: `.env.local`
- Create: `vitest.config.ts`
- Create: `docs/brief.md`
- Create: `docs/spec.md`
- Create: `docs/tasks.md`
- Modify: `CLAUDE.md` (replace `@AGENTS.md` redirect dengan project info)
- Modify: `package.json` (deps + scripts)

- [ ] **Step 1.1: Init git repo & first commit (scaffold state)**

Run di working directory `/home/brondol/Downloads/pak-pon`:

```bash
git init
git add -A
git commit -m "chore: initial scaffold from create-next-app (Next.js 16.2)"
```

Verify: `git log --oneline` → 1 commit muncul.

- [ ] **Step 1.2: Install runtime + dev dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr zod
npm install -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Verify `package.json` `dependencies` mengandung `@supabase/supabase-js`, `@supabase/ssr`, `zod`. `devDependencies` mengandung `vitest`, `jsdom`, `@testing-library/react`.

- [ ] **Step 1.3: Add test scripts to `package.json`**

Modify `package.json` `scripts` block:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 1.4: Create `vitest.config.ts`**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
```

Create `vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 1.5: Create `.env.example` (committed) + `.env.local` (gitignored)**

Create `.env.example`:

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=

# Gemini (digunakan di Plan 2)
GEMINI_API_KEY=

# Cron (digunakan di Plan 3)
CRON_SECRET=
```

Create `.env.local` (kosong dulu — diisi di Task 2 setelah Supabase project dibuat):

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
GEMINI_API_KEY=
CRON_SECRET=
```

Verify `.env.local` tidak ter-stage: `git status --short` tidak menampilkannya.

- [ ] **Step 1.6: Replace `CLAUDE.md`**

Replace seluruh isi `CLAUDE.md`:

```markdown
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
```

- [ ] **Step 1.7: Create `docs/brief.md`**

Create `docs/brief.md`:

```markdown
# Pak Pon — Product Brief

## What

Internal web app untuk warung **Pecel Lele Pak Pon** (Bandar Lampung). Bukan public-facing. Dipakai kasir untuk input nota harian via foto → OCR → review → simpan; owner untuk reporting harian (closingan) dan bulanan (pemasukan + menu terlaris).

## Users

**1 akun share** — owner, kasir, siapapun login dengan kredensial yang sama. Akun dibuat 1x via Supabase Dashboard. No signup public.

## Devices

Tablet primer (di meja kasir), responsive ke HP.

## Core flow

1. Kasir foto nota di tablet → upload → Gemini OCR ekstrak item & total handwritten
2. Kasir review hasil OCR di list editable (edit/tambah/hapus item) → konfirmasi
3. Owner lihat report harian (angka pemasukan untuk samakan dengan uang fisik) & bulanan (chart + top menu)
4. Owner kelola menu master (CRUD, soft-deactivate)
5. History transaksi: list, edit, soft-delete; cron cleanup hard-delete >7 hari

## Business rules

- Cut-off harian: midnight-to-midnight (00:00–23:59 WIB)
- Harga: snapshot saat transaksi (transaksi historis aman dari perubahan menu master)
- Pembayaran: TIDAK di-track (mirror nota fisik, hindari input manual)
- Soft delete transaksi 7 hari, lalu cron hapus permanen termasuk foto nota
- Menu yang sudah dipakai transaksi: `is_active=false` (tidak ada hard delete)

## Out of scope (MVP)

Payment method tracking, tax/service charge/discount, menu variants berharga beda, multi-user role, signup public, print struk, inventory, push notifications, export CSV. Lihat spec §15.
```

- [ ] **Step 1.8: Create `docs/spec.md` (pointer)**

Create `docs/spec.md`:

```markdown
# Pak Pon — Tech Spec

Spec lengkap & sumber kebenaran: **`docs/superpowers/specs/2026-06-20-pak-pon-design.md`**

Tech stack:
- Next.js 16.2 (App Router) + React 19.2 + TypeScript 5 strict
- Supabase (Postgres + Auth email/password + Storage private bucket `notas`)
- Gemini `gemini-3.5-flash` (fallback `gemini-3.1-pro-preview`) untuk OCR
- Vercel deploy (region `sin1` Singapore) + Vercel Cron

Schema, API contract, OCR prompt, env vars, deployment notes → lihat spec lengkap.
```

- [ ] **Step 1.9: Create `docs/tasks.md`**

Create `docs/tasks.md`:

```markdown
# Pak Pon — Implementation Progress

## Plan 1 — Foundation, Auth, Menu Master
- [ ] T1 Project bootstrap
- [ ] T2 Supabase project + migrations
- [ ] T3 Currency util + tests
- [ ] T4 Supabase clients
- [ ] T5 Auth: middleware + login
- [ ] T6 (app) layout + Home
- [ ] T7 Menu API routes
- [ ] T8 Menu master UI
- [ ] T9 vercel.ts + deploy verify

## Plan 2 — Scan + OCR + Review + Save
TBD setelah Plan 1 selesai

## Plan 3 — History + Reports + Cron
TBD setelah Plan 2 selesai
```

- [ ] **Step 1.10: Verify build still passes & commit**

```bash
npm run build
```

Expected: berhasil tanpa error (cuma scaffold + ditambahkan config files; belum ada kode baru).

```bash
git add -A
git commit -m "chore: bootstrap deps, env template, vitest config, docs scaffolding"
```

Verify: `git log --oneline` → 2 commits.

---

## Task 2: Supabase project + migrations

**Files:**
- Create: `supabase/migrations/0001_schema.sql`
- Create: `supabase/migrations/0002_seed_menus.sql`

**External setup (manual via Supabase Dashboard atau MCP tool):**
- Buat Supabase project baru (region: Singapore)
- Run kedua migration ke project tersebut
- Buat 1 user via Auth → Add User
- Copy `URL`, `Publishable Key`, `Secret Key` ke `.env.local`

- [ ] **Step 2.1: Create `supabase/migrations/0001_schema.sql`**

```sql
-- 0001_schema.sql — tables, RLS, storage bucket, trigger

-- 1. Tables
CREATE TABLE menus (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  category    text NOT NULL CHECK (category IN ('makanan', 'nasi', 'minuman')),
  price       bigint NOT NULL CHECK (price >= 0),
  sort_order  int NOT NULL DEFAULT 0,
  is_active   bool NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_image_path     text,
  handwritten_total   bigint,
  status              text NOT NULL CHECK (status IN ('pending_review', 'confirmed')),
  customer_name       text,
  table_no            text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  confirmed_at        timestamptz,
  deleted_at          timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transaction_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id          uuid NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  menu_id                 uuid REFERENCES menus(id) ON DELETE SET NULL,
  menu_name_snapshot      text NOT NULL,
  unit_price_snapshot     bigint NOT NULL CHECK (unit_price_snapshot >= 0),
  qty                     int NOT NULL CHECK (qty > 0),
  notes                   text,
  sort_order              int NOT NULL DEFAULT 0
);

-- 2. Indexes
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX idx_transactions_deleted_at ON transactions(deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transaction_items_menu_id ON transaction_items(menu_id);

-- 3. updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_menus_updated BEFORE UPDATE ON menus
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_transactions_updated BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. RLS — authenticated boleh ALL, anon DENY
ALTER TABLE menus ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_all_menus ON menus
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all_transactions ON transactions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_all_transaction_items ON transaction_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('notas', 'notas', false)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY auth_all_storage_notas ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'notas') WITH CHECK (bucket_id = 'notas');
```

- [ ] **Step 2.2: Create `supabase/migrations/0002_seed_menus.sql`**

```sql
-- 0002_seed_menus.sql — menu master dari nota tercetak Pak Pon

INSERT INTO menus (name, category, price, sort_order) VALUES
  -- Makanan
  ('Pecel Lele',              'makanan', 16000, 1),
  ('Ayam goreng',             'makanan', 19000, 2),
  ('Ayam bakar',              'makanan', 19000, 3),
  ('Ayam Kampung goreng',     'makanan', 30000, 4),
  ('Ayam Kampung bakar',      'makanan', 30000, 5),
  ('Bebek goreng',            'makanan', 38000, 6),
  ('Bebek bakar',             'makanan', 38000, 7),
  ('Sop Ayam',                'makanan', 30000, 8),
  ('Sop Sapi',                'makanan', 35000, 9),
  ('Burung Dara goreng',      'makanan', 38000, 10),
  ('Burung Dara bakar',       'makanan', 38000, 11),
  ('Nila goreng',             'makanan', 38000, 12),
  ('Nila bakar',              'makanan', 38000, 13),

  -- Nasi & side
  ('Nasi',                    'nasi',     7000, 1),
  ('Tahu Tempe',              'nasi',     8000, 2),
  ('Pete Goreng',             'nasi',    10000, 3),
  ('Terong',                  'nasi',     7000, 4),
  ('Kol Goreng',              'nasi',     5000, 5),
  ('Sambel Tambahan',         'nasi',     3000, 6),

  -- Minuman
  ('Es Teh',                  'minuman',  6000, 1),
  ('Teh Panas',               'minuman',  5000, 2),
  ('Teh Panas Tawar',         'minuman',  2000, 3),
  ('Es Teh Tawar',            'minuman',  3000, 4),
  ('Es Jeruk',                'minuman', 10000, 5),
  ('Jeruk Panas',             'minuman',  8000, 6),
  ('Es Tawar',                'minuman',  3000, 7),
  ('Es Batu',                 'minuman',  5000, 8),
  ('Mineral Botol',           'minuman',  5000, 9),
  ('Teh Botol Sosro',         'minuman',  7000, 10);
```

- [ ] **Step 2.3: Apply ke Supabase project (manual)**

Pilihan jalur sesuai konteks executor:

**Opsi A — pakai Supabase MCP tool** (recommended kalau ada akses MCP):
1. List organizations: `mcp__plugin_supabase_supabase__list_organizations`
2. Create project: `mcp__plugin_supabase_supabase__create_project` dengan `name="pak-pon"`, `region="ap-southeast-1"` (Singapore)
3. Apply migration 0001: `mcp__plugin_supabase_supabase__apply_migration` dengan name=`0001_schema`, query=isi file 0001
4. Apply migration 0002: `mcp__plugin_supabase_supabase__apply_migration` dengan name=`0002_seed_menus`, query=isi file 0002
5. Get URL: `mcp__plugin_supabase_supabase__get_project_url`
6. Get publishable key: `mcp__plugin_supabase_supabase__get_publishable_keys`
7. Verify: `mcp__plugin_supabase_supabase__list_tables` → harus muncul `menus`, `transactions`, `transaction_items`
8. Verify seed: `mcp__plugin_supabase_supabase__execute_sql` dengan `SELECT count(*) FROM menus;` → harus return 29

**Opsi B — pakai Supabase CLI lokal** (kalau user prefer):
1. `npx supabase login`
2. `npx supabase init` (kalau belum)
3. `npx supabase link --project-ref <project-ref>`
4. `npx supabase db push`

- [ ] **Step 2.4: Buat user via Supabase Dashboard**

Manual step (instruksi user):
- Buka Supabase Dashboard → Auth → Users → Add User
- Pilih "Create new user", isi email + password (catat di password manager)
- Centang "Auto Confirm User" supaya tidak perlu verifikasi email

- [ ] **Step 2.5: Isi `.env.local`**

Copy nilai dari Supabase Dashboard → Settings → API ke `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
SUPABASE_SECRET_KEY=<secret-key>
GEMINI_API_KEY=
CRON_SECRET=
```

Catatan: `SUPABASE_SECRET_KEY` (service_role) sangat sensitive — JANGAN commit, JANGAN expose ke client.

- [ ] **Step 2.6: Commit migration files**

```bash
git add supabase/migrations/
git commit -m "feat(db): initial schema (menus, transactions, items) + seed menus"
```

---

## Task 3: Currency utility — TDD

**Files:**
- Create: `lib/currency.ts`
- Create: `lib/currency.test.ts`

- [ ] **Step 3.1: Write failing tests**

Create `lib/currency.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatRp, parseRp } from './currency';

describe('formatRp', () => {
  it('formats zero', () => {
    expect(formatRp(0)).toBe('Rp 0');
  });
  it('formats small amount', () => {
    expect(formatRp(7000)).toBe('Rp 7.000');
  });
  it('formats six-digit amount', () => {
    expect(formatRp(222000)).toBe('Rp 222.000');
  });
  it('formats seven-digit amount', () => {
    expect(formatRp(1245000)).toBe('Rp 1.245.000');
  });
  it('handles negative (for adjustments/refunds future)', () => {
    expect(formatRp(-5000)).toBe('-Rp 5.000');
  });
});

describe('parseRp', () => {
  it('parses "Rp 7.000" → 7000', () => {
    expect(parseRp('Rp 7.000')).toBe(7000);
  });
  it('parses "Rp 1.245.000" → 1245000', () => {
    expect(parseRp('Rp 1.245.000')).toBe(1245000);
  });
  it('parses "7000" (no prefix/separator) → 7000', () => {
    expect(parseRp('7000')).toBe(7000);
  });
  it('returns NaN for invalid', () => {
    expect(parseRp('abc')).toBeNaN();
  });
});
```

- [ ] **Step 3.2: Run test — verify it fails**

```bash
npm run test -- lib/currency.test.ts
```

Expected: FAIL dengan "Cannot find module './currency'".

- [ ] **Step 3.3: Implement `lib/currency.ts`**

Create `lib/currency.ts`:

```ts
export function formatRp(amount: number): string {
  if (Number.isNaN(amount)) return 'Rp –';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(amount));
  const withSeparator = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}Rp ${withSeparator}`;
}

export function parseRp(input: string): number {
  const cleaned = input.replace(/Rp\s?/, '').replace(/\./g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
```

- [ ] **Step 3.4: Run test — verify it passes**

```bash
npm run test -- lib/currency.test.ts
```

Expected: PASS semua (9 tests).

- [ ] **Step 3.5: Commit**

```bash
git add lib/currency.ts lib/currency.test.ts
git commit -m "feat(lib): formatRp & parseRp helpers with tests"
```

---

## Task 4: Supabase clients

**Files:**
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/admin.ts`

> **Catatan**: factory functions yang wrapping `@supabase/ssr` susah di-unit-test secara meaningful (cuma return client instance). Verifikasi via penggunaan di Task 5+ via dev server. Skip explicit tests untuk task ini.

- [ ] **Step 4.1: Implement `lib/supabase/server.ts`**

Create `lib/supabase/server.ts`:

```ts
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function getSupabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // ignore — Server Component context (read-only cookies). Middleware will refresh session.
          }
        },
      },
    }
  );
}
```

> Catatan: Next.js 16 `cookies()` is async. Konfirmasi via `node_modules/next/dist/docs/01-app/01-getting-started/15-fetching-data.mdx` atau `01-app/02-api-reference/04-functions/cookies.mdx` kalau ragu.

- [ ] **Step 4.2: Implement `lib/supabase/client.ts`**

Create `lib/supabase/client.ts`:

```ts
'use client';

import { createBrowserClient } from '@supabase/ssr';

export function getSupabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
```

- [ ] **Step 4.3: Implement `lib/supabase/admin.ts`**

Create `lib/supabase/admin.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client untuk operasi yang bypass RLS (mis. cron cleanup di Plan 3).
 * HANYA dipakai di server-side route handlers yang diauthorisasi (mis. cron secret).
 */
export function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}
```

- [ ] **Step 4.4: Verify type-check passes**

```bash
npx tsc --noEmit
```

Expected: tidak ada error type. (Kalau ada error tentang `cookies()` API yang berubah di Next.js 16, baca `node_modules/next/dist/docs/01-app/02-api-reference/04-functions/cookies.mdx` dan sesuaikan.)

- [ ] **Step 4.5: Commit**

```bash
git add lib/supabase/
git commit -m "feat(lib): Supabase server/client/admin factory functions"
```

---

## Task 5: Auth — middleware + login page

**Files:**
- Create: `middleware.ts`
- Create: `app/(auth)/login/page.tsx`
- Create: `app/(auth)/login/actions.ts` (server action)

- [ ] **Step 5.1: Implement `middleware.ts`**

Create `middleware.ts` di repo root (bukan di `app/`):

```ts
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const isPublic = pathname === '/login' || pathname.startsWith('/_next') || pathname.startsWith('/api/auth');

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

> **Next.js 16 note**: Konfirmasi syntax middleware di `node_modules/next/dist/docs/01-app/02-api-reference/05-file-conventions/middleware.mdx`. Sesuai deprecation notice, middleware sekarang Node.js full (bukan edge-only).

- [ ] **Step 5.2: Implement `app/(auth)/login/actions.ts` (server action)**

Create `app/(auth)/login/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: 'Email atau password tidak valid.' };
  }
  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: 'Login gagal: ' + error.message };
  }
  redirect('/');
}
```

- [ ] **Step 5.3: Implement `app/(auth)/login/page.tsx`**

Create `app/(auth)/login/page.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from './actions';

const initialState: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <form
        action={formAction}
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h1 className="text-xl font-semibold tracking-tight">Pecel Lele Pak Pon</h1>
        <p className="mt-1 text-sm text-zinc-500">Masuk untuk lanjut.</p>

        <label className="mt-6 block text-sm font-medium">Email</label>
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
        />

        <label className="mt-4 block text-sm font-medium">Password</label>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          minLength={6}
          className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800"
        />

        {state.error && (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? 'Masuk…' : 'Masuk'}
        </button>
      </form>
    </main>
  );
}
```

> Konfirmasi `useActionState` (React 19 / Next 16) di `node_modules/next/dist/docs/01-app/01-getting-started/13-updating-data.mdx`.

- [ ] **Step 5.4: Manual verify**

```bash
npm run dev
```

Buka http://localhost:3000:
- Tidak login → redirect ke `/login` ✓
- Login dengan kredensial Task 2.4 → redirect ke `/` (akan 404 sampai T6 dibuat) ✓
- Salah password → muncul error message ✓

Stop dev server (Ctrl+C).

- [ ] **Step 5.5: Commit**

```bash
git add middleware.ts "app/(auth)/"
git commit -m "feat(auth): login page + middleware auth gate"
```

---

## Task 6: (app) layout, Home, signout, UI primitives

**Files:**
- Create: `components/ui/button.tsx`
- Create: `components/nav.tsx`
- Create: `components/home-tiles.tsx`
- Create: `app/(app)/layout.tsx`
- Create: `app/(app)/page.tsx`
- Create: `app/api/auth/signout/route.ts`

- [ ] **Step 6.1: Create `components/ui/button.tsx`**

```tsx
import * as React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const styles: Record<Variant, string> = {
  primary:
    'bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300',
  secondary:
    'bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700',
  ghost:
    'bg-transparent text-zinc-900 hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800',
  danger:
    'bg-red-600 text-white hover:bg-red-500',
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className = '', ...rest }, ref) => (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition disabled:opacity-60 disabled:pointer-events-none ${styles[variant]} ${className}`}
      {...rest}
    />
  )
);
Button.displayName = 'Button';
```

- [ ] **Step 6.2: Create `app/api/auth/signout/route.ts`**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
}
```

> Pakai `request.url` sebagai base supaya redirect ke origin yang sama (localhost saat dev, domain Vercel saat prod). Jangan pakai `process.env.NEXT_PUBLIC_SUPABASE_URL` — itu domain Supabase, bukan app.

- [ ] **Step 6.3: Create `components/nav.tsx`**

```tsx
import Link from 'next/link';

export function Nav() {
  return (
    <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-base font-semibold tracking-tight">
          🍗 Pak Pon
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/scan" className="rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">Scan</Link>
          <Link href="/transactions" className="rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">History</Link>
          <Link href="/reports" className="rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">Reports</Link>
          <Link href="/menu" className="rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">Menu</Link>
          <form action="/api/auth/signout" method="post" className="ml-2">
            <button
              type="submit"
              className="rounded px-3 py-1.5 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              Keluar
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 6.4: Create `components/home-tiles.tsx`**

```tsx
import Link from 'next/link';

const tiles = [
  { href: '/scan',         emoji: '📷', title: 'Scan Nota',   subtitle: 'Foto nota baru' },
  { href: '/transactions', emoji: '📋', title: 'History',     subtitle: 'Transaksi tersimpan' },
  { href: '/reports',      emoji: '📊', title: 'Reports',     subtitle: 'Harian & bulanan' },
  { href: '/menu',         emoji: '🍽️', title: 'Menu Master', subtitle: 'Atur menu & harga' },
];

export function HomeTiles() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      {tiles.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className="rounded-2xl border border-zinc-200 bg-white p-6 text-center transition hover:border-zinc-400 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-600"
        >
          <div className="text-3xl">{t.emoji}</div>
          <div className="mt-2 font-semibold">{t.title}</div>
          <div className="mt-1 text-xs text-zinc-500">{t.subtitle}</div>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 6.5: Create `app/(app)/layout.tsx`**

```tsx
import { redirect } from 'next/navigation';
import { Nav } from '@/components/nav';
import { getSupabaseServer } from '@/lib/supabase/server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <Nav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
```

> Defensive: middleware sudah jaga, layout cek lagi sebagai defense-in-depth.

- [ ] **Step 6.6: Create `app/(app)/page.tsx`**

```tsx
import { HomeTiles } from '@/components/home-tiles';

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Selamat datang</h1>
        <p className="mt-1 text-sm text-zinc-500">Pilih menu di bawah untuk mulai.</p>
      </div>
      <HomeTiles />
    </div>
  );
}
```

- [ ] **Step 6.7: Manual verify**

```bash
npm run dev
```

- Buka http://localhost:3000 → login → muncul Home dengan 4 tile
- Klik link nav (Scan/History/Reports/Menu) → akan 404 sampai page-nya dibuat
- Klik "Keluar" → redirect ke /login

Stop dev server.

- [ ] **Step 6.8: Commit**

```bash
git add components/ "app/(app)/" app/api/
git commit -m "feat(app): home dashboard, nav, signout, button primitive"
```

---

## Task 7: Menu API routes — TDD

**Files:**
- Create: `app/api/menus/route.ts`
- Create: `app/api/menus/[id]/route.ts`
- Create: `app/api/menus/_schemas.ts` (Zod schemas reused antar route)
- Create: `app/api/menus/_schemas.test.ts`

- [ ] **Step 7.1: Write failing tests untuk Zod schemas**

Create `app/api/menus/_schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CreateMenuSchema, UpdateMenuSchema } from './_schemas';

describe('CreateMenuSchema', () => {
  it('accepts valid payload', () => {
    const result = CreateMenuSchema.safeParse({
      name: 'Pecel Lele',
      category: 'makanan',
      price: 16000,
    });
    expect(result.success).toBe(true);
  });
  it('defaults sort_order to 0', () => {
    const result = CreateMenuSchema.parse({
      name: 'X',
      category: 'makanan',
      price: 1000,
    });
    expect(result.sort_order).toBe(0);
  });
  it('rejects invalid category', () => {
    const result = CreateMenuSchema.safeParse({
      name: 'X',
      category: 'dessert',
      price: 1000,
    });
    expect(result.success).toBe(false);
  });
  it('rejects negative price', () => {
    const result = CreateMenuSchema.safeParse({
      name: 'X',
      category: 'makanan',
      price: -1,
    });
    expect(result.success).toBe(false);
  });
  it('rejects empty name', () => {
    const result = CreateMenuSchema.safeParse({
      name: '',
      category: 'makanan',
      price: 100,
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateMenuSchema', () => {
  it('accepts partial update', () => {
    const result = UpdateMenuSchema.safeParse({ price: 20000 });
    expect(result.success).toBe(true);
  });
  it('accepts is_active toggle', () => {
    const result = UpdateMenuSchema.safeParse({ is_active: false });
    expect(result.success).toBe(true);
  });
  it('rejects unknown field', () => {
    const result = UpdateMenuSchema.safeParse({ foo: 'bar' });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 7.2: Run tests — verify fail**

```bash
npm run test -- app/api/menus/_schemas.test.ts
```

Expected: FAIL "Cannot find module './_schemas'".

- [ ] **Step 7.3: Implement `app/api/menus/_schemas.ts`**

```ts
import { z } from 'zod';

export const CategorySchema = z.enum(['makanan', 'nasi', 'minuman']);

export const CreateMenuSchema = z.object({
  name: z.string().min(1).max(80),
  category: CategorySchema,
  price: z.number().int().nonnegative(),
  sort_order: z.number().int().default(0),
});

export const UpdateMenuSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  category: CategorySchema.optional(),
  price: z.number().int().nonnegative().optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
}).strict();

export type CreateMenu = z.infer<typeof CreateMenuSchema>;
export type UpdateMenu = z.infer<typeof UpdateMenuSchema>;
```

- [ ] **Step 7.4: Run tests — verify pass**

```bash
npm run test -- app/api/menus/_schemas.test.ts
```

Expected: PASS semua.

- [ ] **Step 7.5: Implement `app/api/menus/route.ts` (GET list, POST create)**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { CreateMenuSchema } from './_schemas';

export async function GET(request: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const includeInactive = request.nextUrl.searchParams.get('include_inactive') === '1';

  let query = supabase
    .from('menus')
    .select('id, name, category, price, sort_order, is_active, created_at, updated_at')
    .order('category')
    .order('sort_order')
    .order('name');

  if (!includeInactive) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(request: NextRequest) {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json();
  const parsed = CreateMenuSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('menus')
    .insert(parsed.data)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ menu: data }, { status: 201 });
}
```

- [ ] **Step 7.6: Implement `app/api/menus/[id]/route.ts` (PATCH, DELETE)**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { UpdateMenuSchema } from '../_schemas';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json();
  const parsed = UpdateMenuSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', details: parsed.error.flatten() }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('menus')
    .update(parsed.data)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ menu: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { error } = await supabase
    .from('menus')
    .update({ is_active: false })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

> **Next.js 16 note**: `params` adalah `Promise` di route handler dynamic. Konfirmasi di `node_modules/next/dist/docs/01-app/02-api-reference/05-file-conventions/route.mdx`.

- [ ] **Step 7.7: Manual verify dengan curl atau Postman**

Pastikan sudah login dulu lewat browser (supaya ada cookie). Lalu jalanin dev server & test via browser DevTools console:

```js
// di browser console, setelah login
await fetch('/api/menus').then(r => r.json());
// → { items: [...29 menu] }

await fetch('/api/menus', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Tes Menu', category: 'makanan', price: 5000 })
}).then(r => r.json());
// → { menu: { id, name: 'Tes Menu', ... } }
```

- [ ] **Step 7.8: Commit**

```bash
git add app/api/menus/
git commit -m "feat(api): menus CRUD endpoints with Zod validation"
```

---

## Task 8: Menu master UI

**Files:**
- Create: `app/(app)/menu/page.tsx`
- Create: `app/(app)/menu/menu-list-client.tsx` (client component)
- Create: `components/menu-form.tsx`
- Create: `components/ui/input.tsx`
- Create: `components/ui/label.tsx`

- [ ] **Step 8.1: Create `components/ui/input.tsx`**

```tsx
import * as React from 'react';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', ...rest }, ref) => (
    <input
      ref={ref}
      className={`w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 ${className}`}
      {...rest}
    />
  )
);
Input.displayName = 'Input';
```

- [ ] **Step 8.2: Create `components/ui/label.tsx`**

```tsx
import * as React from 'react';

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className = '', ...rest }: LabelProps) {
  return (
    <label
      className={`block text-sm font-medium text-zinc-700 dark:text-zinc-300 ${className}`}
      {...rest}
    />
  );
}
```

- [ ] **Step 8.3: Create `components/menu-form.tsx` (client)**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type MenuFormValues = {
  id?: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
  sort_order: number;
  is_active?: boolean;
};

export function MenuForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Partial<MenuFormValues>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState<MenuFormValues['category']>(initial?.category ?? 'makanan');
  const [price, setPrice] = useState<number>(initial?.price ?? 0);
  const [sortOrder, setSortOrder] = useState<number>(initial?.sort_order ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const payload = { name, category, price, sort_order: sortOrder };
      const res = initial?.id
        ? await fetch(`/api/menus/${initial.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/menus',           { method: 'POST',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Gagal menyimpan.');
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="font-semibold">{initial?.id ? 'Edit menu' : 'Menu baru'}</h3>

      <div>
        <Label htmlFor="name">Nama</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      </div>

      <div>
        <Label htmlFor="category">Kategori</Label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as MenuFormValues['category'])}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="makanan">Makanan</option>
          <option value="nasi">Nasi & side</option>
          <option value="minuman">Minuman</option>
        </select>
      </div>

      <div>
        <Label htmlFor="price">Harga (Rp)</Label>
        <Input id="price" type="number" min={0} step={1000} value={price} onChange={(e) => setPrice(Number(e.target.value))} required />
      </div>

      <div>
        <Label htmlFor="sort_order">Urutan tampil</Label>
        <Input id="sort_order" type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>Batal</Button>
        <Button type="submit" disabled={pending || name.length === 0}>{pending ? 'Menyimpan…' : 'Simpan'}</Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 8.4: Create `app/(app)/menu/menu-list-client.tsx`**

```tsx
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { formatRp } from '@/lib/currency';
import { MenuForm, type MenuFormValues } from '@/components/menu-form';

type Menu = {
  id: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
  sort_order: number;
  is_active: boolean;
};

const CATEGORY_LABEL: Record<Menu['category'], string> = {
  makanan: 'Makanan',
  nasi: 'Nasi & side',
  minuman: 'Minuman',
};

export function MenuListClient({ initialMenus }: { initialMenus: Menu[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Partial<MenuFormValues> | null>(null);
  const [pending, startTransition] = useTransition();

  const grouped = (['makanan', 'nasi', 'minuman'] as const).map((cat) => ({
    cat,
    items: initialMenus.filter((m) => m.category === cat),
  }));

  function refresh() {
    setEditing(null);
    startTransition(() => router.refresh());
  }

  async function handleDeactivate(id: string) {
    if (!confirm('Nonaktifkan menu ini? (Transaksi historis tetap aman)')) return;
    await fetch(`/api/menus/${id}`, { method: 'DELETE' });
    refresh();
  }

  async function handleReactivate(id: string) {
    await fetch(`/api/menus/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: true }),
    });
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-tight">Menu Master</h1>
        <Button onClick={() => setEditing({ category: 'makanan', sort_order: 0 })}>+ Menu Baru</Button>
      </div>

      {editing && (
        <MenuForm
          initial={editing}
          onSaved={refresh}
          onCancel={() => setEditing(null)}
        />
      )}

      {grouped.map(({ cat, items }) => (
        <section key={cat}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            {CATEGORY_LABEL[cat]}
          </h2>
          <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {items.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-zinc-500">Belum ada menu.</li>
            )}
            {items.map((m) => (
              <li key={m.id} className={`flex items-center justify-between px-4 py-3 ${m.is_active ? '' : 'opacity-50'}`}>
                <div>
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs text-zinc-500">{formatRp(m.price)} • urutan {m.sort_order}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setEditing(m)}>Edit</Button>
                  {m.is_active ? (
                    <Button variant="ghost" onClick={() => handleDeactivate(m.id)}>Nonaktifkan</Button>
                  ) : (
                    <Button variant="ghost" onClick={() => handleReactivate(m.id)}>Aktifkan</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {pending && <div className="text-center text-sm text-zinc-500">Memuat ulang…</div>}
    </div>
  );
}
```

- [ ] **Step 8.5: Create `app/(app)/menu/page.tsx`**

```tsx
import { getSupabaseServer } from '@/lib/supabase/server';
import { MenuListClient } from './menu-list-client';

export const dynamic = 'force-dynamic';

export default async function MenuPage() {
  const supabase = await getSupabaseServer();
  const { data, error } = await supabase
    .from('menus')
    .select('id, name, category, price, sort_order, is_active')
    .order('category')
    .order('sort_order')
    .order('name');

  if (error) {
    return <p className="text-red-600">Gagal memuat menu: {error.message}</p>;
  }
  return <MenuListClient initialMenus={data ?? []} />;
}
```

> **Next.js 16 note**: `export const dynamic = 'force-dynamic'` mencegah static caching karena kita butuh real-time data. Konfirmasi di `node_modules/next/dist/docs/01-app/01-getting-started/14-caching-and-revalidating.mdx`.

- [ ] **Step 8.6: Manual verify**

```bash
npm run dev
```

- Login → klik tile "Menu Master" → muncul 29 menu seed grouped per kategori
- Klik "+ Menu Baru" → form muncul → isi → Simpan → menu baru muncul di list
- Klik Edit di menu existing → ubah harga → Simpan → harga update
- Klik Nonaktifkan → confirm → menu jadi opacity-50 dengan tombol "Aktifkan" muncul
- Klik Aktifkan → menu kembali normal
- (Note: page query `MenuPage` tidak filter `is_active` supaya owner bisa kelola menu nonaktif juga)

Stop dev server.

- [ ] **Step 8.7: Commit**

```bash
git add "app/(app)/menu/" components/menu-form.tsx components/ui/input.tsx components/ui/label.tsx
git commit -m "feat(menu): menu master CRUD UI"
```

---

## Task 9: vercel.ts + deploy verification

**Files:**
- Create: `vercel.ts`

External:
- Push repo ke GitHub
- Setup Vercel project linked to GitHub repo
- Set env vars di Vercel project

- [ ] **Step 9.1: Create `vercel.ts`**

```ts
import { type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  framework: 'nextjs',
  regions: ['sin1'],
  // crons + functions config akan ditambah di Plan 2 & 3
};
```

> Catatan: `@vercel/config` adalah package baru (lihat Vercel platform notes). Install: `npm install -D @vercel/config`. Kalau package belum publik / install gagal, fallback ke `vercel.json`:
>
> ```json
> { "framework": "nextjs", "regions": ["sin1"] }
> ```

- [ ] **Step 9.2: Install `@vercel/config` (kalau available)**

```bash
npm install -D @vercel/config
```

Kalau gagal (package belum publik), skip ini dan ganti `vercel.ts` jadi `vercel.json` versi sederhana di atas.

- [ ] **Step 9.3: Verify build di local**

```bash
npm run build
```

Expected: build sukses, semua route ter-compile.

- [ ] **Step 9.4: Push ke GitHub**

Manual via gh CLI atau dashboard:

```bash
# bikin repo di GitHub (private), lalu:
git remote add origin git@github.com:<user>/pak-pon.git
git branch -M main
git push -u origin main
```

- [ ] **Step 9.5: Deploy ke Vercel**

Opsi:
- Vercel dashboard: New Project → import dari GitHub
- Atau CLI: `npm install -g vercel && vercel`

Set env vars di Vercel dashboard (Settings → Environment Variables) untuk Production + Preview:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

- [ ] **Step 9.6: Verify production**

Buka deployment URL → login → test CRUD menu.

- [ ] **Step 9.7: Update `docs/tasks.md` & commit**

Mark Plan 1 tasks `[x]` di `docs/tasks.md`, lalu:

```bash
git add vercel.ts docs/tasks.md package.json package-lock.json
git commit -m "chore(deploy): vercel config + Plan 1 progress"
git push
```

---

## Acceptance criteria — Plan 1 complete

- [ ] Build passes (`npm run build`)
- [ ] Tests pass (`npm run test`)
- [ ] Login flow works end-to-end (login → redirect home; signout → redirect login)
- [ ] Home shows 4 tiles, nav links present
- [ ] Menu master shows 29 seeded menus grouped per kategori
- [ ] Can create new menu via form
- [ ] Can edit existing menu (name/category/price/sort_order)
- [ ] Can deactivate menu (is_active false, displayed dimmed)
- [ ] All non-auth pages redirect to /login when not logged in
- [ ] Deployed to Vercel production, accessible at HTTPS URL
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] No ESLint errors (`npm run lint`)

After all checked: Plan 1 done, ready for Plan 2 (Scan + OCR + Review + Save).
