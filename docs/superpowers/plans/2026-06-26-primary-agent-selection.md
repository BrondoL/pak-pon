# Primary Print Agent Selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hilangkan race condition fan-out FCM ke multi agent dengan introduce konsep "primary agent" yang persistent. Dispatch print hanya ke 1 agent yang di-flag primary; tidak ada double-print maupun duplicate-key di `print_history`.

**Architecture:** Tambah kolom `is_primary boolean` di `agent_heartbeats` dengan partial unique index (hanya 1 boleh true). Backfill saat migrasi (agent paling lama jadi primary). `POST /api/print/send` filter `is_primary=true` di query agent; kalau kosong → 503. `PATCH /api/agent/[label]` (baru) panggil RPC atomic `set_primary_agent(uuid)` untuk swap. UI: badge + button + AlertDialog di `/setup/printer/debug`; banner `printer-status-banner.tsx` di-refactor jadi primary-aware.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RPC), shadcn/ui (`AlertDialog`, `Button`), Vitest (jsdom), Zod.

**Spec referensi:** [`docs/superpowers/specs/2026-06-26-primary-agent-selection-design.md`](../specs/2026-06-26-primary-agent-selection-design.md)

---

## File Structure

| Path | Action | Tujuan |
|---|---|---|
| `supabase/migrations/0024_agent_heartbeats_is_primary.sql` | Create | Schema: kolom + index + backfill + RPC |
| `app/api/agent/[label]/_schema.ts` | Create | Zod schema untuk PATCH body |
| `app/api/agent/[label]/_schema.test.ts` | Create | Unit test schema |
| `app/api/agent/[label]/route.ts` | Modify | Tambah PATCH handler; modify DELETE untuk protect primary |
| `app/api/print/send/route.ts` | Modify | Filter `is_primary=true`, ubah reject_reason |
| `app/api/agent/heartbeat/route.ts` | Modify | Include `is_primary` di select + response |
| `components/printer-status-banner.tsx` | Modify | Refactor state machine fokus primary |
| `components/printer-status-banner.test.tsx` | Modify | Update tests untuk primary-aware behavior |
| `app/(app)/setup/printer/debug/page.tsx` | Modify | Tambah badge, button, AlertDialog, empty-primary alert, setPrimary handler |

---

## Task 1: Schema migration + RPC

**Files:**
- Create: `supabase/migrations/0024_agent_heartbeats_is_primary.sql`

**Pre-flight:** Verifikasi struktur `agent_heartbeats` saat ini lewat Supabase MCP atau psql:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name='agent_heartbeats'
ORDER BY ordinal_position;
```

Expected columns (sesuai 0005 + alterations): `id, agent_label, last_seen_at, agent_version, device_info, fcm_token, agent_uuid, status`. **Tidak ada `created_at`** — backfill pakai `last_seen_at ASC`.

- [ ] **Step 1: Tulis migration file**

Path: `supabase/migrations/0024_agent_heartbeats_is_primary.sql`

```sql
-- 0024_agent_heartbeats_is_primary.sql
-- Primary print agent: 1 agent yang menerima semua dispatch FCM.
-- Lihat docs/superpowers/specs/2026-06-26-primary-agent-selection-design.md
-- untuk konteks (fix race fan-out → double print + duplicate key).

ALTER TABLE agent_heartbeats
  ADD COLUMN is_primary boolean NOT NULL DEFAULT false;

-- Hanya 1 row boleh true. Partial unique index = database-level guarantee.
-- Multiple FALSE rows allowed (default state untuk new agents).
CREATE UNIQUE INDEX agent_heartbeats_primary_singleton_idx
  ON agent_heartbeats (is_primary)
  WHERE is_primary = true;

-- Backfill: auto-elect agent dengan heartbeat terbaru (DESC = paling
-- mungkin agent yang lagi dipakai operasional). Kalau pakai ASC, risiko
-- pilih agent stale yang owner sudah ga pakai. Tie-break id ASC supaya
-- deterministik. Kalau tabel kosong, UPDATE no-op — primary ke-set
-- kemudian saat owner pilih manual dari /setup/printer/debug.
UPDATE agent_heartbeats
  SET is_primary = true
  WHERE id = (
    SELECT id FROM agent_heartbeats
    ORDER BY last_seen_at DESC, id ASC
    LIMIT 1
  );

-- Atomic swap RPC. 2 UPDATE harus jalan dalam transaksi sama supaya
-- partial unique index tidak reject saat ada window 0-primary atau
-- 2-primary. Postgres function = implicit transaction.
CREATE OR REPLACE FUNCTION set_primary_agent(target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  UPDATE agent_heartbeats SET is_primary = false WHERE is_primary = true;
  UPDATE agent_heartbeats SET is_primary = true WHERE id = target_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent % not found', target_id USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION set_primary_agent(uuid) TO authenticated;
```

- [ ] **Step 2: Apply migration ke Supabase**

Pakai Supabase MCP `mcp__plugin_supabase_supabase__apply_migration`:
- name: `agent_heartbeats_is_primary`
- query: isi file di atas

Atau via CLI: `supabase db push` (kalau pakai CLI workflow).

- [ ] **Step 3: Verifikasi schema + backfill**

```sql
-- Confirm kolom ada
SELECT column_name FROM information_schema.columns
WHERE table_name='agent_heartbeats' AND column_name='is_primary';
-- Expected: 1 row

-- Confirm partial unique index ada
SELECT indexname FROM pg_indexes
WHERE tablename='agent_heartbeats' AND indexname='agent_heartbeats_primary_singleton_idx';
-- Expected: 1 row

-- Confirm backfill: max 1 primary
SELECT count(*) FROM agent_heartbeats WHERE is_primary=true;
-- Expected: 0 (kalau tabel kosong) atau 1

-- Confirm primary = agent paling lama
SELECT agent_label, last_seen_at, is_primary
FROM agent_heartbeats
ORDER BY last_seen_at ASC;
-- Expected: row pertama is_primary=true, sisanya false
```

- [ ] **Step 4: Verifikasi partial unique index reject duplicate**

```sql
-- Coba INSERT row baru dengan is_primary=true (kalau sudah ada 1 primary).
-- Expected: ERROR duplicate key.
-- Jangan jalankan di prod; pakai staging atau langsung uji RPC step 5.
```

- [ ] **Step 5: Verifikasi RPC atomic swap**

```sql
-- Asumsi sudah ada 2+ rows. Ambil id agent kedua.
SELECT id, agent_label, is_primary FROM agent_heartbeats ORDER BY last_seen_at ASC;

-- Swap primary ke agent kedua.
SELECT set_primary_agent('<id-agent-kedua>'::uuid);

-- Confirm swap berhasil
SELECT agent_label, is_primary FROM agent_heartbeats;
-- Expected: hanya agent kedua is_primary=true, sisanya false

-- Test error path: ID tidak ada
SELECT set_primary_agent('00000000-0000-0000-0000-000000000000'::uuid);
-- Expected: ERROR agent ... not found, SQLSTATE 02000 (no_data_found)
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0024_agent_heartbeats_is_primary.sql
git commit -m "feat(db): add is_primary flag + set_primary_agent RPC"
```

---

## Task 2: Zod schema untuk PATCH body

**Files:**
- Create: `app/api/agent/[label]/_schema.ts`
- Test: `app/api/agent/[label]/_schema.test.ts`

- [ ] **Step 1: Tulis failing test**

Path: `app/api/agent/[label]/_schema.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { AgentPatchSchema } from './_schema';

describe('AgentPatchSchema', () => {
  it('accepts { is_primary: true }', () => {
    expect(AgentPatchSchema.safeParse({ is_primary: true }).success).toBe(true);
  });

  it('rejects { is_primary: false } — demote tidak diizinkan', () => {
    expect(AgentPatchSchema.safeParse({ is_primary: false }).success).toBe(false);
  });

  it('rejects empty object', () => {
    expect(AgentPatchSchema.safeParse({}).success).toBe(false);
  });

  it('rejects extra fields (strict)', () => {
    expect(AgentPatchSchema.safeParse({ is_primary: true, extra: 'foo' }).success).toBe(false);
  });

  it('rejects non-boolean', () => {
    expect(AgentPatchSchema.safeParse({ is_primary: 'true' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test (expect fail)**

```bash
npm run test -- _schema.test.ts
```

Expected: FAIL — `AgentPatchSchema` not exported (module not found).

- [ ] **Step 3: Tulis schema**

Path: `app/api/agent/[label]/_schema.ts`

```ts
import { z } from 'zod';

// Hanya bisa promote ke primary (set is_primary=true). Demote dilakukan
// implicit via promote agent lain (RPC set_primary_agent clear semua dulu).
// Field literal(true) supaya body { is_primary: false } ke-reject di
// validation, bukan jadi no-op confusing.
export const AgentPatchSchema = z.object({
  is_primary: z.literal(true),
}).strict();

export type AgentPatchInput = z.infer<typeof AgentPatchSchema>;
```

- [ ] **Step 4: Run test (expect pass)**

```bash
npm run test -- _schema.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/agent/\[label\]/_schema.ts app/api/agent/\[label\]/_schema.test.ts
git commit -m "feat(api): add Zod schema for PATCH agent body"
```

---

## Task 3: `PATCH /api/agent/[label]` + protect DELETE primary

**Files:**
- Modify: `app/api/agent/[label]/route.ts`

- [ ] **Step 1: Rewrite route file dengan PATCH + DELETE update**

Path: `app/api/agent/[label]/route.ts`

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { AgentPatchSchema } from './_schema';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ label: string }> },
) {
  const { label } = await params;
  const evt = newEvent('DELETE /api/agent/[label]', { agent_label: label });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    // Protect primary: kalau target = primary AND masih ada agent lain,
    // tolak sampai owner pindahin primary dulu. Kalau ini satu-satunya
    // agent, delete OK (fresh state, primary kosong).
    const { data: target, error: lookupErr } = await supabase
      .from('agent_heartbeats')
      .select('is_primary')
      .eq('agent_label', label)
      .maybeSingle();
    if (lookupErr) {
      tagStatus(evt, 500);
      evt.error(lookupErr);
      return NextResponse.json({ error: lookupErr.message }, { status: 500 });
    }
    if (target?.is_primary) {
      const { count: othersCount, error: countErr } = await supabase
        .from('agent_heartbeats')
        .select('id', { count: 'exact', head: true })
        .neq('agent_label', label);
      if (countErr) {
        tagStatus(evt, 500);
        evt.error(countErr);
        return NextResponse.json({ error: countErr.message }, { status: 500 });
      }
      if ((othersCount ?? 0) > 0) {
        tagStatus(evt, 409);
        evt.set('reject_reason', 'primary_in_use');
        return NextResponse.json(
          {
            error: 'primary_in_use',
            detail: 'Pindahkan primary ke agent lain sebelum hapus agent ini.',
          },
          { status: 409 },
        );
      }
    }

    const { error, count } = await supabase
      .from('agent_heartbeats')
      .delete({ count: 'exact' })
      .eq('agent_label', label);

    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    evt.set('deleted_count', count ?? 0);
    if ((count ?? 0) === 0) {
      tagStatus(evt, 404);
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    tagStatus(evt, 200);
    return NextResponse.json({ ok: true });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ label: string }> },
) {
  const { label } = await params;
  const evt = newEvent('PATCH /api/agent/[label]', { agent_label: label });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = AgentPatchSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ validation_errors: parsed.error.flatten() });
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const { data: target, error: lookupErr } = await supabase
      .from('agent_heartbeats')
      .select('id, is_primary')
      .eq('agent_label', label)
      .maybeSingle();
    if (lookupErr) {
      tagStatus(evt, 500);
      evt.error(lookupErr);
      return NextResponse.json({ error: lookupErr.message }, { status: 500 });
    }
    if (!target) {
      tagStatus(evt, 404);
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    if (target.is_primary) {
      tagStatus(evt, 200);
      evt.set('already_primary', true);
      return NextResponse.json({ ok: true, already_primary: true });
    }

    // Atomic swap via RPC. Tanpa ini, 2 UPDATE non-transactional dari sisi
    // klien bisa hit partial unique index di tengah window.
    const { error: rpcErr } = await supabase.rpc('set_primary_agent', {
      target_id: target.id,
    });
    if (rpcErr) {
      tagStatus(evt, 500);
      evt.error(rpcErr);
      return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    }

    evt.set('new_primary_label', label);
    tagStatus(evt, 200);
    return NextResponse.json({ ok: true });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 2: Verifikasi typecheck & lint**

```bash
npm run lint
```

Expected: no errors di file ini.

- [ ] **Step 3: Smoke test manual (butuh dev server)**

```bash
npm run dev
```

Di browser dev tools (sudah login):

```js
// Promote agent kedua jadi primary
await fetch('/api/agent/HP%20Kasir%202', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ is_primary: true })
}).then(r => r.json());
// Expected: { ok: true }

// Coba demote (harus 400)
await fetch('/api/agent/HP%20Kasir%202', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ is_primary: false })
}).then(r => r.json());
// Expected: { error: 'invalid_body' }

// Coba delete primary saat masih ada agent lain (harus 409)
await fetch('/api/agent/HP%20Kasir%202', { method: 'DELETE' })
  .then(async (r) => ({ status: r.status, body: await r.json() }));
// Expected: { status: 409, body: { error: 'primary_in_use', detail: ... } }
```

- [ ] **Step 4: Commit**

```bash
git add app/api/agent/\[label\]/route.ts
git commit -m "feat(api): PATCH agent for set primary + protect DELETE primary"
```

---

## Task 4: `POST /api/print/send` — filter primary

**Files:**
- Modify: `app/api/print/send/route.ts`

- [ ] **Step 1: Edit query agents — tambah filter `is_primary=true`**

Di `app/api/print/send/route.ts` (saat ini line 48-53), ganti:

```ts
    const { data: agents, error: queryErr } = await supabase
      .from('agent_heartbeats')
      .select('agent_label, fcm_token')
      .eq('status', 'online')
      .gte('last_seen_at', threshold)
      .not('fcm_token', 'is', null);
```

menjadi:

```ts
    const { data: agents, error: queryErr } = await supabase
      .from('agent_heartbeats')
      .select('agent_label, fcm_token')
      .eq('is_primary', true)
      .eq('status', 'online')
      .gte('last_seen_at', threshold)
      .not('fcm_token', 'is', null);
```

- [ ] **Step 2: Edit response 503 — pesan spesifik primary**

Di `app/api/print/send/route.ts` (saat ini line 65-72), ganti:

```ts
    if (targets.length === 0) {
      tagStatus(evt, 503);
      evt.set('reject_reason', 'agent_offline');
      return NextResponse.json(
        { error: 'agent_offline', detail: 'no online agent available' },
        { status: 503 },
      );
    }
```

menjadi:

```ts
    if (targets.length === 0) {
      tagStatus(evt, 503);
      evt.set('reject_reason', 'primary_offline');
      return NextResponse.json(
        { error: 'agent_offline', detail: 'primary agent offline or not set' },
        { status: 503 },
      );
    }
```

(`error` field tetap `agent_offline` supaya frontend yang sudah handle 503 tidak break — detail message yang lebih spesifik.)

- [ ] **Step 3: Verifikasi lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```

- Save tx baru saat primary agent online → 1 nota keluar (tidak double).
- Stop agent primary di Android app → save tx → toast 503 muncul.

- [ ] **Step 5: Commit**

```bash
git add app/api/print/send/route.ts
git commit -m "feat(print): dispatch only to primary agent"
```

---

## Task 5: `GET /api/agent/heartbeat` — include `is_primary`

**Files:**
- Modify: `app/api/agent/heartbeat/route.ts`

- [ ] **Step 1: Tambah `is_primary` ke select query**

Di `app/api/agent/heartbeat/route.ts` line 31, ganti:

```ts
      .select('agent_label, last_seen_at, agent_version, device_info, status')
```

menjadi:

```ts
      .select('agent_label, last_seen_at, agent_version, device_info, status, is_primary')
```

- [ ] **Step 2: Tambah `is_primary` di mapping response**

Di `app/api/agent/heartbeat/route.ts` line 41-58, ganti blok `agents` mapping menjadi:

```ts
    const now = Date.now();
    const agents = (data ?? []).map((a) => {
      const display_state = computeDisplayState(
        a.status,
        new Date(a.last_seen_at).getTime(),
        now,
      );
      return {
        agent_label: a.agent_label,
        last_seen_at: a.last_seen_at,
        agent_version: a.agent_version,
        device_info: a.device_info,
        status: a.status,
        is_primary: a.is_primary,
        display_state,
        // Backward-compat: `online` true cuma kalau benar-benar segar.
        // Banner / debug page sekarang pakai display_state.
        online: display_state === 'online',
      };
    });
    const primary = agents.find((a) => a.is_primary);
    evt.merge({
      agents_count: agents.length,
      online_count: agents.filter((a) => a.display_state === 'online').length,
      stale_count: agents.filter((a) => a.display_state === 'stale').length,
      offline_count: agents.filter((a) => a.display_state === 'offline').length,
      primary_label: primary?.agent_label ?? null,
      primary_display_state: primary?.display_state ?? null,
    });
```

- [ ] **Step 3: Verifikasi lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```

```js
await fetch('/api/agent/heartbeat').then(r => r.json());
// Expected: { agents: [{ ..., is_primary: true|false, ... }, ...] }
// Tepat 1 agent dengan is_primary=true (kalau ada agent di tabel).
```

- [ ] **Step 5: Commit**

```bash
git add app/api/agent/heartbeat/route.ts
git commit -m "feat(api): include is_primary in heartbeat response"
```

---

## Task 6: `printer-status-banner.tsx` — primary-aware

**Files:**
- Modify: `components/printer-status-banner.tsx`
- Modify: `components/printer-status-banner.test.tsx`

- [ ] **Step 1: Tulis failing test untuk perilaku baru**

Replace `components/printer-status-banner.test.tsx` dengan:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PrinterStatusBanner } from './printer-status-banner';

const mockFetch = (response: unknown, status = 200) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(response), { status })));

const nowISO = () => new Date().toISOString();
const staleISO = () => new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago

describe('<PrinterStatusBanner />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders red "belum ada primary" banner when no agent flagged primary', async () => {
    global.fetch = mockFetch({
      agents: [
        {
          agent_label: 'HP A',
          last_seen_at: nowISO(),
          status: 'online',
          is_primary: false,
          display_state: 'online',
          online: true,
        },
      ],
    }) as unknown as typeof fetch;
    render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(screen.getByText(/belum ada primary agent/i)).toBeInTheDocument();
    });
  });

  it('renders nothing when primary online', async () => {
    global.fetch = mockFetch({
      agents: [
        {
          agent_label: 'HP A',
          last_seen_at: nowISO(),
          status: 'online',
          is_primary: true,
          display_state: 'online',
          online: true,
        },
      ],
    }) as unknown as typeof fetch;
    const { container } = render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="printer-banner"]')).toBeNull();
    });
  });

  it('renders yellow banner with primary label when primary stale', async () => {
    global.fetch = mockFetch({
      agents: [
        {
          agent_label: 'HP A',
          last_seen_at: staleISO(),
          status: 'online',
          is_primary: true,
          display_state: 'stale',
          online: false,
        },
      ],
    }) as unknown as typeof fetch;
    render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(screen.getByText(/HP A/)).toBeInTheDocument();
      expect(screen.getByText(/di-background/i)).toBeInTheDocument();
    });
  });

  it('renders red "primary belum jalan" banner when primary offline', async () => {
    global.fetch = mockFetch({
      agents: [
        {
          agent_label: 'HP A',
          last_seen_at: nowISO(),
          status: 'offline',
          is_primary: true,
          display_state: 'offline',
          online: false,
        },
        {
          agent_label: 'HP B',
          last_seen_at: nowISO(),
          status: 'online',
          is_primary: false,
          display_state: 'online',
          online: true,
        },
      ],
    }) as unknown as typeof fetch;
    render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(screen.getByText(/HP A/)).toBeInTheDocument();
      expect(screen.getByText(/belum jalan/i)).toBeInTheDocument();
    });
  });

  it('renders red "belum ada primary" banner when agents list empty', async () => {
    // Empty list → no primary found → same banner as no-primary-flagged case.
    // Owner needs to install agent app first, then promote di /setup/printer/debug.
    global.fetch = mockFetch({ agents: [] }) as unknown as typeof fetch;
    const { container } = render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(screen.getByText(/belum ada primary agent/i)).toBeInTheDocument();
    });
    expect(container.querySelector('[data-testid="printer-banner"]')).not.toBeNull();
  });

  it('handles fetch error gracefully (renders nothing)', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network'))) as unknown as typeof fetch;
    const { container } = render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="printer-banner"]')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests (expect fail)**

```bash
npm run test -- printer-status-banner.test.tsx
```

Expected: FAIL — banner tidak punya logic primary-aware. Tests baru gagal.

- [ ] **Step 3: Rewrite banner component**

Replace `components/printer-status-banner.tsx` dengan:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type DisplayState = 'online' | 'stale' | 'offline';

type Agent = {
  agent_label: string;
  last_seen_at: string;
  agent_version: string | null;
  device_info: string | null;
  status: string;
  is_primary: boolean;
  display_state: DisplayState;
  online: boolean;
};

export function PrinterStatusBanner() {
  const [agents, setAgents] = useState<Agent[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    function fetchAgents() {
      fetch('/api/agent/heartbeat')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d) => {
          if (!cancelled) setAgents(d.agents as Agent[]);
        })
        .catch(() => {
          // SSR-safe: on fetch error, leave agents as-is
        });
    }

    fetchAgents();
    const intervalId = setInterval(fetchAgents, 30_000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  if (agents === null) return null;
  const primary = agents.find((a) => a.is_primary);

  // No primary di tabel — owner belum pernah pilih, atau primary baru di-delete.
  // Banner merah arahkan ke debug page.
  if (!primary) {
    return (
      <div
        data-testid="printer-banner"
        className="mx-0 my-2 rounded-md border border-brick-soft bg-brick-faint p-3 text-sm text-brick-dark"
      >
        <div className="flex items-center justify-between gap-2">
          <span>Belum ada primary agent. Print tidak akan jalan.</span>
          <Link
            href="/setup/printer/debug"
            className="rounded bg-brick px-3 py-1 text-xs font-medium text-white"
          >
            Pilih Primary
          </Link>
        </div>
      </div>
    );
  }

  // Primary online — happy path, no banner.
  if (primary.display_state === 'online') return null;

  // STALE: status='online' tapi heartbeat >= 1 jam. Kemungkinan ke-freeze OEM,
  // FCM masih bisa wake — banner info kuning bukan alarm.
  if (primary.display_state === 'stale') {
    return (
      <div
        data-testid="printer-banner"
        className="mx-0 my-2 rounded-md border border-mustard/40 bg-mustard-faint p-3 text-sm text-coal"
      >
        <div className="flex items-center justify-between gap-2">
          <span>
            Primary ({primary.agent_label}) kemungkinan di-background. Cek HP kalau cetak ngga jalan.
          </span>
          <Link
            href="/setup/printer/debug"
            className="rounded border border-mustard/60 px-3 py-1 text-xs font-medium text-coal"
          >
            Detail
          </Link>
        </div>
      </div>
    );
  }

  // OFFLINE: status='offline' (Stop button). Alarm merah.
  return (
    <div
      data-testid="printer-banner"
      className="mx-0 my-2 rounded-md border border-brick-soft bg-brick-faint p-3 text-sm text-brick-dark"
    >
      <div className="flex items-center justify-between gap-2">
        <span>Primary ({primary.agent_label}) belum jalan. Pencet Start di device.</span>
        <Link
          href="/setup/printer"
          className="rounded bg-brick px-3 py-1 text-xs font-medium text-white"
        >
          Setup
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests (expect pass)**

```bash
npm run test -- printer-status-banner.test.tsx
```

Expected: PASS (6 tests).

- [ ] **Step 5: Verifikasi lint**

```bash
npm run lint
```

Expected: no errors di banner files.

- [ ] **Step 6: Commit**

```bash
git add components/printer-status-banner.tsx components/printer-status-banner.test.tsx
git commit -m "ux(print): banner fokus ke status primary agent"
```

---

## Task 7: Debug page — badge, button, empty alert

**Files:**
- Modify: `app/(app)/setup/printer/debug/page.tsx`

- [ ] **Step 1: Tambah `is_primary` ke `Agent` type**

Di `app/(app)/setup/printer/debug/page.tsx` line 45-53, ganti type `Agent`:

```tsx
type Agent = {
  agent_label: string;
  last_seen_at: string;
  agent_version: string | null;
  device_info: string | null;
  status: string;
  is_primary: boolean;
  display_state: DisplayState;
  online: boolean;
};
```

- [ ] **Step 2: Tambah handler `setPrimary`**

Sebelum `deleteAgent` (line 99-108), tambah:

```tsx
  async function setPrimary(label: string) {
    const res = await fetch(`/api/agent/${encodeURIComponent(label)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_primary: true }),
    });
    if (res.ok) {
      toast.success(`${label} sekarang primary`);
      reload();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(`Gagal set primary: ${data.detail ?? data.error ?? `HTTP ${res.status}`}`);
    }
  }
```

- [ ] **Step 3: Tambah empty-primary alert di atas list agent**

Sebelum `{agents.map((a) => (...))}` (line 137), tambah:

```tsx
        {agents.length > 0 && !agents.some((a) => a.is_primary) && (
          <div className="rounded-md border border-brick-soft bg-brick-faint p-3 text-sm text-brick-dark">
            <p className="font-medium">Belum ada primary agent</p>
            <p>
              Print tidak akan jalan sampai owner pilih satu agent sebagai primary.
              Klik &ldquo;Jadikan Primary&rdquo; pada salah satu agent di bawah.
            </p>
          </div>
        )}
```

- [ ] **Step 4: Tambah badge "Primary" di label agent + tombol "Jadikan Primary"**

Di card agent (line 138-178), ganti `<div className="min-w-0">...</div>` blok jadi:

```tsx
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium text-coal">{a.agent_label}</p>
                {a.is_primary && (
                  <span className="shrink-0 rounded-full bg-coal px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-paper">
                    Primary
                  </span>
                )}
              </div>
              <p className="text-xs text-coal-soft">
                Last seen: {new Date(a.last_seen_at).toLocaleString('id-ID')}
                {a.agent_version && ` · v${a.agent_version}`}
              </p>
            </div>
```

Lalu di `<div className="flex items-center justify-between gap-2 sm:justify-end">` (line ~149), sebelum tombol Hapus (`<AlertDialog>` yang existing), tambah AlertDialog baru untuk "Jadikan Primary":

```tsx
              {!a.is_primary && (
                <AlertDialog>
                  <AlertDialogTrigger
                    aria-label={`Jadikan primary ${a.agent_label}`}
                    render={<Button type="button" variant="outline" size="sm" />}
                  >
                    Jadikan Primary
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        Ganti primary agent ke &ldquo;{a.agent_label}&rdquo;?
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Semua nota akan dikirim ke device ini. Pastikan device aktif dan printer-nya
                        sudah benar di-set.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Batal</AlertDialogCancel>
                      <AlertDialogAction onClick={() => setPrimary(a.agent_label)}>
                        Set Primary
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
```

- [ ] **Step 5: Verifikasi lint + typecheck**

```bash
npm run lint
```

Expected: no errors di debug page.

- [ ] **Step 6: Manual UI test**

```bash
npm run dev
```

Buka `http://localhost:3000/setup/printer/debug`:

1. Verify badge "Primary" tampil di agent yang `is_primary=true`.
2. Verify tombol "Jadikan Primary" tampil di agent non-primary.
3. Klik tombol → dialog konfirmasi muncul.
4. Klik "Set Primary" → toast sukses, badge pindah, list refresh.
5. Coba klik "Hapus" pada primary saat ada >1 agent → toast error "Pindahkan primary dulu".
6. Promote agent lain → primary pindah → coba hapus agent (sekarang non-primary) → sukses.
7. Hapus semua agent kecuali 1 (yang primary) → "Hapus" pada satu-satunya agent harus sukses (no others).
8. Saat tidak ada primary di list (manual: SQL `UPDATE agent_heartbeats SET is_primary=false;`) → alert merah "Belum ada primary agent" muncul di atas.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/setup/printer/debug/page.tsx
git commit -m "ux(printer): pilih primary agent di debug page"
```

---

## Task 8: End-to-end verification + heartbeat preservation test

Tujuan: confirm `is_primary` tidak ke-reset oleh heartbeat upsert dari agent app. Ini risk #1 di spec section 7.

**Files:** none (verification only).

- [ ] **Step 1: Reset state ke clean baseline**

```sql
-- Pastikan ada minimal 2 agent dengan agent_uuid yang unik.
SELECT agent_label, agent_uuid, status, is_primary, last_seen_at FROM agent_heartbeats;
-- Catat agent_label & agent_uuid agent yang akan jadi primary.
```

- [ ] **Step 2: Set primary via UI**

Di `/setup/printer/debug`, klik "Jadikan Primary" pada agent A (yang lagi online).

```sql
-- Verify
SELECT agent_label, is_primary FROM agent_heartbeats WHERE is_primary=true;
-- Expected: agent A
```

- [ ] **Step 3: Tunggu 5 menit (≥10 heartbeat tick di interval 30s)**

Catat waktu. Biarkan agent A jalan terus (jangan stop). Heartbeat akan upsert tiap 30s.

- [ ] **Step 4: Re-verify primary flag**

```sql
SELECT agent_label, is_primary, last_seen_at FROM agent_heartbeats WHERE agent_label='<agent-A-label>';
-- Expected: is_primary=true masih, last_seen_at recent (<30s ago).
```

**Kalau is_primary=false:** heartbeat overwrite jalan. Gawat. Mitigasi (pilih satu):

a) Tambah RLS policy block UPDATE `is_primary` dari role yang dipakai agent. Pengganti migration 0024 atau tambahan 0025:

```sql
-- 0025_agent_heartbeats_is_primary_rls.sql
-- Block agent (anon role) update is_primary. Hanya server-side (service_role
-- atau authenticated user via API) yang boleh.
CREATE POLICY "block anon update is_primary" ON agent_heartbeats
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (is_primary = (SELECT is_primary FROM agent_heartbeats h WHERE h.id = id));
```

b) Atau ganti agent upsert pattern: pakai partial column upsert (kalau supabase-kt support `defaultToNull = false` atau equivalent).

c) Worst case: web call `set_primary_agent` ulang setelah heartbeat — paling jelek.

Pilih (a). Apply migration 0025, re-run Task 8 step 3-4.

- [ ] **Step 5: Smoke test full dispatch loop**

1. Save tx baru saat primary online → cek 1 nota fisik keluar (bukan 2).
2. Cek `print_history`: 1 row baru `status='done'`, label = primary.
3. Stop primary di Android → web banner berubah merah dalam <= 30s.
4. Save tx lagi → toast 503 muncul.
5. Promote agent lain (cadangan online) jadi primary via UI → save tx → nota keluar di device baru.
6. Tidak ada row `status='failed'` di `print_history` selama test (kecuali memang dimatikan printer).

- [ ] **Step 6: Commit verifikasi (jika ada migration 0025)**

```bash
git add supabase/migrations/0025_agent_heartbeats_is_primary_rls.sql
git commit -m "fix(db): RLS block agent from overwriting is_primary on heartbeat"
```

Kalau Task 8 step 4 pass tanpa migration 0025 (heartbeat tidak overwrite), skip commit ini.

---

## Task 9: Update docs/CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (section "Print system")

- [ ] **Step 1: Tambah note primary di section Dispatch**

Edit `CLAUDE.md` di section "Print system (Phase 1+2+3 shipped 2026-06-25)". Modify bullet "Dispatch":

```
- **Dispatch**: `POST /api/print/send` cek `agent_heartbeats.is_primary=true AND status='online' AND last_seen_at>now()-24h AND fcm_token IS NOT NULL` → kirim FCM ke 1 primary agent (no fan-out). **Primary** dipilih owner di `/setup/printer/debug`; auto-elect agent paling lama saat migrasi 0024. Primary offline → 503.
```

- [ ] **Step 2: Update tanggal kalau perlu**

Ganti `(Phase 1+2+3 shipped 2026-06-25)` → `(Phase 1+2+3 shipped 2026-06-25, primary agent shipped 2026-06-26)`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: catat primary agent selection di CLAUDE.md"
```

---

## Final Checklist

- [ ] Migration 0024 applied di prod Supabase
- [ ] (Optional) Migration 0025 RLS applied jika Task 8 step 4 perlu
- [ ] Build pass: `npm run build`
- [ ] Tests pass: `npm run test`
- [ ] Lint pass: `npm run lint`
- [ ] Manual E2E (Task 8 step 5) verified di production env
- [ ] Owner sign-off: print tidak double, primary selection intuitive
- [ ] CLAUDE.md updated
