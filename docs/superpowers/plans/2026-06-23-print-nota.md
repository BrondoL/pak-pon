# Print Nota Web Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor web app print integration dari pattern "Android Intent URL ke RawBT" ke pattern "POST job ke Supabase queue table, Print Agent (Spec B) consume via Realtime". Atomic refactor — replace existing impl, delete unused, end state clean.

**Architecture:** Web app jadi producer: render ESC/POS bytes (existing `lib/escpos.ts`), encode base64, POST ke `/api/print/queue`. Backend insert ke `print_queue` table, Supabase Realtime push ke subscriber. Agent (Spec B) consume. Status feedback via realtime updates dari agent. Banner status baca `agent_heartbeats` table.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres + RLS + Realtime), Vitest + jsdom + RTL, Zod, sonner.

**Spec:** `docs/superpowers/specs/2026-06-23-print-nota-design.md`

**Branch:** `feat/print-nota` (existing — semua commit di branch ini)

**Out of scope (covered in Spec B / separate plan):**
- Print Agent Android app — UI, foreground service, TCP socket, settings
- Multi-warung config
- Print struk customer PDF

---

## Task 1: Migration 0005 — drop print_events, create print_queue & agent_heartbeats, enable realtime

**Files:**
- Create: `supabase/migrations/0005_print_queue.sql`

- [ ] **Step 1: Tulis SQL migration**

Buat file `supabase/migrations/0005_print_queue.sql`:

```sql
-- 0005_print_queue.sql — replace print_events with print_queue + agent_heartbeats

-- 1. Drop print_events (replaced by print_queue + wide-event logger)
DROP TABLE IF EXISTS print_events;

-- 2. print_queue — job queue, agent consume from here
CREATE TABLE print_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- tx_id nullable: test print jobs (trigger='test') tidak terkait transaksi
  tx_id           uuid REFERENCES transactions(id) ON DELETE CASCADE,
  target          text NOT NULL CHECK (target IN ('dapur', 'minuman')),
  trigger         text NOT NULL CHECK (trigger IN ('auto', 'reprint', 'test')),
  bytes_b64       text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'printing', 'done', 'failed')),
  failure_reason  text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  picked_up_at    timestamptz,
  completed_at    timestamptz
);

CREATE INDEX print_queue_status_created_idx
  ON print_queue (status, created_at)
  WHERE status IN ('pending', 'printing');

CREATE INDEX print_queue_recent_idx
  ON print_queue (created_at DESC);

ALTER TABLE print_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read print_queue" ON print_queue
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth insert print_queue" ON print_queue
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth update print_queue" ON print_queue
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 3. agent_heartbeats — track agent online status
CREATE TABLE agent_heartbeats (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_label     text NOT NULL UNIQUE,
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  agent_version   text,
  device_info     text
);

CREATE INDEX agent_heartbeats_recent_idx
  ON agent_heartbeats (last_seen_at DESC);

ALTER TABLE agent_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read agent_heartbeats" ON agent_heartbeats
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth insert agent_heartbeats" ON agent_heartbeats
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "auth update agent_heartbeats" ON agent_heartbeats
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 4. Enable realtime on print_queue (untuk push notif ke Print Agent)
ALTER PUBLICATION supabase_realtime ADD TABLE print_queue;
```

- [ ] **Step 2: SKIP apply migration — controller akan apply via MCP**

JANGAN apply migration. Controller (Claude main session) yang handle apply via `mcp__plugin_supabase_supabase__apply_migration`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_print_queue.sql
git commit -m "feat(db): drop print_events, add print_queue & agent_heartbeats + enable realtime"
```

---

## Task 2: Helper `uint8ToBase64` di `lib/escpos.ts` + extract & test

**Files:**
- Modify: `lib/escpos.ts` (export helper)
- Modify: `lib/escpos.test.ts` (test helper)

**Konteks:** `lib/print-intent.ts` punya `uint8ToBase64` private function. Sebelum delete `print-intent.ts` (Task 16), helper ini harus pindah ke tempat yang masih dipakai (escpos atau new lib). Pilih `lib/escpos.ts` karena paling related (encoder output = bytes → consumer often needs base64).

- [ ] **Step 1: Tambah export `uint8ToBase64` di `lib/escpos.ts`**

Buka `lib/escpos.ts`. Di akhir file (setelah `renderTicket` export), tambah:

```ts
/**
 * Convert Uint8Array ke base64 string. Browser-safe (no Node Buffer).
 * Cocok untuk encode ESC/POS bytes ke text yang aman dikirim via JSON/URL.
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa available in browser & jsdom
  return btoa(binary);
}
```

- [ ] **Step 2: Tambah test di `lib/escpos.test.ts`**

Di akhir file `lib/escpos.test.ts`, tambah block test baru:

```ts
import { uint8ToBase64 } from './escpos';

describe('uint8ToBase64', () => {
  it('encodes empty array as empty string', () => {
    expect(uint8ToBase64(new Uint8Array([]))).toBe('');
  });

  it('encodes simple ASCII bytes', () => {
    // 'HI' = [0x48, 0x49] → 'SEk='
    expect(uint8ToBase64(new Uint8Array([0x48, 0x49]))).toBe('SEk=');
  });

  it('encodes ESC/POS control bytes round-trip', () => {
    // [0x1b, 0x40, 0x48, 0x49] = ESC@HI → 'G0BISQ=='
    expect(uint8ToBase64(new Uint8Array([0x1b, 0x40, 0x48, 0x49]))).toBe('G0BISQ==');
  });

  it('encodes high-byte (>0x7f) correctly', () => {
    // [0xff] → '/w=='
    expect(uint8ToBase64(new Uint8Array([0xff]))).toBe('/w==');
  });
});
```

**Note:** kalau `import { uint8ToBase64 }` sudah ada di file dari import line existing, gabungkan. Kalau belum, tambahkan di import line existing di atas atau di line baru.

- [ ] **Step 3: Run test**

Run: `npx vitest run lib/escpos.test.ts`
Expected: semua test (existing + 4 baru) pass.

- [ ] **Step 4: Commit**

```bash
git add lib/escpos.ts lib/escpos.test.ts
git commit -m "feat(lib): export uint8ToBase64 helper from escpos"
```

---

## Task 3: Schema `app/api/print/queue/_schema.ts` + tests

**Files:**
- Create: `app/api/print/queue/_schema.ts`
- Create: `app/api/print/queue/_schema.test.ts`

- [ ] **Step 1: Tulis test (TDD)**

Buat `app/api/print/queue/_schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PrintQueueInsertSchema } from './_schema';

describe('PrintQueueInsertSchema', () => {
  const valid = {
    tx_id: '11111111-1111-4111-8111-111111111111',
    target: 'dapur',
    trigger: 'auto',
    bytes_b64: 'G0BISQ==',
  };

  it('accepts valid payload', () => {
    expect(PrintQueueInsertSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts null tx_id (test print)', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, tx_id: null }).success).toBe(true);
  });

  it('rejects invalid target', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, target: 'kitchen' }).success).toBe(false);
  });

  it('rejects invalid trigger', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, trigger: 'manual' }).success).toBe(false);
  });

  it('rejects missing bytes_b64', () => {
    const { bytes_b64: _, ...without } = valid;
    expect(PrintQueueInsertSchema.safeParse(without).success).toBe(false);
  });

  it('rejects empty bytes_b64', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, bytes_b64: '' }).success).toBe(false);
  });

  it('strict — rejects extra unknown fields', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, extra: 'foo' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, expect fail (module not found)**

Run: `npx vitest run app/api/print/queue/_schema.test.ts`
Expected: FAIL — `Failed to resolve import "./_schema"`

- [ ] **Step 3: Implement schema**

Buat `app/api/print/queue/_schema.ts`:

```ts
import { z } from 'zod';

export const PrintQueueInsertSchema = z.object({
  // tx_id null untuk test print (trigger='test')
  tx_id: z.string().uuid().nullable(),
  target: z.enum(['dapur', 'minuman']),
  trigger: z.enum(['auto', 'reprint', 'test']),
  bytes_b64: z.string().min(1),
}).strict();

export type PrintQueueInsertInput = z.infer<typeof PrintQueueInsertSchema>;
```

- [ ] **Step 4: Run test, expect pass (7/7)**

Run: `npx vitest run app/api/print/queue/_schema.test.ts`
Expected: PASS, 7 tests passed.

**Catatan:** kalau `z.string().uuid()` reject test fixture `'11111111-1111-4111-8111-111111111111'`, switch ke `.guid()` (Zod v4 broader UUID validator). Test fixture itu valid UUIDv4 (version=4, variant=8), tapi kalau Zod stricter than expected, fallback `.guid()` reliable.

- [ ] **Step 5: Commit**

```bash
git add app/api/print/queue/_schema.ts app/api/print/queue/_schema.test.ts
git commit -m "feat(api): add PrintQueueInsertSchema with 7 validation tests"
```

---

## Task 4: `POST /api/print/queue` route handler

**Files:**
- Create: `app/api/print/queue/route.ts`

- [ ] **Step 1: Implement route handler**

Buat `app/api/print/queue/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { PrintQueueInsertSchema } from './_schema';

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/print/queue');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = PrintQueueInsertSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ validation_errors: parsed.error.flatten() });
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const payload = parsed.data;
    evt.merge({
      tx_id: payload.tx_id,
      target: payload.target,
      trigger: payload.trigger,
      bytes_size: payload.bytes_b64.length,
    });

    const { data: inserted, error: insertErr } = await supabase
      .from('print_queue')
      .insert({
        tx_id: payload.tx_id,
        target: payload.target,
        trigger: payload.trigger,
        bytes_b64: payload.bytes_b64,
        created_by: user.id,
      })
      .select('id')
      .single();
    if (insertErr) {
      tagStatus(evt, 500);
      evt.error(insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    evt.set('job_id', inserted.id);
    tagStatus(evt, 201);
    return NextResponse.json({ job_id: inserted.id }, { status: 201 });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 2: Lint check**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/print/queue/route.ts
git commit -m "feat(api): add POST /api/print/queue endpoint"
```

---

## Task 5: `GET /api/print/queue/recent` route handler

**Files:**
- Create: `app/api/print/queue/recent/route.ts`

- [ ] **Step 1: Implement route**

Buat `app/api/print/queue/recent/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VALID_STATUS = ['pending', 'printing', 'done', 'failed'] as const;

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/print/queue/recent');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const limitParam = request.nextUrl.searchParams.get('limit');
    const statusParam = request.nextUrl.searchParams.get('status');

    const limit = Math.min(
      Math.max(parseInt(limitParam ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    evt.set('limit', limit);

    let query = supabase
      .from('print_queue')
      .select('id, tx_id, target, trigger, status, failure_reason, created_at, picked_up_at, completed_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (statusParam && statusParam !== 'all' && (VALID_STATUS as readonly string[]).includes(statusParam)) {
      query = query.eq('status', statusParam);
      evt.set('filter_status', statusParam);
    }

    const { data, error } = await query;
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    evt.set('rows_count', data?.length ?? 0);
    tagStatus(evt, 200);
    return NextResponse.json({ jobs: data ?? [] });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 2: Lint check**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/print/queue/recent/route.ts
git commit -m "feat(api): add GET /api/print/queue/recent endpoint with status filter"
```

---

## Task 6: `POST /api/print/queue/[id]/retry` route handler

**Files:**
- Create: `app/api/print/queue/[id]/retry/route.ts`

- [ ] **Step 1: Implement route**

Buat `app/api/print/queue/[id]/retry/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

const NOT_FOUND_CODE = 'PGRST116';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const evt = newEvent('POST /api/print/queue/[id]/retry', { job_id: id });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const { data: job, error: fetchErr } = await supabase
      .from('print_queue')
      .select('id, status')
      .eq('id', id)
      .single();
    if (fetchErr) {
      if (fetchErr.code === NOT_FOUND_CODE) {
        tagStatus(evt, 404);
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      tagStatus(evt, 500);
      evt.error(fetchErr);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    evt.set('previous_status', job.status);
    if (job.status !== 'failed') {
      tagStatus(evt, 409);
      return NextResponse.json(
        { error: 'invalid_state', detail: `cannot retry job with status=${job.status}` },
        { status: 409 }
      );
    }

    const { data: updated, error: updateErr } = await supabase
      .from('print_queue')
      .update({
        status: 'pending',
        failure_reason: null,
        completed_at: null,
        picked_up_at: null,
      })
      .eq('id', id)
      .select('id, tx_id, target, trigger, status, failure_reason, created_at')
      .single();
    if (updateErr) {
      tagStatus(evt, 500);
      evt.error(updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    evt.set('new_status', updated.status);
    tagStatus(evt, 200);
    return NextResponse.json({ job: updated });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 2: Lint check**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add 'app/api/print/queue/[id]/retry/route.ts'
git commit -m "feat(api): add POST /api/print/queue/[id]/retry endpoint"
```

---

## Task 7: `POST /api/print/queue/[id]/cancel` route handler

**Files:**
- Create: `app/api/print/queue/[id]/cancel/route.ts`

- [ ] **Step 1: Implement route**

Buat `app/api/print/queue/[id]/cancel/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

const NOT_FOUND_CODE = 'PGRST116';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const evt = newEvent('POST /api/print/queue/[id]/cancel', { job_id: id });
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const { data: job, error: fetchErr } = await supabase
      .from('print_queue')
      .select('id, status')
      .eq('id', id)
      .single();
    if (fetchErr) {
      if (fetchErr.code === NOT_FOUND_CODE) {
        tagStatus(evt, 404);
        return NextResponse.json({ error: 'not_found' }, { status: 404 });
      }
      tagStatus(evt, 500);
      evt.error(fetchErr);
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    evt.set('previous_status', job.status);
    if (job.status !== 'pending') {
      tagStatus(evt, 409);
      return NextResponse.json(
        { error: 'invalid_state', detail: `cannot cancel job with status=${job.status}` },
        { status: 409 }
      );
    }

    const { data: updated, error: updateErr } = await supabase
      .from('print_queue')
      .update({
        status: 'failed',
        failure_reason: 'cancelled by user',
        completed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, tx_id, target, trigger, status, failure_reason, created_at, completed_at')
      .single();
    if (updateErr) {
      tagStatus(evt, 500);
      evt.error(updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    evt.set('new_status', updated.status);
    tagStatus(evt, 200);
    return NextResponse.json({ job: updated });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 2: Lint check**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add 'app/api/print/queue/[id]/cancel/route.ts'
git commit -m "feat(api): add POST /api/print/queue/[id]/cancel endpoint"
```

---

## Task 8: `GET /api/agent/heartbeat` route handler

**Files:**
- Create: `app/api/agent/heartbeat/route.ts`

- [ ] **Step 1: Implement route**

Buat `app/api/agent/heartbeat/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

export async function GET(_request: NextRequest) {
  const evt = newEvent('GET /api/agent/heartbeat');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const { data, error } = await supabase
      .from('agent_heartbeats')
      .select('agent_label, last_seen_at, agent_version, device_info')
      .order('last_seen_at', { ascending: false });
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const now = Date.now();
    const agents = (data ?? []).map((a) => ({
      ...a,
      online: now - new Date(a.last_seen_at).getTime() < ONLINE_THRESHOLD_MS,
    }));
    evt.merge({ agents_count: agents.length, online_count: agents.filter((a) => a.online).length });

    tagStatus(evt, 200);
    return NextResponse.json({ agents });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 2: Lint check**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/agent/heartbeat/route.ts
git commit -m "feat(api): add GET /api/agent/heartbeat endpoint with online computation"
```

---

## Task 9: Refactor `components/printer-status-banner.tsx` — read agent heartbeat

**Files:**
- Modify: `components/printer-status-banner.tsx`
- Modify: `components/printer-status-banner.test.tsx`

**Konteks:** Banner sekarang baca dari localStorage (`getPrinterStatus`). Refactor → fetch `/api/agent/heartbeat`, tampilkan banner red kalau 0 agent online.

- [ ] **Step 1: Update test untuk new behavior (TDD)**

Replace `components/printer-status-banner.test.tsx` ISI dengan:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PrinterStatusBanner } from './printer-status-banner';

const mockFetch = (response: unknown, status = 200) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(response), { status })));

describe('<PrinterStatusBanner />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders red banner when no agents found', async () => {
    global.fetch = mockFetch({ agents: [] }) as unknown as typeof fetch;
    render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(screen.getByText(/print agent belum jalan/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /setup/i })).toHaveAttribute('href', '/setup/printer');
  });

  it('renders red banner when all agents offline (stale heartbeat)', async () => {
    const staleISO = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    global.fetch = mockFetch({
      agents: [{ agent_label: 'main-tab', last_seen_at: staleISO, online: false }],
    }) as unknown as typeof fetch;
    render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(screen.getByText(/print agent belum jalan/i)).toBeInTheDocument();
    });
  });

  it('renders nothing when at least 1 agent online', async () => {
    const recentISO = new Date().toISOString();
    global.fetch = mockFetch({
      agents: [{ agent_label: 'main-tab', last_seen_at: recentISO, online: true }],
    }) as unknown as typeof fetch;
    const { container } = render(<PrinterStatusBanner />);
    await waitFor(() => {
      expect(container.querySelector('[data-testid="printer-banner"]')).toBeNull();
    });
  });

  it('handles fetch error gracefully (renders nothing)', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network'))) as unknown as typeof fetch;
    const { container } = render(<PrinterStatusBanner />);
    await waitFor(() => {
      // Defensive: error treated as "unknown" — gak tampilkan banner sampai data tersedia
      expect(container.querySelector('[data-testid="printer-banner"]')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test, expect fail (still uses old localStorage logic)**

Run: `npx vitest run components/printer-status-banner.test.tsx`
Expected: FAIL — current implementation reads localStorage, not fetch.

- [ ] **Step 3: Replace `components/printer-status-banner.tsx` ISI dengan:**

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type Agent = {
  agent_label: string;
  last_seen_at: string;
  agent_version: string | null;
  device_info: string | null;
  online: boolean;
};

export function PrinterStatusBanner() {
  const [agents, setAgents] = useState<Agent[] | null>(null);

  useEffect(() => {
    fetch('/api/agent/heartbeat')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      .then((d) => setAgents(d.agents as Agent[]))
      .catch(() => {
        // SSR-safe: on fetch error, leave agents=null (banner hidden, defensive)
      });
  }, []);

  if (agents === null) return null;
  const onlineCount = agents.filter((a) => a.online).length;
  if (onlineCount > 0) return null;

  return (
    <div
      data-testid="printer-banner"
      className="mx-4 my-2 rounded-md border border-brick-soft bg-brick-faint p-3 text-sm text-brick-dark"
    >
      <div className="flex items-center justify-between gap-2">
        <span>Print agent belum jalan</span>
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

- [ ] **Step 4: Run test, expect pass (4/4)**

Run: `npx vitest run components/printer-status-banner.test.tsx`
Expected: PASS, 4 tests passed.

- [ ] **Step 5: Lint check**

Run: `npm run lint`
Expected: 0 new errors.

- [ ] **Step 6: Commit**

```bash
git add components/printer-status-banner.tsx components/printer-status-banner.test.tsx
git commit -m "refactor(ui): banner reads agent heartbeat instead of localStorage"
```

---

## Task 10: Refactor `components/test-print-dialog.tsx` — POST queue

**Files:**
- Modify: `components/test-print-dialog.tsx`
- Modify: `components/test-print-dialog.test.tsx`

**Konteks:** Refactor dari "fire intent URL + manual confirm Berhasil/Gagal" jadi "POST job to queue, show submitting → awaiting_agent". Optional realtime listener untuk live status, tapi MVP version skip — user cek di debug page.

- [ ] **Step 1: Replace test ISI dengan:**

Replace seluruh isi `components/test-print-dialog.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestPrintDialog } from './test-print-dialog';

const mockFetchOk = (body: unknown, status = 201) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe('<TestPrintDialog />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders idle state with submit button', () => {
    render(<TestPrintDialog target="dapur" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /cetak tes/i })).toBeInTheDocument();
  });

  it('shows submitting then awaiting_agent after POST success', async () => {
    global.fetch = mockFetchOk({ job_id: 'job-1' }) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<TestPrintDialog target="dapur" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /cetak tes/i }));
    await waitFor(() => {
      expect(screen.getByText(/job dikirim/i)).toBeInTheDocument();
    });
  });

  it('shows error state when POST fails', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error: 'server' }), { status: 500 }))
    ) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<TestPrintDialog target="dapur" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /cetak tes/i }));
    await waitFor(() => {
      expect(screen.getByText(/gagal mengirim/i)).toBeInTheDocument();
    });
  });

  it('posts correct payload (target, trigger=test, tx_id=null, bytes_b64 non-empty)', async () => {
    const fetchMock = mockFetchOk({ job_id: 'job-1' });
    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<TestPrintDialog target="minuman" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /cetak tes/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toBe('/api/print/queue');
    const body = JSON.parse(call[1].body as string);
    expect(body.target).toBe('minuman');
    expect(body.trigger).toBe('test');
    expect(body.tx_id).toBeNull();
    expect(body.bytes_b64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('close button returns to closed state via onClose callback', async () => {
    global.fetch = mockFetchOk({ job_id: 'job-1' }) as unknown as typeof fetch;
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<TestPrintDialog target="dapur" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /cetak tes/i }));
    await waitFor(() => expect(screen.getByText(/job dikirim/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /tutup/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Replace component ISI dengan:**

Replace seluruh isi `components/test-print-dialog.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { renderTicket, uint8ToBase64 } from '@/lib/escpos';

type Phase = 'idle' | 'submitting' | 'awaiting_agent' | 'error';
type Target = 'dapur' | 'minuman';

function buildTestPayload(target: Target): string {
  const bytes = renderTicket({
    target,
    daily_seq: 0,
    created_at: new Date(),
    customer_name: null,
    table_no: null,
    items: [{ qty: 1, name: `TES PRINTER ${target.toUpperCase()}`, note: null }],
  });
  return uint8ToBase64(bytes);
}

export function TestPrintDialog({
  target,
  onClose,
}: {
  target: Target;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleFire() {
    setPhase('submitting');
    setError(null);
    try {
      const res = await fetch('/api/print/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_id: null,
          target,
          trigger: 'test',
          bytes_b64: buildTestPayload(target),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(`gagal mengirim: ${data.error ?? `HTTP ${res.status}`}`);
        setPhase('error');
        return;
      }
      setPhase('awaiting_agent');
    } catch (err) {
      setError(`gagal mengirim: ${err instanceof Error ? err.message : 'unknown'}`);
      setPhase('error');
    }
  }

  const label = target.toUpperCase();

  if (phase === 'idle') {
    return (
      <div className="space-y-3 rounded-md border border-clay-soft bg-paper-soft p-4">
        <h3 className="font-medium text-coal">Cetak tes printer {label}</h3>
        <p className="text-sm text-coal-soft">
          Pastikan agent app jalan & printer siap. Lalu tekan tombol di bawah.
        </p>
        <button
          onClick={handleFire}
          className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Cetak Tes Sekarang
        </button>
        <button
          onClick={onClose}
          className="w-full rounded-md border border-clay-soft px-4 py-2 text-coal"
        >
          Batal
        </button>
      </div>
    );
  }

  if (phase === 'submitting') {
    return (
      <div className="space-y-3 rounded-md border border-clay-soft bg-paper-soft p-4">
        <p className="text-sm text-coal">Mengirim...</p>
      </div>
    );
  }

  if (phase === 'awaiting_agent') {
    return (
      <div className="space-y-3 rounded-md border border-clay-soft bg-paper-soft p-4">
        <h3 className="font-medium text-coal">Job dikirim ke agent</h3>
        <p className="text-sm text-coal-soft">
          Tunggu agent process &amp; cetak. Cek halaman <a href="/setup/printer/debug" className="underline">diagnostic</a> untuk status terkini.
        </p>
        <button
          onClick={onClose}
          className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Tutup
        </button>
      </div>
    );
  }

  // phase === 'error'
  return (
    <div className="space-y-3 rounded-md border border-brick-soft bg-brick-faint p-4">
      <h3 className="font-medium text-brick-dark">Gagal mengirim ke queue</h3>
      <p className="text-sm text-brick-dark">{error ?? 'unknown error'}</p>
      <div className="flex gap-2">
        <button
          onClick={() => setPhase('idle')}
          className="flex-1 rounded-md border border-brick-soft px-4 py-2 text-brick"
        >
          Coba Lagi
        </button>
        <button
          onClick={onClose}
          className="flex-1 rounded-md bg-brick px-4 py-2 text-white"
        >
          Tutup
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Run test, expect 5/5 pass**

Run: `npx vitest run components/test-print-dialog.test.tsx`
Expected: PASS, 5 tests passed.

- [ ] **Step 4: Lint & TS check**

Run: `npm run lint && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add components/test-print-dialog.tsx components/test-print-dialog.test.tsx
git commit -m "refactor(ui): test-print-dialog POSTs to queue instead of intent URL"
```

---

## Task 11: Refactor `components/reprint-card.tsx` — POST queue

**Files:**
- Modify: `components/reprint-card.tsx`
- Modify: `components/reprint-card.test.tsx`

- [ ] **Step 1: Replace test ISI dengan:**

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReprintCard } from './reprint-card';
import type { TransactionItemForPrint } from './reprint-card';

const txBase = {
  id: '11111111-1111-4111-8111-111111111111',
  daily_seq: 42,
  created_at: '2026-06-23T07:32:00.000Z',
  customer_name: 'Pak Budi',
  table_no: '5',
};

const itemsBoth: TransactionItemForPrint[] = [
  { id: '1', menu_name_snapshot: 'Ayam', menu_category: 'makanan', qty: 2, notes: null },
  { id: '2', menu_name_snapshot: 'Es Teh', menu_category: 'minuman', qty: 1, notes: null },
];
const itemsDapurOnly: TransactionItemForPrint[] = [
  { id: '1', menu_name_snapshot: 'Ayam', menu_category: 'makanan', qty: 2, notes: null },
];
const itemsMinumanOnly: TransactionItemForPrint[] = [
  { id: '1', menu_name_snapshot: 'Es Teh', menu_category: 'minuman', qty: 1, notes: null },
];

const mockFetchOk = () =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify({ job_id: 'job-1' }), { status: 201 })));

describe('<ReprintCard />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders 3 buttons when both categories present', () => {
    render(<ReprintCard transaction={txBase} items={itemsBoth} />);
    expect(screen.getByRole('button', { name: /cetak dapur/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /cetak minuman/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /cetak keduanya/i })).toBeEnabled();
  });

  it('disables minuman button when no minuman item', () => {
    render(<ReprintCard transaction={txBase} items={itemsDapurOnly} />);
    expect(screen.getByRole('button', { name: /cetak minuman/i })).toBeDisabled();
  });

  it('disables dapur button when no makanan/nasi item', () => {
    render(<ReprintCard transaction={txBase} items={itemsMinumanOnly} />);
    expect(screen.getByRole('button', { name: /cetak dapur/i })).toBeDisabled();
  });

  it('POSTs job for single target with correct shape', async () => {
    const fetchMock = mockFetchOk();
    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<ReprintCard transaction={txBase} items={itemsBoth} />);
    await user.click(screen.getByRole('button', { name: /cetak dapur/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.target).toBe('dapur');
    expect(body.trigger).toBe('reprint');
    expect(body.tx_id).toBe(txBase.id);
    expect(body.bytes_b64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('POSTs 2 jobs (dapur then minuman) when "Cetak Keduanya" clicked', async () => {
    const fetchMock = mockFetchOk();
    global.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<ReprintCard transaction={txBase} items={itemsBoth} />);
    await user.click(screen.getByRole('button', { name: /cetak keduanya/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body0 = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const body1 = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect([body0.target, body1.target].sort()).toEqual(['dapur', 'minuman']);
  });
});
```

- [ ] **Step 2: Replace component ISI dengan:**

```tsx
'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { renderTicket, uint8ToBase64 } from '@/lib/escpos';

export type MenuCategory = 'makanan' | 'nasi' | 'minuman';
export type PrinterTarget = 'dapur' | 'minuman';

export type TransactionItemForPrint = {
  id: string;
  menu_name_snapshot: string;
  menu_category: MenuCategory;
  qty: number;
  notes: string | null;
};

type TxBase = {
  id: string;
  daily_seq: number | null;
  created_at: string;
  customer_name: string | null;
  table_no: string | null;
};

function splitByTarget(items: TransactionItemForPrint[]) {
  const dapur: TransactionItemForPrint[] = [];
  const minuman: TransactionItemForPrint[] = [];
  for (const it of items) {
    if (it.menu_category === 'minuman') minuman.push(it);
    else if (it.menu_category === 'makanan' || it.menu_category === 'nasi') dapur.push(it);
  }
  return { dapur, minuman };
}

async function submitJob(args: {
  tx: TxBase;
  target: PrinterTarget;
  targetItems: TransactionItemForPrint[];
}): Promise<{ ok: boolean; error?: string }> {
  const bytes = renderTicket({
    target: args.target,
    daily_seq: args.tx.daily_seq ?? 0,
    created_at: new Date(args.tx.created_at),
    customer_name: args.tx.customer_name,
    table_no: args.tx.table_no,
    items: args.targetItems.map((i) => ({
      qty: i.qty,
      name: i.menu_name_snapshot,
      note: i.notes,
    })),
  });
  const bytes_b64 = uint8ToBase64(bytes);
  try {
    const res = await fetch('/api/print/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id: args.tx.id,
        target: args.target,
        trigger: 'reprint',
        bytes_b64,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export function ReprintCard({
  transaction,
  items,
}: {
  transaction: TxBase;
  items: TransactionItemForPrint[];
}) {
  const [submitting, setSubmitting] = useState<PrinterTarget | 'both' | null>(null);
  const split = splitByTarget(items);
  const hasDapur = split.dapur.length > 0;
  const hasMinuman = split.minuman.length > 0;

  async function fireFor(target: PrinterTarget) {
    setSubmitting(target);
    const targetItems = target === 'dapur' ? split.dapur : split.minuman;
    const result = await submitJob({ tx: transaction, target, targetItems });
    setSubmitting(null);
    if (result.ok) {
      toast.success(`Job cetak ${target} dikirim ke agent`);
    } else {
      toast.error(`Gagal kirim job ${target}: ${result.error}`);
    }
  }

  async function fireBoth() {
    setSubmitting('both');
    const jobs: Promise<{ ok: boolean; error?: string; target: PrinterTarget }>[] = [];
    if (hasDapur) {
      jobs.push(submitJob({ tx: transaction, target: 'dapur', targetItems: split.dapur }).then((r) => ({ ...r, target: 'dapur' as const })));
    }
    if (hasMinuman) {
      jobs.push(submitJob({ tx: transaction, target: 'minuman', targetItems: split.minuman }).then((r) => ({ ...r, target: 'minuman' as const })));
    }
    const results = await Promise.all(jobs);
    setSubmitting(null);
    const succeeded = results.filter((r) => r.ok).map((r) => r.target);
    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) {
      toast.success(`${succeeded.length} job dikirim ke agent`);
    } else {
      toast.error(`${succeeded.length} sukses, ${failed.length} gagal: ${failed.map((f) => `${f.target}=${f.error}`).join(', ')}`);
    }
  }

  return (
    <div className="rounded-md border border-clay-soft bg-paper-soft p-4 space-y-3">
      <h3 className="font-medium text-coal">Cetak ulang</h3>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => fireFor('dapur')}
          disabled={!hasDapur || submitting !== null}
          className="rounded-md border border-clay-soft px-3 py-2 text-sm text-coal disabled:opacity-50"
        >
          {submitting === 'dapur' ? 'Mengirim...' : 'Cetak Dapur'}
        </button>
        <button
          onClick={() => fireFor('minuman')}
          disabled={!hasMinuman || submitting !== null}
          className="rounded-md border border-clay-soft px-3 py-2 text-sm text-coal disabled:opacity-50"
        >
          {submitting === 'minuman' ? 'Mengirim...' : 'Cetak Minuman'}
        </button>
      </div>
      <button
        onClick={fireBoth}
        disabled={(!hasDapur && !hasMinuman) || submitting !== null}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {submitting === 'both' ? 'Mengirim...' : 'Cetak Keduanya'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Run test, expect 5/5 pass**

Run: `npx vitest run components/reprint-card.test.tsx`
Expected: PASS, 5 tests passed.

- [ ] **Step 4: Lint & TS check**

Run: `npm run lint && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add components/reprint-card.tsx components/reprint-card.test.tsx
git commit -m "refactor(ui): reprint-card POSTs jobs to queue instead of intent URL"
```

---

## Task 12: Refactor `components/nota-review-form.tsx` — auto-print POST queue

**Files:**
- Modify: `components/nota-review-form.tsx`

**Konteks:** `handleConfirm()` saat ini fire intent URL × 2 targets. Refactor → POST job × N targets paralel via fetch.

- [ ] **Step 1: Locate & read existing handleConfirm**

Run: `grep -n "handleConfirm\|triggerAutoPrint\|postPrintLogBeacon" components/nota-review-form.tsx | head`

- [ ] **Step 2: Replace imports & helpers di nota-review-form.tsx**

Hapus imports lama related ke intent URL & printer-status. Tambah:
```tsx
import { renderTicket, uint8ToBase64 } from '@/lib/escpos';
```
Hapus imports:
```tsx
// HAPUS:
// import { buildRawBtIntentUrl, splitItemsByTarget, type TransactionItemForPrint } from '@/lib/print-intent';
// import { setPrinterStatus, type PrinterTarget } from '@/lib/printer-status';
```

Hapus module-level helpers lama (`postPrintLogBeacon`, `triggerAutoPrint`, `profileForTarget`, dll).

Replace dengan helpers baru (sebelum `export function NotaReviewForm`):

```tsx
type PrinterTarget = 'dapur' | 'minuman';

type ItemForQueue = {
  qty: number;
  menu_name_snapshot: string;
  menu_category: string;
  notes: string | null;
};

function splitItems(items: ItemForQueue[]) {
  const dapur: ItemForQueue[] = [];
  const minuman: ItemForQueue[] = [];
  for (const it of items) {
    if (it.menu_category === 'minuman') minuman.push(it);
    else if (it.menu_category === 'makanan' || it.menu_category === 'nasi') dapur.push(it);
  }
  return { dapur, minuman };
}

async function submitPrintJob(args: {
  tx: { id: string; daily_seq: number | null; created_at: string; customer_name: string | null; table_no: string | null };
  target: PrinterTarget;
  items: ItemForQueue[];
}): Promise<boolean> {
  const bytes = renderTicket({
    target: args.target,
    daily_seq: args.tx.daily_seq ?? 0,
    created_at: new Date(args.tx.created_at),
    customer_name: args.tx.customer_name,
    table_no: args.tx.table_no,
    items: args.items.map((i) => ({
      qty: i.qty,
      name: i.menu_name_snapshot,
      note: i.notes,
    })),
  });
  const bytes_b64 = uint8ToBase64(bytes);
  try {
    const res = await fetch('/api/print/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id: args.tx.id,
        target: args.target,
        trigger: 'auto',
        bytes_b64,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Replace handleConfirm logic**

Cari di file existing block PATCH → toast → router.push. Replace dengan:

```tsx
async function handleConfirm() {
  setSubmitError(null);
  const payload = {
    status: 'confirmed' as const,
    customer_name: customerName.trim() === '' ? null : customerName.trim(),
    table_no: tableNo.trim() === '' ? null : tableNo.trim(),
    items: items.map((it, idx) => ({
      id: it.id,
      menu_id: it.menu_id,
      qty: it.qty,
      notes: it.notes,
      sort_order: idx,
    })),
  };
  try {
    const res = await fetch(`/api/transactions/${transaction.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data: { error?: string } = await res.json().catch(() => ({}));
      throw new Error(data.error ?? 'patch-failed');
    }
    const data = await res.json() as {
      transaction: {
        id: string;
        daily_seq: number | null;
        created_at: string;
        customer_name: string | null;
        table_no: string | null;
      };
      items: Array<{ id: string; menu_id: string; menu_name_snapshot: string; qty: number; notes: string | null }>;
    };

    // Lookup category dari `menus` prop pakai menu_id, lalu submit print jobs paralel
    const itemsForQueue: ItemForQueue[] = data.items.map((it) => {
      const menu = menus.find((m) => m.id === it.menu_id);
      return {
        qty: it.qty,
        menu_name_snapshot: it.menu_name_snapshot,
        menu_category: menu?.category ?? 'makanan',
        notes: it.notes,
      };
    });
    const split = splitItems(itemsForQueue);
    const submitJobs: Promise<{ target: PrinterTarget; ok: boolean }>[] = [];
    if (split.dapur.length > 0) {
      submitJobs.push(
        submitPrintJob({ tx: data.transaction, target: 'dapur', items: split.dapur }).then((ok) => ({ target: 'dapur', ok }))
      );
    }
    if (split.minuman.length > 0) {
      submitJobs.push(
        submitPrintJob({ tx: data.transaction, target: 'minuman', items: split.minuman }).then((ok) => ({ target: 'minuman', ok }))
      );
    }
    const results = await Promise.all(submitJobs);
    const succeeded = results.filter((r) => r.ok).map((r) => r.target);
    const failed = results.filter((r) => !r.ok).map((r) => r.target);

    if (failed.length === 0 && succeeded.length > 0) {
      toast.success(`Nota tersimpan, ${succeeded.length} print job dikirim ke agent`);
    } else if (failed.length > 0) {
      toast.success('Nota tersimpan');
      toast.error(`Gagal kirim print job ke: ${failed.join(', ')}. Coba reprint manual dari halaman detail.`);
    } else {
      toast.success('Nota tersimpan');
    }

    startTransition(() => {
      router.push('/');
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? `Gagal menyimpan: ${err.message}. Coba lagi.`
        : 'Gagal menyimpan. Coba lagi.';
    setSubmitError(message);
    toast.error('Gagal menyimpan nota', {
      description: err instanceof Error ? err.message : 'Coba lagi.',
    });
  }
}
```

- [ ] **Step 4: Rename button text (kalau belum)**

Pastikan button text `✓ Simpan & Cetak` (bukan `✓ Konfirmasi`). Kalau sudah dari sebelumnya, skip.

- [ ] **Step 5: Lint & TS check**

Run: `npm run lint && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Run all tests (regression check)**

Run: `npm run test`
Expected: tests pass (note: existing tests untuk nota-review-form mungkin gak ada — yang penting tests lain gak break).

- [ ] **Step 7: Commit**

```bash
git add components/nota-review-form.tsx
git commit -m "refactor(scan): auto-print POSTs jobs to queue paralel"
```

---

## Task 13: Refactor `app/(app)/setup/printer/page.tsx` — placeholder for agent

**Files:**
- Modify: `app/(app)/setup/printer/page.tsx`

- [ ] **Step 1: Replace ISI dengan**

```tsx
export default function SetupPrinterPage() {
  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-semibold text-coal">Setup Print Agent</h1>

      <section className="space-y-3">
        <p className="text-sm text-coal-soft">
          Untuk mencetak nota ke printer dapur &amp; minuman, kamu butuh aplikasi
          <strong> Print Agent</strong> yang berjalan di tab Android di warung.
          Web app ini cuma mengirim job cetak ke server — Print Agent yang
          mengambil job dan mengirim ke printer LAN.
        </p>
      </section>

      <section className="space-y-3 rounded-md border border-mustard-soft bg-mustard-faint p-4">
        <h2 className="text-lg font-medium text-coal">Status Print Agent</h2>
        <p className="text-sm text-coal-soft">
          Print Agent app belum tersedia (sedang dikembangkan). Untuk sekarang,
          job cetak yang dikirim dari web akan masuk antrian tapi tidak akan dicetak
          sampai Print Agent dijalankan.
        </p>
        <p className="text-sm text-coal-soft">
          Spesifikasi teknis Print Agent: lihat dokumen{' '}
          <code className="bg-clay-mist px-1">docs/superpowers/specs/print-agent-design.md</code> (akan dibuat).
        </p>
      </section>

      <section className="space-y-3 pt-4 border-t border-clay-soft">
        <h2 className="text-lg font-medium text-coal">Diagnostic</h2>
        <p className="text-sm text-coal-soft">
          Lihat antrian print job &amp; status agent di halaman diagnostic.
        </p>
        <a href="/setup/printer/debug" className="text-sm underline text-coal">
          Buka halaman diagnostic
        </a>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Hapus `'use client'` directive (gak butuh client component lagi)**

Pastikan file SUDAH TIDAK pakai `'use client'` (sudah pure server component).

- [ ] **Step 3: Lint check**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add 'app/(app)/setup/printer/page.tsx'
git commit -m "refactor(ui): setup/printer page placeholder for Print Agent (Spec B pending)"
```

---

## Task 14: Refactor `app/(app)/setup/printer/debug/page.tsx` — show queue + heartbeat

**Files:**
- Modify: `app/(app)/setup/printer/debug/page.tsx`

- [ ] **Step 1: Replace ISI dengan**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

type Job = {
  id: string;
  tx_id: string | null;
  target: 'dapur' | 'minuman';
  trigger: 'auto' | 'reprint' | 'test';
  status: 'pending' | 'printing' | 'done' | 'failed';
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
};

type Agent = {
  agent_label: string;
  last_seen_at: string;
  agent_version: string | null;
  device_info: string | null;
  online: boolean;
};

export default function PrinterDebugPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const [agentRes, jobsRes] = await Promise.all([
        fetch('/api/agent/heartbeat'),
        fetch('/api/print/queue/recent?limit=30'),
      ]);
      if (!agentRes.ok) throw new Error(`agent HTTP ${agentRes.status}`);
      if (!jobsRes.ok) throw new Error(`jobs HTTP ${jobsRes.status}`);
      const agentData = await agentRes.json();
      const jobsData = await jobsRes.json();
      setAgents(agentData.agents as Agent[]);
      setJobs(jobsData.jobs as Job[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function retryJob(jobId: string) {
    const res = await fetch(`/api/print/queue/${jobId}/retry`, { method: 'POST' });
    if (res.ok) {
      toast.success('Job di-retry — agent akan pick up lagi');
      reload();
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(`Gagal retry: ${data.error ?? `HTTP ${res.status}`}`);
    }
  }

  const pending = jobs.filter((j) => j.status === 'pending' || j.status === 'printing');
  const recent = jobs.filter((j) => j.status === 'done' || j.status === 'failed');

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-coal">Printer Diagnostic</h1>
        <button
          onClick={reload}
          disabled={loading}
          className="rounded-md border border-clay-soft px-3 py-1 text-sm text-coal disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && <p className="text-sm text-brick-dark">Error: {error}</p>}

      <section className="space-y-2">
        <h2 className="text-lg font-medium text-coal">Agent Status</h2>
        {agents.length === 0 && (
          <p className="text-sm text-coal-soft">Belum ada agent registered.</p>
        )}
        {agents.map((a) => (
          <div
            key={a.agent_label}
            className="flex items-center justify-between rounded-md border border-clay-soft bg-paper-soft p-3"
          >
            <div>
              <p className="font-medium text-coal">{a.agent_label}</p>
              <p className="text-xs text-coal-soft">
                Last seen: {new Date(a.last_seen_at).toLocaleString('id-ID')}
                {a.agent_version && ` · v${a.agent_version}`}
              </p>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                a.online ? 'bg-leaf text-white' : 'bg-brick text-white'
              }`}
            >
              {a.online ? 'Online' : 'Offline'}
            </span>
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium text-coal">Pending / In-progress ({pending.length})</h2>
        {pending.length === 0 && (
          <p className="text-sm text-coal-soft">Tidak ada job pending.</p>
        )}
        {pending.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-clay-soft">
                <th className="text-left p-2 text-coal">Time</th>
                <th className="text-left p-2 text-coal">Target</th>
                <th className="text-left p-2 text-coal">Trigger</th>
                <th className="text-left p-2 text-coal">Status</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((j) => (
                <tr key={j.id} className="border-b border-clay-soft">
                  <td className="p-2 text-coal">{new Date(j.created_at).toLocaleString('id-ID')}</td>
                  <td className="p-2 text-coal">{j.target}</td>
                  <td className="p-2 text-coal">{j.trigger}</td>
                  <td className="p-2 text-coal">{j.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium text-coal">Recent Jobs ({recent.length})</h2>
        {recent.length === 0 && (
          <p className="text-sm text-coal-soft">Belum ada job done/failed.</p>
        )}
        {recent.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-clay-soft">
                <th className="text-left p-2 text-coal">Time</th>
                <th className="text-left p-2 text-coal">Target</th>
                <th className="text-left p-2 text-coal">Status</th>
                <th className="text-left p-2 text-coal">Reason</th>
                <th className="text-left p-2 text-coal">Action</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((j) => (
                <tr key={j.id} className="border-b border-clay-soft">
                  <td className="p-2 text-coal">{new Date(j.created_at).toLocaleString('id-ID')}</td>
                  <td className="p-2 text-coal">{j.target}</td>
                  <td className="p-2">
                    <span className={j.status === 'done' ? 'text-leaf' : 'text-brick'}>
                      {j.status}
                    </span>
                  </td>
                  <td className="p-2 text-coal-soft">{j.failure_reason ?? '-'}</td>
                  <td className="p-2">
                    {j.status === 'failed' && (
                      <button
                        onClick={() => retryJob(j.id)}
                        className="rounded border border-brick-soft px-2 py-0.5 text-xs text-brick"
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Lint & TS check**

Run: `npm run lint && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add 'app/(app)/setup/printer/debug/page.tsx'
git commit -m "refactor(ui): debug page show agent status, queue + retry button"
```

---

## Task 15: Extend cron cleanup untuk `print_queue`

**Files:**
- Modify: `app/api/cron/cleanup/route.ts`

- [ ] **Step 1: Read existing cron**

Run: `cat app/api/cron/cleanup/route.ts | head -80` — pahami pattern existing.

- [ ] **Step 2: Tambah cleanup print_queue setelah existing delete blocks**

Cari block setelah delete soft-deleted transactions (atau delete storage objects). Tambah:

```ts
// — TAMBAHAN: cleanup print_queue done/failed > 7 hari —
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
const { count: queueDeletedCount, error: queueDeleteErr } = await supabase
  .from('print_queue')
  .delete({ count: 'exact' })
  .in('status', ['done', 'failed'])
  .lt('created_at', sevenDaysAgo);
if (queueDeleteErr) {
  evt.warn(`print_queue cleanup error: ${queueDeleteErr.message}`);
} else {
  evt.set('print_queue_deleted', queueDeletedCount ?? 0);
}
```

- [ ] **Step 3: Lint check**

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/cleanup/route.ts
git commit -m "feat(cron): extend cleanup to delete done/failed print_queue >7d"
```

---

## Task 16: Update `docs/logging.md` — print queue events

**Files:**
- Modify: `docs/logging.md`

- [ ] **Step 1: Replace "Print events" section yang ada dengan section baru**

Cari section `## Print events` di file (added in old Task 18). Replace seluruh section dengan:

```markdown
## Print queue events

Endpoint `POST /api/print/queue` accepts print job dari web client, insert row di `print_queue` table. Supabase Realtime push INSERT events ke Print Agent (Spec B) yang subscribe. Agent process job, PATCH status menuju `done` atau `failed`.

### POST /api/print/queue fields

- `user_id` (uuid) — yang submit job
- `tx_id` (uuid \| null) — transaksi terkait; null untuk test print
- `target` (`dapur` \| `minuman`) — printer mana
- `trigger` (`auto` \| `reprint` \| `test`) — sumber print
- `bytes_size` (int) — length of bytes_b64 (untuk monitor payload size)
- `job_id` (uuid) — ID print_queue row yang dibuat (set saat status 201)

### GET /api/print/queue/recent fields

- `limit` (int) — limit parameter (clamped 1-100)
- `filter_status` (string \| null) — filter param kalau dipakai
- `rows_count` (int) — jumlah rows returned

### POST /api/print/queue/[id]/retry fields

- `job_id` — id dari path
- `previous_status` — status sebelum retry
- `new_status` — status setelah retry (always 'pending' kalau sukses)

### POST /api/print/queue/[id]/cancel fields

Sama dengan retry, tapi `new_status='failed'`, `failure_reason='cancelled by user'`.

### GET /api/agent/heartbeat fields

- `agents_count` — jumlah agent rows
- `online_count` — jumlah agent dengan `last_seen_at > now() - 2 min`

### Diagnose flow

Dev cek Vercel logs:
- POST /api/print/queue dengan status 500 → check `error` field untuk DB issue
- POST /api/print/queue dengan status 400 → check `validation_errors` (schema mismatch)
- Job stuck `pending` di `print_queue` → agent gak running (cek heartbeat) atau realtime push gagal
- Job stuck `printing` >5 min → agent crash mid-print
```

- [ ] **Step 2: Commit**

```bash
git add docs/logging.md
git commit -m "docs: update logging.md for print queue events (replace old print.* docs)"
```

---

## Task 17: Delete unused files (cleanup)

**Files:**
- Delete: `lib/print-intent.ts`
- Delete: `lib/print-intent.test.ts`
- Delete: `lib/printer-status.ts`
- Delete: `lib/printer-status.test.ts`
- Delete: `app/api/print/log/route.ts`
- Delete: `app/api/print/log/_schema.ts`
- Delete: `app/api/print/log/_schema.test.ts`
- Delete: `app/api/print/log/recent/route.ts`

- [ ] **Step 1: Verify no remaining usage**

Run: `grep -rn "from '@/lib/print-intent'\|from '@/lib/printer-status'\|/api/print/log" app/ components/ lib/ 2>/dev/null`
Expected: NO MATCHES (semua sudah refactored ke queue paradigm di task sebelumnya).

Kalau ada hasil, tunjukin file mana yang masih reference — gak boleh delete sebelum refactor.

- [ ] **Step 2: Delete files**

```bash
git rm lib/print-intent.ts lib/print-intent.test.ts \
       lib/printer-status.ts lib/printer-status.test.ts \
       app/api/print/log/route.ts \
       app/api/print/log/_schema.ts \
       app/api/print/log/_schema.test.ts \
       app/api/print/log/recent/route.ts
```

Kalau direktori `app/api/print/log/` & `app/api/print/log/recent/` jadi kosong setelahnya, hapus dengan `rmdir`:

```bash
rmdir app/api/print/log/recent 2>/dev/null
rmdir app/api/print/log 2>/dev/null
```

- [ ] **Step 3: Run all tests**

Run: `npm run test`
Expected: all tests pass — total turun sesuai (sebelum: 97, sekarang harus berkurang yang related ke deleted files).

- [ ] **Step 4: Lint + TS**

Run: `npm run lint && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(cleanup): remove intent URL + localStorage status code (replaced by queue)"
```

---

## Task 18: Verify branch in working state

**Files:** none — final verification

- [ ] **Step 1: Full test suite**

Run: `npm run test`
Expected: all tests pass, count sesuai dengan jumlah file yang sudah ada (akan lebih sedikit dari sebelumnya karena delete print-intent + printer-status tests, plus tambahan tests dari queue refactor).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 errors, 0 warnings (clean).

- [ ] **Step 3: TS check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Manual flow check (kalau ada dev environment yang accessible)**

1. `npm run dev`
2. Login → home → banner "Print agent belum jalan" muncul (karena no agent heartbeat)
3. Scan nota → confirm → toast "Nota tersimpan, N print job dikirim ke agent" (no actual print, expected)
4. Visit `/transactions/[id]` → ReprintCard rendered, tombol enabled sesuai kategori
5. Klik "Cetak Dapur" → toast "Job cetak dapur dikirim ke agent"
6. Visit `/setup/printer/debug` → pending jobs ter-list, no agent online

- [ ] **Step 5: No commit (verification task)**

---

## Final review checklist

- [ ] All 18 tasks complete
- [ ] `npm run test` green
- [ ] `npm run lint` clean
- [ ] `npx tsc --noEmit` clean
- [ ] Migration 0005 applied ke remote Supabase via MCP
- [ ] Branch `feat/print-nota` ready for review/merge
- [ ] `docs/superpowers/specs/2026-06-23-print-nota-design.md` updated (Spec A done)
- [ ] `docs/logging.md` updated (print queue events)
- [ ] Print Agent design (Spec B) — separate brainstorming next
