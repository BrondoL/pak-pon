# Phase 2 (WEB SIDE) — FCM-Only Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch web side to FCM-only print dispatch — drop reliance on `print_queue` realtime, add `print_history` audit table, expose explicit `agent_heartbeats.status` for online/offline, refuse to dispatch when no agent online.

**Architecture:** Web stops INSERTing to `print_queue` for new jobs. New endpoint `POST /api/print/send` checks `agent_heartbeats.status='online' AND last_seen_at > now()-90s`, then fires FCM with payload inline. Agent (parallel work, separate repo) inserts to `print_history` on done/failed. Web cron extended to retain history ≤ 7 days.

**Tech Stack:** Next.js 16 App Router, Supabase Postgres + Realtime (still used elsewhere; not for print_queue anymore), Firebase Admin SDK (existing `lib/fcm.ts`), Zod, vitest.

**Spec referensi:** `docs/superpowers/specs/2026-06-25-print-revamp-design.md` sections 2.1 (schema), 2.2 (agent_uuid retrofit), 2.3 (web API), 2.4 (components), 2.7 (cron).

**Out of scope (Phase 3 or agent repo):**
- Agent code changes (parallel work by user)
- DROP TABLE print_queue (Phase 3)
- Removing old `/api/print/queue/*` routes (Phase 3)

---

## File structure

| File | Aksi | Tanggung jawab |
|---|---|---|
| `supabase/migrations/0011a_agent_heartbeats_agent_uuid.sql` | CREATE (retrofit) | Commit existing Supabase column to repo |
| `supabase/migrations/0018_print_history.sql` | CREATE | Tabel print_history (audit-only, agent writes) |
| `supabase/migrations/0019_agent_heartbeats_status.sql` | CREATE | Kolom status + index |
| `supabase/migrations/0020_mark_items_printed_history_trigger.sql` | CREATE | Drop old print_queue trigger, add print_history trigger |
| `lib/fcm.ts` | MODIFY | Tambah field `tx_id`, `item_ids` ke payload `job` |
| `app/api/print/send/_schema.ts` | CREATE | Zod schema untuk payload |
| `app/api/print/send/_schema.test.ts` | CREATE | Test Zod schema |
| `app/api/print/send/route.ts` | CREATE | POST: cek agent online → fan-out FCM → return 200/503 |
| `app/api/print/history/route.ts` | CREATE | GET print_history for debug page |
| `app/api/agent/heartbeat/route.ts` | MODIFY | Use status column + 90s threshold |
| `components/printer-status-banner.tsx` | MODIFY | Render based on `status='online'` (no change needed if banner uses heartbeat API) |
| `components/reprint-card.tsx` | MODIFY | Switch endpoint to `/api/print/send`, handle 503 |
| `components/nota-review-form.tsx` | MODIFY | Switch endpoint to `/api/print/send`, handle 503 |
| `components/test-print-dialog.tsx` | MODIFY | Switch endpoint to `/api/print/send` |
| `app/(app)/setup/printer/debug/page.tsx` | MODIFY | Switch source from `print_queue` → `print_history` |
| `app/api/cron/cleanup/route.ts` | MODIFY | Extend untuk hapus print_history >7 hari |

---

## Conventions

Same as Phase 1: Zod at boundaries, wide-event logger `newEvent()` di setiap route, `getSupabaseServer().auth.getUser()` auth check, `npm run test`, `npm run build`, `npm run lint`.

---

# Task 1: Pre-flight — commit retrofit migration agent_uuid

**Files:**
- Create: `supabase/migrations/0011a_agent_heartbeats_agent_uuid.sql`

Agent code dan `app/api/print/queue/route.ts:62` sudah pakai `agent_uuid` kolom yang ada di Supabase tapi belum di-commit ke repo.

- [ ] **Step 1: Konfirmasi kolom existed di Supabase**

Pakai MCP `mcp__plugin_supabase_supabase__execute_sql` project_id `nqptpijfrccjuytrslwc`:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name='agent_heartbeats' AND column_name='agent_uuid';
```

Expected: 1 row, type `text`, nullable yes.

- [ ] **Step 2: Tulis retrofit migration**

```sql
-- 0011a_agent_heartbeats_agent_uuid.sql
-- Retrofit: kolom ini sudah ada di Supabase (dipakai agent app via
-- onConflict='agent_uuid' upsert) tapi belum di-commit ke repo.
-- IF NOT EXISTS supaya bisa re-apply tanpa side effect.
ALTER TABLE agent_heartbeats
  ADD COLUMN IF NOT EXISTS agent_uuid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS agent_heartbeats_agent_uuid_idx
  ON agent_heartbeats (agent_uuid)
  WHERE agent_uuid IS NOT NULL;
```

- [ ] **Step 3: Apply via MCP**

`mcp__plugin_supabase_supabase__apply_migration` name `agent_heartbeats_agent_uuid_retrofit`. Should be no-op against current DB (column already exists) — apply just to record in migration history.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0011a_agent_heartbeats_agent_uuid.sql
git -c commit.gpgsign=false commit -m "feat(db): retrofit migration for agent_heartbeats.agent_uuid"
```

---

# Task 2: Migration 0018 — print_history table

**Files:**
- Create: `supabase/migrations/0018_print_history.sql`

- [ ] **Step 1: Tulis SQL**

```sql
-- 0018_print_history.sql
-- Audit log untuk print jobs. Agent INSERT ke sini setelah job selesai
-- (done/failed). Tidak ada intermediate 'processing' state.
-- bytes_b64 dipreserve supaya owner bisa "Retry" dari agent app.
CREATE TABLE print_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_id           uuid REFERENCES transactions(id) ON DELETE SET NULL,
  agent_id        uuid REFERENCES agent_heartbeats(id) ON DELETE SET NULL,
  agent_label     text,
  target          text NOT NULL CHECK (target IN ('dapur','minuman','customer')),
  trigger         text NOT NULL CHECK (trigger IN
                    ('auto','auto_additional','reprint','reprint_additional','customer','test')),
  item_ids        uuid[] NULL,
  bytes_b64       text NOT NULL,
  status          text NOT NULL CHECK (status IN ('done','failed')),
  failure_reason  text,
  done_at         timestamptz,
  failed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX print_history_recent_idx ON print_history (created_at DESC);
CREATE INDEX print_history_tx_idx ON print_history (tx_id);
CREATE INDEX print_history_failed_idx ON print_history (status, created_at DESC)
  WHERE status = 'failed';

ALTER TABLE print_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read print_history" ON print_history
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert print_history" ON print_history
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update print_history" ON print_history
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete print_history" ON print_history
  FOR DELETE TO authenticated USING (true);
```

- [ ] **Step 2: Apply via MCP**

Name `print_history`.

- [ ] **Step 3: Verifikasi schema + RLS**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='print_history' ORDER BY ordinal_position;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0018_print_history.sql
git -c commit.gpgsign=false commit -m "feat(db): add print_history table for audit + retry"
```

---

# Task 3: Migration 0019 — agent_heartbeats.status

**Files:**
- Create: `supabase/migrations/0019_agent_heartbeats_status.sql`

- [ ] **Step 1: Tulis SQL**

```sql
-- 0019_agent_heartbeats_status.sql
-- Explicit online/offline state. Set ke 'online' saat Start button ditekan,
-- 'offline' saat Stop ditekan atau service destroyed.
ALTER TABLE agent_heartbeats
  ADD COLUMN status text NOT NULL DEFAULT 'offline'
              CHECK (status IN ('online','offline'));

CREATE INDEX agent_heartbeats_online_idx
  ON agent_heartbeats (status, last_seen_at DESC)
  WHERE status = 'online';
```

- [ ] **Step 2: Apply via MCP**

Name `agent_heartbeats_status`.

- [ ] **Step 3: Verifikasi**

```sql
SELECT column_name, column_default FROM information_schema.columns
WHERE table_name='agent_heartbeats' AND column_name='status';
```

Expected: default `'offline'::text`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0019_agent_heartbeats_status.sql
git -c commit.gpgsign=false commit -m "feat(db): add agent_heartbeats.status (online/offline)"
```

---

# Task 4: Migration 0020 — swap trigger to print_history

**Files:**
- Create: `supabase/migrations/0020_mark_items_printed_history_trigger.sql`

- [ ] **Step 1: Tulis SQL**

```sql
-- 0020_mark_items_printed_history_trigger.sql
-- Drop Phase 1 trigger (basis: print_queue.status='done' transition).
DROP TRIGGER IF EXISTS trg_print_queue_mark_items ON print_queue;
DROP FUNCTION IF EXISTS mark_items_printed_queue();

-- Versi Phase 2: basis print_history (agent insert dengan status final).
-- Agent insert dengan status='done' atau 'failed' langsung — tidak ada
-- intermediate state. Trigger AFTER INSERT cukup.
CREATE OR REPLACE FUNCTION mark_items_printed_history() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'done'
     AND NEW.item_ids IS NOT NULL
     AND NEW.tx_id IS NOT NULL THEN
    IF NEW.target = 'dapur' THEN
      UPDATE transaction_items
        SET printed_dapur_at = COALESCE(NEW.done_at, now())
        WHERE id = ANY(NEW.item_ids)
          AND transaction_id = NEW.tx_id;
    ELSIF NEW.target = 'minuman' THEN
      UPDATE transaction_items
        SET printed_minuman_at = COALESCE(NEW.done_at, now())
        WHERE id = ANY(NEW.item_ids)
          AND transaction_id = NEW.tx_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_print_history_mark_items
AFTER INSERT ON print_history
FOR EACH ROW EXECUTE FUNCTION mark_items_printed_history();
```

- [ ] **Step 2: Apply via MCP**

Name `mark_items_printed_history_trigger`.

- [ ] **Step 3: Smoke test trigger**

Pakai existing confirmed tx. Insert print_history row:

```sql
WITH latest_confirmed AS (
  SELECT t.id AS tx_id, array_agg(ti.id) AS item_ids
  FROM transactions t JOIN transaction_items ti ON ti.transaction_id = t.id
  WHERE t.status = 'confirmed' AND t.deleted_at IS NULL
    AND ti.printed_dapur_at IS NULL
  GROUP BY t.id
  ORDER BY t.created_at DESC LIMIT 1
)
INSERT INTO print_history (tx_id, target, trigger, item_ids, bytes_b64, status, done_at)
SELECT tx_id, 'dapur', 'reprint', item_ids, 'dGVzdA==', 'done', now()
FROM latest_confirmed
RETURNING id, tx_id, item_ids;
```

Lalu cek flag ter-set:

```sql
SELECT id, printed_dapur_at FROM transaction_items
WHERE transaction_id = '<tx_id from above>' LIMIT 5;
```

Bersihkan:

```sql
DELETE FROM print_history WHERE id = '<id from above>';
UPDATE transaction_items SET printed_dapur_at = NULL WHERE transaction_id = '<tx_id>';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0020_mark_items_printed_history_trigger.sql
git -c commit.gpgsign=false commit -m "feat(db): swap mark_items_printed trigger to print_history"
```

---

# Task 5: Extend lib/fcm.ts payload

**Files:**
- Modify: `lib/fcm.ts`

- [ ] **Step 1: Update `PushAgentArgs.job` shape**

Locate type `PushAgentArgs`. Replace the `job?: { ... }` field with:

```ts
  /**
   * Inline job payload — sent in FCM data so the agent can process the
   * print without needing a follow-up Supabase fetch. Agent ignores empty
   * `tx_id` (sentinel for test print). `item_ids` JSON-encoded as string array.
   */
  job?: {
    id: string;
    tx_id: string | null;
    target: 'dapur' | 'minuman' | 'customer';
    trigger: 'auto' | 'auto_additional' | 'reprint' | 'reprint_additional' | 'customer' | 'test';
    item_ids: string[] | null;
    bytes_b64: string;
  };
```

- [ ] **Step 2: Update `data` payload builder**

Locate `const data: Record<string, string> = args.job ? { ... } : { action: 'check_queue' };`. Replace with:

```ts
  const data: Record<string, string> = args.job
    ? {
        action: 'print_job',
        job_id: args.job.id,
        tx_id: args.job.tx_id ?? '',
        target: args.job.target,
        trigger: args.job.trigger,
        item_ids: JSON.stringify(args.job.item_ids ?? []),
        bytes_b64: args.job.bytes_b64,
      }
    : { action: 'check_queue' };
```

- [ ] **Step 3: Verifikasi build**

```bash
npm run build 2>&1 | grep -E "Error|error" | head -10
```

Expected: type errors di `app/api/print/queue/route.ts` (still passing old shape) — those will be addressed when route is deprecated (Phase 3). For now, fix only NEW errors related to this change. The old `/api/print/queue/route.ts` should still build because `tx_id`, `item_ids` are optional we're adding new keys — verify build is still clean.

Kalau ada error baru dari lib/fcm.ts itself, fix dulu.

- [ ] **Step 4: Commit**

```bash
git add lib/fcm.ts
git -c commit.gpgsign=false commit -m "feat(fcm): extend payload with tx_id + item_ids"
```

---

# Task 6: TDD — /api/print/send schema

**Files:**
- Create: `app/api/print/send/_schema.ts`
- Create: `app/api/print/send/_schema.test.ts`

- [ ] **Step 1: Tulis test file**

```ts
import { describe, it, expect } from 'vitest';
import { PrintSendSchema } from './_schema';

describe('PrintSendSchema', () => {
  const valid = {
    tx_id: '11111111-1111-4111-8111-111111111111',
    target: 'dapur' as const,
    trigger: 'auto' as const,
    item_ids: ['22222222-2222-4222-8222-222222222222'],
    bytes_b64: 'G0BISQ==',
  };

  it('accepts valid payload', () => {
    expect(PrintSendSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts null tx_id (test print)', () => {
    expect(PrintSendSchema.safeParse({ ...valid, tx_id: null }).success).toBe(true);
  });

  it('accepts null item_ids (customer or test)', () => {
    expect(PrintSendSchema.safeParse({ ...valid, item_ids: null }).success).toBe(true);
  });

  it('accepts target=customer trigger=customer', () => {
    expect(PrintSendSchema.safeParse({ ...valid, target: 'customer', trigger: 'customer', item_ids: null }).success).toBe(true);
  });

  it('accepts trigger=auto_additional', () => {
    expect(PrintSendSchema.safeParse({ ...valid, trigger: 'auto_additional' }).success).toBe(true);
  });

  it('rejects invalid target', () => {
    expect(PrintSendSchema.safeParse({ ...valid, target: 'kitchen' }).success).toBe(false);
  });

  it('rejects empty bytes_b64', () => {
    expect(PrintSendSchema.safeParse({ ...valid, bytes_b64: '' }).success).toBe(false);
  });

  it('strict — rejects extra fields', () => {
    expect(PrintSendSchema.safeParse({ ...valid, extra: 'foo' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm run test -- print/send
```

Expected: fail (schema doesn't exist).

- [ ] **Step 3: Implement schema**

Create `app/api/print/send/_schema.ts`:

```ts
import { z } from 'zod';

export const PrintSendSchema = z.object({
  tx_id: z.string().uuid().nullable(),
  target: z.enum(['dapur', 'minuman', 'customer']),
  trigger: z.enum([
    'auto',
    'auto_additional',
    'reprint',
    'reprint_additional',
    'customer',
    'test',
  ]),
  item_ids: z.array(z.string().uuid()).nullable(),
  bytes_b64: z.string().min(1),
}).strict();

export type PrintSendInput = z.infer<typeof PrintSendSchema>;
```

- [ ] **Step 4: Run, verify pass**

```bash
npm run test -- print/send
```

- [ ] **Step 5: Commit**

```bash
git add app/api/print/send/_schema.ts app/api/print/send/_schema.test.ts
git -c commit.gpgsign=false commit -m "feat(api): add print/send schema (Phase 2 FCM dispatch)"
```

---

# Task 7: Implement POST /api/print/send

**Files:**
- Create: `app/api/print/send/route.ts`

- [ ] **Step 1: Implement route**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { pushCheckQueue } from '@/lib/fcm';
import { PrintSendSchema } from './_schema';

// Sesuai keputusan spec section 2.3: 90s threshold = heartbeat 30s × 3 ticks.
const ONLINE_THRESHOLD_SECONDS = 90;

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/print/send');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = PrintSendSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ validation_errors: parsed.error.flatten() });
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    const payload = parsed.data;

    const job_id = randomUUID();
    evt.merge({
      job_id,
      tx_id: payload.tx_id,
      target: payload.target,
      trigger: payload.trigger,
      bytes_size: payload.bytes_b64.length,
      item_ids_count: payload.item_ids?.length ?? 0,
    });

    // Find agents currently online (explicit state + recent heartbeat).
    const threshold = new Date(Date.now() - ONLINE_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: agents, error: queryErr } = await supabase
      .from('agent_heartbeats')
      .select('agent_label, fcm_token')
      .eq('status', 'online')
      .gte('last_seen_at', threshold)
      .not('fcm_token', 'is', null);
    if (queryErr) {
      tagStatus(evt, 500);
      evt.error(queryErr);
      return NextResponse.json({ error: queryErr.message }, { status: 500 });
    }

    const targets = (agents ?? []).filter(
      (a): a is { agent_label: string; fcm_token: string } =>
        typeof a.fcm_token === 'string' && a.fcm_token.length > 0,
    );

    if (targets.length === 0) {
      tagStatus(evt, 503);
      evt.set('reject_reason', 'agent_offline');
      return NextResponse.json(
        { error: 'agent_offline', detail: 'no online agent available' },
        { status: 503 },
      );
    }
    evt.set('dispatched_to', targets.map((t) => t.agent_label));

    // Fire-and-forget FCM push. Cleanup invalid tokens on the side.
    pushCheckQueue({
      tokens: targets.map((t) => t.fcm_token),
      job: {
        id: job_id,
        tx_id: payload.tx_id,
        target: payload.target,
        trigger: payload.trigger,
        item_ids: payload.item_ids,
        bytes_b64: payload.bytes_b64,
      },
    }).then(
      async (r) => {
        console.log(`[fcm] push ok=${r.ok} failed=${r.failed}`);
        if (r.invalidTokens.length > 0) {
          await supabase
            .from('agent_heartbeats')
            .update({ fcm_token: null })
            .in('fcm_token', r.invalidTokens);
          console.log(`[fcm] cleared ${r.invalidTokens.length} stale token(s)`);
        }
      },
      (e) => console.warn('[fcm] push error', e),
    );

    tagStatus(evt, 200);
    return NextResponse.json({
      job_id,
      dispatched_to: targets.map((t) => t.agent_label),
    });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -10
```

Expected: success.

- [ ] **Step 3: Commit**

```bash
git add app/api/print/send/route.ts
git -c commit.gpgsign=false commit -m "feat(api): POST /api/print/send (FCM dispatch + 90s online check)"
```

---

# Task 8: GET /api/print/history (replaces /queue/recent untuk debug page)

**Files:**
- Create: `app/api/print/history/route.ts`

- [ ] **Step 1: Implement route**

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/print/history');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200);
    const statusFilter = searchParams.get('status'); // 'done' | 'failed' | null
    const txFilter = searchParams.get('tx_id');

    let query = supabase
      .from('print_history')
      .select('id, tx_id, agent_label, target, trigger, status, failure_reason, created_at, done_at, failed_at, transactions(customer_name, table_no, daily_seq)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (statusFilter === 'done' || statusFilter === 'failed') {
      query = query.eq('status', statusFilter);
    }
    if (txFilter) {
      query = query.eq('tx_id', txFilter);
    }

    const { data, error } = await query;
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    type Row = {
      id: string;
      tx_id: string | null;
      agent_label: string | null;
      target: string;
      trigger: string;
      status: string;
      failure_reason: string | null;
      created_at: string;
      done_at: string | null;
      failed_at: string | null;
      transactions: { customer_name: string | null; table_no: string | null; daily_seq: number | null } | null;
    };

    const rows = (data ?? []).map((row) => {
      const r = row as Row;
      const tx = r.transactions;
      return {
        id: r.id,
        tx_id: r.tx_id,
        agent_label: r.agent_label,
        target: r.target,
        trigger: r.trigger,
        status: r.status,
        failure_reason: r.failure_reason,
        created_at: r.created_at,
        done_at: r.done_at,
        failed_at: r.failed_at,
        customer_name: tx?.customer_name ?? null,
        table_no: tx?.table_no ?? null,
        daily_seq: tx?.daily_seq ?? null,
      };
    });

    evt.merge({ rows_count: rows.length });
    tagStatus(evt, 200);
    return NextResponse.json({ jobs: rows });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add app/api/print/history/route.ts
git -c commit.gpgsign=false commit -m "feat(api): GET /api/print/history (replaces /queue/recent)"
```

---

# Task 9: Tighten /api/agent/heartbeat — explicit status + 90s

**Files:**
- Modify: `app/api/agent/heartbeat/route.ts`

- [ ] **Step 1: Replace route content**

Edit `app/api/agent/heartbeat/route.ts`. Replace existing content with:

```ts
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

// 90s = heartbeat 30s × 3 ticks toleransi (sesuai spec 2.3).
const ONLINE_THRESHOLD_MS = 90 * 1000;

export async function GET() {
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
      .select('agent_label, last_seen_at, agent_version, device_info, status')
      .order('last_seen_at', { ascending: false });
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const now = Date.now();
    const agents = (data ?? []).map((a) => ({
      agent_label: a.agent_label,
      last_seen_at: a.last_seen_at,
      agent_version: a.agent_version,
      device_info: a.device_info,
      status: a.status,
      // Online: status='online' AND heartbeat recent. Either condition alone
      // is insufficient — stale status='online' (crash) or fresh heartbeat
      // tanpa start (legacy build) both = false.
      online: a.status === 'online' && now - new Date(a.last_seen_at).getTime() < ONLINE_THRESHOLD_MS,
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

- [ ] **Step 2: Update `PrinterStatusBanner` type kalau perlu**

Cek `components/printer-status-banner.tsx`. Tambahkan `status: string` ke type `Agent` di file itu (line ~5). Tidak perlu render change — banner masih hide ketika ada agent online, dan logika `online` di-compute server-side, jadi banner tidak butuh logic change.

```ts
type Agent = {
  agent_label: string;
  last_seen_at: string;
  agent_version: string | null;
  device_info: string | null;
  status: string;       // NEW
  online: boolean;
};
```

- [ ] **Step 3: Build verify**

```bash
npm run build 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add app/api/agent/heartbeat/route.ts components/printer-status-banner.tsx
git -c commit.gpgsign=false commit -m "feat(agent): explicit status=online check + 90s threshold"
```

---

# Task 10: Switch component endpoints `queue` → `send`

**Files:**
- Modify: `components/reprint-card.tsx`
- Modify: `components/nota-review-form.tsx`
- Modify: `components/test-print-dialog.tsx`

- [ ] **Step 1: reprint-card.tsx — change endpoint + handle 503**

In `components/reprint-card.tsx`, locate `await fetch('/api/print/queue', ...)`. Replace with `'/api/print/send'`.

After the fetch, locate the existing error parsing block:

```ts
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: (data as { error?: string }).error ?? `HTTP ${res.status}` };
    }
```

Replace with:

```ts
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = (data as { error?: string }).error ?? `HTTP ${res.status}`;
      // 503 = agent_offline: special handling supaya UX bisa show toast tertentu.
      const isOffline = res.status === 503 && err === 'agent_offline';
      return { ok: false, error: isOffline ? 'agent_offline' : err };
    }
```

Locate the 4 toast handlers (`fireAdditional`, `fireReprintTarget`, `fireReprintBoth`, `fireCustomer`). For the failure branches, add a check for `f.error === 'agent_offline'`:

Pattern — wherever you have:
```ts
else toast.error(`${ok.length} sukses, ${fail.length} gagal: ${fail.map((f) => `${f.target}=${f.error}`).join(', ')}`);
```

Replace with:
```ts
else {
  const offline = fail.some((f) => f.error === 'agent_offline');
  if (offline) {
    toast.warning('Agent printer offline', {
      description: 'Nyalakan agent di Android dulu, lalu coba lagi.',
      duration: 8000,
    });
  } else {
    toast.error(`${ok.length} sukses, ${fail.length} gagal: ${fail.map((f) => `${f.target}=${f.error}`).join(', ')}`);
  }
}
```

For single-job fires (`fireReprintTarget`, `fireCustomer`), replace:
```ts
else toast.error(`Gagal kirim job ${target}: ${result.error}`);
```
with:
```ts
else if (result.error === 'agent_offline') {
  toast.warning('Agent printer offline', { description: 'Nyalakan agent di Android dulu, lalu coba lagi.', duration: 8000 });
} else {
  toast.error(`Gagal kirim job ${target}: ${result.error}`);
}
```

Run tests:

```bash
npm run test -- reprint-card
```

Expected: existing tests pass (mocks return 201).

- [ ] **Step 2: nota-review-form.tsx — change endpoint**

Locate `await fetch('/api/print/queue', ...)` in `submitPrintJob`. Replace with `'/api/print/send'`.

In `handleConfirm`, locate the toast block:
```ts
      if (results.length === 0) {
        toast.success('Nota tersimpan (tidak ada item baru untuk dicetak)');
      } else if (failed.length === 0) {
        ...
      } else {
        toast.success('Nota tersimpan');
        toast.error(`Gagal kirim print job ke: ${failed.join(', ')}. ...`);
      }
```

To make 503 distinguishable, refactor `submitPrintJob` to return `{ ok: boolean; offline: boolean }`:

```ts
async function submitPrintJob(args: { ... }): Promise<{ ok: boolean; offline: boolean }> {
  ...
  try {
    const res = await fetch('/api/print/send', { ... });
    if (res.ok) return { ok: true, offline: false };
    return { ok: false, offline: res.status === 503 };
  } catch {
    return { ok: false, offline: false };
  }
}
```

Update call sites in handleConfirm:
```ts
      const submitJobs: Promise<{ target: PrinterTarget; ok: boolean; offline: boolean }>[] = [];
      if (dapurItems.length > 0) {
        submitJobs.push(
          submitPrintJob({ ... }).then((r) => ({ ...r, target: 'dapur' as const })),
        );
      }
      // ... same for minumanItems
      const results = await Promise.all(submitJobs);
      const succeeded = results.filter((r) => r.ok).map((r) => r.target);
      const failed = results.filter((r) => !r.ok);
      const offlineCount = failed.filter((f) => f.offline).length;

      if (results.length === 0) {
        toast.success('Nota tersimpan (tidak ada item baru untuk dicetak)');
      } else if (failed.length === 0) {
        const action = wasConfirmedBefore ? 'tambahan' : 'cetak';
        toast.success(`Nota tersimpan, ${succeeded.length} print job ${action} dikirim ke agent`);
      } else if (offlineCount > 0) {
        toast.success('Nota tersimpan');
        toast.warning('Agent printer offline. Nyalakan agent lalu klik Cetak tambahan dari halaman detail.', { duration: 10000 });
      } else {
        toast.success('Nota tersimpan');
        toast.error(`Gagal kirim print job ke: ${failed.map((f) => f.target).join(', ')}. Coba reprint manual dari halaman detail.`);
      }
```

- [ ] **Step 3: test-print-dialog.tsx — change endpoint**

Replace `/api/print/queue` with `/api/print/send`. The body already includes `item_ids: null` (from Phase 1 patch).

- [ ] **Step 4: Build + test**

```bash
npm run build
npm run test
```

Expected: 141+ tests pass, build clean.

- [ ] **Step 5: Commit**

```bash
git add components/reprint-card.tsx components/nota-review-form.tsx components/test-print-dialog.tsx
git -c commit.gpgsign=false commit -m "feat(client): switch print endpoints to /api/print/send + handle 503 agent_offline"
```

---

# Task 11: Debug page — read from print_history

**Files:**
- Modify: `app/(app)/setup/printer/debug/page.tsx`

- [ ] **Step 1: Replace job source**

Locate `fetch('/api/print/queue/recent')` (atau setara). Replace dengan `fetch('/api/print/history')`.

Update the `Job` type to match new history shape:

```ts
type Job = {
  id: string;
  tx_id: string | null;
  target: 'dapur' | 'minuman' | 'customer';
  trigger: string;
  status: 'done' | 'failed';
  failure_reason: string | null;
  created_at: string;
  done_at: string | null;
  failed_at: string | null;
  customer_name: string | null;
  table_no: string | null;
  daily_seq: number | null;
  agent_label: string | null;
};
```

Remove any UI affordance for `retry` / `cancel` buttons (those operated on print_queue's `pending`/`failed` state; print_history doesn't support those transitions because agent owns it).

If the page has filter buttons like "All / Pending / Failed", change to "All / Done / Failed" (no pending in history).

Show `agent_label` in the row (it's preserved across job lifecycle now).

- [ ] **Step 2: Update display fields**

Where the old code rendered `completed_at`, choose `done_at ?? failed_at` for display.

Where rendered `picked_up_at` (only in queue, not history) — remove or replace with `created_at`.

- [ ] **Step 3: Build + visual smoke test**

```bash
npm run dev
```

Open http://localhost:3000/setup/printer/debug. Verify page renders without errors. Empty list initially (no print_history rows until agent inserts).

- [ ] **Step 4: Commit**

```bash
git add 'app/(app)/setup/printer/debug/page.tsx'
git -c commit.gpgsign=false commit -m "feat(debug): switch print debug page source from print_queue to print_history"
```

---

# Task 12: Extend cron cleanup for print_history

**Files:**
- Modify: `app/api/cron/cleanup/route.ts`

- [ ] **Step 1: Append print_history cleanup**

Edit `app/api/cron/cleanup/route.ts`. Locate the existing print_queue cleanup block:

```ts
    // — TAMBAHAN: cleanup print_queue done/failed > 7 hari —
    const { count: queueDeletedCount, error: queueDeleteErr } = await supabase
      .from('print_queue')
      .delete({ count: 'exact' })
      .in('status', ['done', 'failed'])
      .lt('created_at', cutoff);
    if (queueDeleteErr) {
      evt.warn(`print_queue cleanup error: ${queueDeleteErr.message}`);
    } else {
      evt.set('print_queue_deleted', queueDeletedCount ?? 0);
    }
```

Right after that block (before `tagStatus(evt, 200)`), add:

```ts
    // — TAMBAHAN Phase 2: cleanup print_history > 7 hari —
    // History selalu final state (done/failed) — no pending. Hapus apa pun > 7 hari.
    const { count: historyDeletedCount, error: historyDeleteErr } = await supabase
      .from('print_history')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff);
    if (historyDeleteErr) {
      evt.warn(`print_history cleanup error: ${historyDeleteErr.message}`);
    } else {
      evt.set('print_history_deleted', historyDeletedCount ?? 0);
    }
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/cleanup/route.ts
git -c commit.gpgsign=false commit -m "feat(cron): cleanup print_history >7 days alongside print_queue"
```

---

# Task 13: Final web verification

**Files:** none

- [ ] **Step 1: Full test/build/lint**

```bash
npm run test
npm run build
npm run lint
```

Expected: all pass.

- [ ] **Step 2: Smoke test dispatch (without agent)**

```bash
npm run dev
```

Login. Open a confirmed transaction. Click "Cetak ulang Dapur".

Expected: toast warning "Agent printer offline" (because no agent in DB has `status='online'`).

In DevTools Network, verify:
- Request goes to `/api/print/send`
- Body includes `tx_id`, `target`, `trigger`, `item_ids`, `bytes_b64`
- Response status 503, body `{error: "agent_offline", detail: "no online agent available"}`

- [ ] **Step 3: Manual flag agent online + retry**

Pakai SQL (MCP `execute_sql`):

```sql
-- Pick latest agent that has fcm_token, mark online
UPDATE agent_heartbeats
  SET status='online', last_seen_at=now()
  WHERE fcm_token IS NOT NULL
  AND id = (SELECT id FROM agent_heartbeats WHERE fcm_token IS NOT NULL ORDER BY last_seen_at DESC LIMIT 1);
```

Trigger "Cetak ulang Dapur" lagi. Expected: response 200 dengan `job_id`. (FCM akan delivered ke agent — if agent code Phase 2 sudah ready, it'll insert print_history. If not, just verify the 200.)

- [ ] **Step 4: Rollback online flag setelah smoke test**

```sql
UPDATE agent_heartbeats SET status='offline' WHERE status='online';
```

- [ ] **Step 5: Tag complete**

Web side Phase 2 ready. Pending agent code completion + E2E test.

---

# Out of scope (handled separately)

- ❌ Agent code (separate repo, parallel work by owner)
- ❌ `print_queue` table DROP (Phase 3)
- ❌ Remove `/api/print/queue/*` routes (Phase 3)
- ❌ `lib/fcm.ts` legacy `check_queue` action removal (Phase 3)
