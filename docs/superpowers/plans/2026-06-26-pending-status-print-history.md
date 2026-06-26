# Pending Status di Print History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web INSERT pending row sebelum kirim FCM; agent UPDATE row saat selesai (bukan INSERT). Polling fallback di primary agent kalau FCM hilang. Cron sweep mark stale pending sebagai failed.

**Architecture:** Add `'pending'` ke `print_history.status` check; swap trigger dari `AFTER INSERT` ke `AFTER UPDATE OF status` (pending→done fires `mark_items_printed_history`). Web `POST /api/print/send` insert pending kemudian fan-out FCM. Agent (di `pak-pon-print-agent` repo) refactor `HistoryWriter` interface: `insertDone/insertFailed` → `markDone/markFailed` (UPDATE WHERE status='pending'). New `PendingJobPoller` jalan tiap 60s di primary device. Existing `JobProcessor.inFlight` set sudah jadi dedup buat FCM × poll race.

**Tech Stack:** Next.js 16 (web), Supabase Postgres (migration + RPC), Kotlin/Android (agent — `kotlinx.coroutines`, `supabase-kt`, Compose), Vitest (web tests), JUnit (agent tests).

**Spec referensi:** [`docs/superpowers/specs/2026-06-26-pending-status-print-history-design.md`](../specs/2026-06-26-pending-status-print-history-design.md)

**Repos:**
- Web: `/home/brondol/Downloads/pak-pon` — branch `feat/primary-agent-selection` (build on top, don't branch from master)
- Agent: `/home/brondol/Downloads/pak-pon-print-agent` — branch baru `feat/pending-status-poll` dari master

---

## File Structure

### Web (pak-pon)

| Path | Action | Tujuan |
|---|---|---|
| `supabase/migrations/0025_print_history_pending_status.sql` | Create | Status constraint allow `pending` + partial index |
| `supabase/migrations/0026_mark_items_printed_on_update.sql` | Create | Trigger swap INSERT→UPDATE OF status |
| `app/api/print/send/route.ts` | Modify | INSERT pending sebelum push FCM |
| `app/api/cron/print-sweep/route.ts` | Create | Sweep pending >5min → failed |
| `vercel.json` | Modify | Tambah cron schedule */5 min |
| `app/(app)/setup/printer/debug/page.tsx` | Modify | Type union pending, counter, badge |
| `CLAUDE.md` | Modify | Catat new flow di Print system section |

### Agent (pak-pon-print-agent)

| Path | Action | Tujuan |
|---|---|---|
| `app/src/main/kotlin/com/pakpon/printagent/data/print/PrintHistoryRepository.kt` | Modify | `HistoryWriter` interface → `markDone`/`markFailed`; impl pakai UPDATE + claim `.eq("status", "pending")`. Tambah `fetchPending` |
| `app/src/main/kotlin/com/pakpon/printagent/data/heartbeat/HeartbeatRepository.kt` | Modify | Tambah `amIPrimary()` helper |
| `app/src/main/kotlin/com/pakpon/printagent/service/JobProcessor.kt` | Modify | Ganti `insertDone/insertFailed` → `markDone/markFailed` |
| `app/src/main/kotlin/com/pakpon/printagent/service/PendingJobPoller.kt` | Create | Background poll loop |
| `app/src/main/kotlin/com/pakpon/printagent/di/ServiceLocator.kt` | Modify | Register `pendingJobPoller` |
| `app/src/main/kotlin/com/pakpon/printagent/service/PrintAgentService.kt` | Modify | Start/stop poller di lifecycle |
| `app/src/main/kotlin/com/pakpon/printagent/ui/main/MainViewModel.kt` | Modify | `checkPending()` method |
| `app/src/main/kotlin/com/pakpon/printagent/ui/main/MainScreen.kt` (atau Activity Compose) | Modify | Button "Cek pending" |
| `app/src/test/kotlin/com/pakpon/printagent/service/JobProcessorTest.kt` | Modify | Update asserts `markDone/markFailed` instead of insert |
| `app/src/test/kotlin/com/pakpon/printagent/service/PendingJobPollerTest.kt` | Create | Poller unit test |

---

## Task 1: Web migration 0025 + 0026

**Files:**
- Create: `/home/brondol/Downloads/pak-pon/supabase/migrations/0025_print_history_pending_status.sql`
- Create: `/home/brondol/Downloads/pak-pon/supabase/migrations/0026_mark_items_printed_on_update.sql`

**Pre-flight:** Verifikasi current state remote Supabase via MCP `mcp__plugin_supabase_supabase__execute_sql`:

```sql
SELECT consrc FROM pg_constraint
WHERE conname='print_history_status_check';
-- Expected: CHECK ((status = ANY (ARRAY['done'::text, 'failed'::text])))

SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgrelid='print_history'::regclass AND NOT tgisinternal;
-- Expected: trg_print_history_mark_items AFTER INSERT
```

- [ ] **Step 1: Tulis migration 0025**

Path: `/home/brondol/Downloads/pak-pon/supabase/migrations/0025_print_history_pending_status.sql`

```sql
-- 0025_print_history_pending_status.sql
-- Tambah 'pending' state ke print_history. Web INSERT pending sebelum
-- kirim FCM (proof of dispatch + visibility), agent UPDATE saat selesai.
-- Lihat docs/superpowers/specs/2026-06-26-pending-status-print-history-design.md

ALTER TABLE print_history DROP CONSTRAINT IF EXISTS print_history_status_check;
ALTER TABLE print_history ADD CONSTRAINT print_history_status_check
  CHECK (status IN ('pending','done','failed'));

-- Partial index buat poll query agent + cron sweep. Karena mayoritas
-- baris done/failed, partial WHERE status='pending' bikin index kecil.
CREATE INDEX IF NOT EXISTS print_history_pending_idx
  ON print_history (created_at)
  WHERE status = 'pending';
```

- [ ] **Step 2: Tulis migration 0026**

Path: `/home/brondol/Downloads/pak-pon/supabase/migrations/0026_mark_items_printed_on_update.sql`

```sql
-- 0026_mark_items_printed_on_update.sql
-- Trigger sebelumnya AFTER INSERT (agent INSERT row done langsung).
-- Sekarang flow: web INSERT pending → agent UPDATE done. Trigger pindah
-- ke AFTER UPDATE OF status, fire saat OLD='pending' AND NEW='done'.

DROP TRIGGER IF EXISTS trg_print_history_mark_items ON print_history;

CREATE OR REPLACE FUNCTION mark_items_printed_history() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'done'
     AND OLD.status = 'pending'
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
AFTER UPDATE OF status ON print_history
FOR EACH ROW EXECUTE FUNCTION mark_items_printed_history();
```

- [ ] **Step 3: Apply 0025 ke remote Supabase**

Pakai MCP:
```
mcp__plugin_supabase_supabase__apply_migration
  project_id: nqptpijfrccjuytrslwc
  name: print_history_pending_status
  query: <isi 0025>
```

- [ ] **Step 4: Apply 0026 ke remote Supabase**

```
mcp__plugin_supabase_supabase__apply_migration
  project_id: nqptpijfrccjuytrslwc
  name: mark_items_printed_on_update
  query: <isi 0026>
```

- [ ] **Step 5: Verifikasi via MCP**

```sql
-- Constraint updated
SELECT consrc FROM pg_constraint WHERE conname='print_history_status_check';
-- Expected: includes 'pending'

-- Partial index ada
SELECT indexname FROM pg_indexes
WHERE indexname='print_history_pending_idx';
-- Expected: 1 row

-- Trigger sekarang AFTER UPDATE OF status
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgrelid='print_history'::regclass AND NOT tgisinternal;
-- Expected: trg_print_history_mark_items, AFTER UPDATE OF status
```

- [ ] **Step 6: Smoke test trigger semantics (dry-run on transient row)**

```sql
-- Insert pending row dummy
WITH dummy AS (
  INSERT INTO print_history (id, target, trigger, bytes_b64, status, item_ids, tx_id)
  VALUES ('00000000-0000-4000-8000-000000000099', 'dapur', 'test',
          'AA==', 'pending', NULL, NULL)
  RETURNING id
)
SELECT 'inserted' FROM dummy;

-- UPDATE → done. Trigger fires (but item_ids NULL → no transaction_items
-- updated, OK).
UPDATE print_history SET status='done', done_at=now()
WHERE id='00000000-0000-4000-8000-000000000099';

-- Cleanup
DELETE FROM print_history WHERE id='00000000-0000-4000-8000-000000000099';
```

- [ ] **Step 7: Commit**

```bash
cd /home/brondol/Downloads/pak-pon
git add supabase/migrations/0025_print_history_pending_status.sql supabase/migrations/0026_mark_items_printed_on_update.sql
git commit -m "feat(db): pending status + trigger AFTER UPDATE OF status"
```

---

## Task 2: Web — INSERT pending in `/api/print/send`

**Files:**
- Modify: `/home/brondol/Downloads/pak-pon/app/api/print/send/route.ts`

- [ ] **Step 1: Read current file to confirm structure**

Read `/home/brondol/Downloads/pak-pon/app/api/print/send/route.ts`. Tujuan: konfirmasi line POST handler, `targets` variable, dan posisi sebelum `pushPrintJob` call.

- [ ] **Step 2: Insert pending row block sebelum FCM dispatch**

Setelah `evt.set('dispatched_to', targets.map((t) => t.agent_label));` dan SEBELUM `pushPrintJob({...}).then(...)`, insert blok ini:

```ts
    // Insert pending row sebagai proof of dispatch. Polling agent juga
    // pakai row ini sebagai fallback kalau FCM ga nyampe.
    const primaryLabel = targets[0].agent_label;
    const { error: insertErr } = await supabase
      .from('print_history')
      .insert({
        id: job_id,
        tx_id: payload.tx_id,
        agent_label: primaryLabel,
        target: payload.target,
        trigger: payload.trigger,
        item_ids: payload.item_ids,
        bytes_b64: payload.bytes_b64,
        status: 'pending',
      });
    if (insertErr) {
      tagStatus(evt, 500);
      evt.error(insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
    evt.set('inserted_pending', true);
```

- [ ] **Step 3: Lint + build**

```bash
cd /home/brondol/Downloads/pak-pon
npm run lint
npm run build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /home/brondol/Downloads/pak-pon
git add app/api/print/send/route.ts
git commit -m "feat(print): insert pending row before FCM dispatch"
```

---

## Task 3: Web — cron sweep endpoint

**Files:**
- Create: `/home/brondol/Downloads/pak-pon/app/api/cron/print-sweep/route.ts`
- Modify: `/home/brondol/Downloads/pak-pon/vercel.json`

- [ ] **Step 1: Tulis sweep endpoint**

Path: `/home/brondol/Downloads/pak-pon/app/api/cron/print-sweep/route.ts`

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { newEvent, tagStatus } from '@/lib/logger';

const STALE_PENDING_MINUTES = 5;

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/cron/print-sweep');
  try {
    const authHeader = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
    if (!process.env.CRON_SECRET || authHeader !== expected) {
      tagStatus(evt, 401);
      evt.set('reject_reason', 'invalid_cron_token');
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const cutoff = new Date(Date.now() - STALE_PENDING_MINUTES * 60 * 1000).toISOString();
    evt.set('cutoff', cutoff);

    const supabase = getSupabaseAdmin();
    const { count: timeoutCount, error: timeoutErr } = await supabase
      .from('print_history')
      .update({
        status: 'failed',
        failure_reason: 'timeout: agent did not ack',
        failed_at: new Date().toISOString(),
      }, { count: 'exact' })
      .eq('status', 'pending')
      .lt('created_at', cutoff);

    if (timeoutErr) {
      tagStatus(evt, 500);
      evt.error(timeoutErr);
      return NextResponse.json({ error: timeoutErr.message }, { status: 500 });
    }

    evt.set('pending_timeout_count', timeoutCount ?? 0);
    tagStatus(evt, 200);
    return NextResponse.json({ timeout_count: timeoutCount ?? 0 });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 2: Tambah cron entry ke vercel.json**

Read current `vercel.json`:

```json
{
  "framework": "nextjs",
  "regions": ["sin1"],
  "functions": {
    "app/api/scan/route.ts": {
      "maxDuration": 60
    }
  },
  "crons": [
    {
      "path": "/api/cron/cleanup",
      "schedule": "0 19 * * *"
    }
  ]
}
```

Update `crons` array (add second entry):

```json
{
  "framework": "nextjs",
  "regions": ["sin1"],
  "functions": {
    "app/api/scan/route.ts": {
      "maxDuration": 60
    }
  },
  "crons": [
    {
      "path": "/api/cron/cleanup",
      "schedule": "0 19 * * *"
    },
    {
      "path": "/api/cron/print-sweep",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

- [ ] **Step 3: Lint + build**

```bash
cd /home/brondol/Downloads/pak-pon
npm run lint
npm run build
```

Expected: no errors, `/api/cron/print-sweep` listed di build output.

- [ ] **Step 4: Smoke test endpoint locally**

```bash
cd /home/brondol/Downloads/pak-pon
npm run dev &
sleep 5
# Replace <SECRET> with actual CRON_SECRET from .env.local
curl -H "Authorization: Bearer <SECRET>" http://localhost:3000/api/cron/print-sweep
# Expected: {"timeout_count": 0}  (atau N kalau ada pending lama)
kill %1
```

- [ ] **Step 5: Commit**

```bash
cd /home/brondol/Downloads/pak-pon
git add app/api/cron/print-sweep/route.ts vercel.json
git commit -m "feat(cron): sweep stale pending print jobs to failed"
```

---

## Task 4: Web — debug page pending UI + history filter

**Files:**
- Modify: `/home/brondol/Downloads/pak-pon/app/(app)/setup/printer/debug/page.tsx`
- Modify: `/home/brondol/Downloads/pak-pon/app/api/print/history/route.ts`

- [ ] **Step 1: Update `Job` type status union**

Find type definition (around line 18-32):

```tsx
type Job = {
  id: string;
  tx_id: string | null;
  target: 'dapur' | 'minuman' | 'customer';
  trigger: 'auto' | 'auto_additional' | 'reprint' | 'reprint_additional' | 'customer' | 'test';
  status: 'done' | 'failed';
  // ... rest
};
```

Change `status:` line to:
```tsx
  status: 'pending' | 'done' | 'failed';
```

- [ ] **Step 2: Update jobs counter section**

Find existing counter (around line 110-115):

```tsx
  const done = jobs.filter((j) => j.status === 'done');
  const failed = jobs.filter((j) => j.status === 'failed');
```

Add pending and update text:

```tsx
  const pending = jobs.filter((j) => j.status === 'pending');
  const done = jobs.filter((j) => j.status === 'done');
  const failed = jobs.filter((j) => j.status === 'failed');
```

Then find the paragraph showing counts (around line 185-189):

```tsx
        <p className="text-xs text-coal-soft">
          Failed: {failed.length} · Done: {done.length}.
          {failed.length > 0 && ' Untuk retry, buka agent app → tab History.'}
        </p>
```

Replace with:

```tsx
        <p className="text-xs text-coal-soft">
          Pending: {pending.length} · Failed: {failed.length} · Done: {done.length}.
          {failed.length > 0 && ' Untuk retry, buka agent app → tab History.'}
        </p>
```

- [ ] **Step 3: Update per-row status badge (mobile list)**

Find badge in mobile list (around line 200-211):

```tsx
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        j.status === 'done'
                          ? 'bg-leaf/15 text-leaf'
                          : 'bg-brick/15 text-brick'
                      }`}
                    >
                      {j.status}
                    </span>
```

Replace with:

```tsx
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                        j.status === 'done'
                          ? 'bg-leaf/15 text-leaf'
                          : j.status === 'pending'
                          ? 'bg-mustard/20 text-coal'
                          : 'bg-brick/15 text-brick'
                      }`}
                    >
                      {j.status}
                    </span>
```

- [ ] **Step 4: Update per-row status badge (desktop table)**

Find table cell badge (around line 256-260):

```tsx
                      <td className="p-2">
                        <span className={j.status === 'done' ? 'text-leaf' : 'text-brick'}>
                          {j.status}
                        </span>
                      </td>
```

Replace with:

```tsx
                      <td className="p-2">
                        <span className={
                          j.status === 'done' ? 'text-leaf' :
                          j.status === 'pending' ? 'text-coal-soft' :
                          'text-brick'
                        }>
                          {j.status}
                        </span>
                      </td>
```

- [ ] **Step 5: Update `/api/print/history` filter to accept `pending`**

Read `app/api/print/history/route.ts`. Find the filter check (around line 26):

```ts
if (statusFilter === 'done' || statusFilter === 'failed') {
  query = query.eq('status', statusFilter);
}
```

Replace with:

```ts
if (statusFilter === 'pending' || statusFilter === 'done' || statusFilter === 'failed') {
  query = query.eq('status', statusFilter);
}
```

Also update the comment near `statusFilter` declaration (around line 18) if it lists allowed values, to include `'pending'`.

- [ ] **Step 6: Lint + build**

```bash
cd /home/brondol/Downloads/pak-pon
npm run lint
npm run build
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd /home/brondol/Downloads/pak-pon
git add app/\(app\)/setup/printer/debug/page.tsx app/api/print/history/route.ts
git commit -m "ux(printer): show pending status + accept pending filter"
```

---

## Task 5: Agent — `HistoryWriter` interface refactor (UPDATE semantics)

**Files:**
- Modify: `/home/brondol/Downloads/pak-pon-print-agent/app/src/main/kotlin/com/pakpon/printagent/data/print/PrintHistoryRepository.kt`

**Branch setup (run once before this task):**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
git checkout -b feat/pending-status-poll
```

- [ ] **Step 1: Update `HistoryWriter` interface signature**

In the file, replace the interface definition (lines 8-15):

```kotlin
/**
 * Tulis-only surface yang JobProcessor pakai. Interface kecil ini bikin
 * unit test JobProcessor pakai fake tanpa perlu SupabaseClient.
 */
interface HistoryWriter {
    suspend fun insertDone(row: PrintHistoryInsert)
    suspend fun insertFailed(row: PrintHistoryInsert, reason: String)
}
```

With:

```kotlin
/**
 * Tulis-only surface yang JobProcessor pakai. Interface kecil ini bikin
 * unit test JobProcessor pakai fake tanpa perlu SupabaseClient.
 *
 * UPDATE semantics: row already exists (web insert pending). markX cuma
 * transition status. `.eq("status","pending")` claim filter = no-op kalau
 * row sudah ke-update worker lain atau ke-sweep timeout.
 */
interface HistoryWriter {
    suspend fun markDone(jobId: String, doneAt: String)
    suspend fun markFailed(jobId: String, reason: String, failedAt: String)
}
```

- [ ] **Step 2: Replace impl methods on `PrintHistoryRepository`**

Replace methods (lines 20-31):

```kotlin
    override suspend fun insertDone(row: PrintHistoryInsert) {
        supabase.from(TABLE_NAME).insert(row.copy(status = "done"))
    }

    override suspend fun insertFailed(row: PrintHistoryInsert, reason: String) {
        supabase.from(TABLE_NAME).insert(
            row.copy(
                status = "failed",
                failure_reason = reason.take(MAX_REASON_LENGTH),
            )
        )
    }
```

With:

```kotlin
    override suspend fun markDone(jobId: String, doneAt: String) {
        supabase.from(TABLE_NAME)
            .update({
                set("status", "done")
                set("done_at", doneAt)
            }) {
                filter {
                    eq("id", jobId)
                    eq("status", "pending")  // claim filter
                }
            }
    }

    override suspend fun markFailed(jobId: String, reason: String, failedAt: String) {
        supabase.from(TABLE_NAME)
            .update({
                set("status", "failed")
                set("failure_reason", reason.take(MAX_REASON_LENGTH))
                set("failed_at", failedAt)
            }) {
                filter {
                    eq("id", jobId)
                    eq("status", "pending")  // claim filter
                }
            }
    }
```

- [ ] **Step 3: Tambah `fetchPending` method**

Setelah `fetchRecent` method, sebelum `companion object`, tambah:

```kotlin
    /**
     * Polling fallback: agent ngecek pending rows kalau FCM ga nyampe.
     * Filter `created_at > now()-5min` membatasi blast radius kalau
     * sweep belom jalan / row stuck lama.
     * Kolom minimal supaya hemat bandwidth.
     */
    suspend fun fetchPending(limit: Int = 5): List<PrintHistoryRow> {
        val staleCutoff = java.time.Instant.now()
            .minusSeconds(5 * 60)
            .toString()
        return supabase.from(TABLE_NAME).select(
            columns = Columns.raw(POLL_COLUMNS)
        ) {
            filter {
                eq("status", "pending")
                gte("created_at", staleCutoff)
            }
            order("created_at", Order.ASCENDING)
            limit(limit.toLong())
        }.decodeList<PrintHistoryRow>()
    }
```

- [ ] **Step 4: Tambah `POLL_COLUMNS` di companion object**

In `companion object` (line 47+), add:

```kotlin
        private const val POLL_COLUMNS =
            "id, tx_id, agent_label, target, trigger, item_ids, bytes_b64, status, " +
                "failure_reason, done_at, failed_at, created_at"
```

(Note: skips `transactions(customer_name, table_no)` join — polling doesn't need it.)

- [ ] **Step 5: Build agent project**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
./gradlew :app:assembleDebug 2>&1 | tail -20
```

Expected: BUILD SUCCESSFUL. Should fail with reference errors at `JobProcessor.kt` calling old `insertDone/insertFailed` — that's expected, Task 6 fixes.

If error is at this file (not JobProcessor), fix syntax before continuing.

- [ ] **Step 6: Commit (interim — JobProcessor still broken)**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
git add app/src/main/kotlin/com/pakpon/printagent/data/print/PrintHistoryRepository.kt
git commit -m "refactor(agent): HistoryWriter markDone/markFailed UPDATE flow"
```

---

## Task 6: Agent — JobProcessor refactor

**Files:**
- Modify: `/home/brondol/Downloads/pak-pon-print-agent/app/src/main/kotlin/com/pakpon/printagent/service/JobProcessor.kt`

- [ ] **Step 1: Update `processJobInternal` failure paths**

In file, find `if (ip.isNullOrBlank())` block (around lines 95-108):

```kotlin
        if (ip.isNullOrBlank()) {
            val reason = when (job.target) {
                PrintTarget.customer ->
                    "IP printer dapur belum di-set (nota customer dicetak di printer dapur)"
                else ->
                    "IP printer ${job.target} belum di-set di agent Settings"
            }
            insertFailed(job, agentLabel, reason)
            LogCapture.warn("Cetak ${job.target} gagal: IP belum di-set")
            return
        }
```

Change `insertFailed(job, agentLabel, reason)` → `markFailed(job, reason)`:

```kotlin
        if (ip.isNullOrBlank()) {
            val reason = when (job.target) {
                PrintTarget.customer ->
                    "IP printer dapur belum di-set (nota customer dicetak di printer dapur)"
                else ->
                    "IP printer ${job.target} belum di-set di agent Settings"
            }
            markFailed(job, reason)
            LogCapture.warn("Cetak ${job.target} gagal: IP belum di-set")
            return
        }
```

Find base64 decode block (around lines 110-116):

```kotlin
        val bytes = try {
            base64Decoder(job.bytesB64)
        } catch (e: IllegalArgumentException) {
            val reason = "payload bytes_b64 corrupt: ${e.message ?: "unknown"}"
            insertFailed(job, agentLabel, reason)
            return
        }
```

Change to:

```kotlin
        val bytes = try {
            base64Decoder(job.bytesB64)
        } catch (e: IllegalArgumentException) {
            val reason = "payload bytes_b64 corrupt: ${e.message ?: "unknown"}"
            markFailed(job, reason)
            return
        }
```

Find TCP catch block (around lines 118-128):

```kotlin
        try {
            tcpSender.send(ip, port, bytes)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val reason = e.message ?: e.javaClass.simpleName
            insertFailed(job, agentLabel, reason)
            Log.w(TAG, "Job ${job.id} TCP send failed: $reason")
            LogCapture.warn("Cetak ${job.target} gagal: $reason")
            return
        }
```

Change to:

```kotlin
        try {
            tcpSender.send(ip, port, bytes)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val reason = e.message ?: e.javaClass.simpleName
            markFailed(job, reason)
            Log.w(TAG, "Job ${job.id} TCP send failed: $reason")
            LogCapture.warn("Cetak ${job.target} gagal: $reason")
            return
        }
```

Find success block (around lines 131-140):

```kotlin
        try {
            insertDone(job, agentLabel)
            Log.i(TAG, "Job ${job.id} printed and marked done")
            LogCapture.info("Cetak ${job.target} berhasil ($ip:$port)")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Job ${job.id} insertDone failed after physical print: ${e.message}")
            LogCapture.warn("Cetak ${job.target} berhasil tapi DB write gagal")
        }
```

Change to:

```kotlin
        try {
            markDone(job)
            Log.i(TAG, "Job ${job.id} printed and marked done")
            LogCapture.info("Cetak ${job.target} berhasil ($ip:$port)")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Job ${job.id} markDone failed after physical print: ${e.message}")
            LogCapture.warn("Cetak ${job.target} berhasil tapi DB write gagal")
        }
```

- [ ] **Step 2: Replace private helper methods**

Find existing helpers (around lines 143-176):

```kotlin
    private suspend fun insertDone(job: InlineJob, agentLabel: String) {
        val row = baseInsert(job, agentLabel, status = "done").copy(
            done_at = nowIso(),
        )
        historyRepo.insertDone(row)
    }

    private suspend fun insertFailed(job: InlineJob, agentLabel: String, reason: String) {
        val row = baseInsert(job, agentLabel, status = "failed").copy(
            failed_at = nowIso(),
        )
        historyRepo.insertFailed(row, reason)
    }

    private fun baseInsert(
        job: InlineJob,
        agentLabel: String,
        status: String,
    ) = PrintHistoryInsert(
        id = job.id,
        tx_id = job.txId,
        agent_label = agentLabel,
        target = job.target.name,
        trigger = job.trigger.name,
        item_ids = job.itemIds.takeIf { it.isNotEmpty() },
        bytes_b64 = job.bytesB64,
        status = status,
    )
```

Replace with:

```kotlin
    private suspend fun markDone(job: InlineJob) {
        historyRepo.markDone(jobId = job.id, doneAt = nowIso())
    }

    private suspend fun markFailed(job: InlineJob, reason: String) {
        historyRepo.markFailed(jobId = job.id, reason = reason, failedAt = nowIso())
    }
```

(`baseInsert` deleted — no longer needed since UPDATE doesn't construct full row.)

- [ ] **Step 3: Update `recordStoppedAfterDispatch`**

Find method (around lines 67-71):

```kotlin
    suspend fun recordStoppedAfterDispatch(job: InlineJob) {
        val agentLabel = settings.getAgentLabel()
        insertFailed(job, agentLabel, "agent stopped after dispatch")
        Log.i(TAG, "Job ${job.id} recorded failed (agent stopped)")
    }
```

Replace with:

```kotlin
    suspend fun recordStoppedAfterDispatch(job: InlineJob) {
        markFailed(job, "agent stopped after dispatch")
        Log.i(TAG, "Job ${job.id} recorded failed (agent stopped)")
    }
```

(`agentLabel` ga dibutuhkan lagi karena markFailed UPDATE existing row tanpa change label.)

- [ ] **Step 4: Clean unused imports**

Check top of file — `PrintHistoryInsert`, `PrintTarget` imports. After refactor, `PrintHistoryInsert` may no longer be needed. Remove `import com.pakpon.printagent.data.print.PrintHistoryInsert` if no longer referenced.

- [ ] **Step 5: Build to confirm compile**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
./gradlew :app:assembleDebug 2>&1 | tail -20
```

Expected: BUILD SUCCESSFUL (Task 5 + 6 combined now compile). If still errors, likely in `JobProcessorTest.kt` (Task 7 fixes).

- [ ] **Step 6: Commit (tests still broken)**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
git add app/src/main/kotlin/com/pakpon/printagent/service/JobProcessor.kt
git commit -m "refactor(agent): JobProcessor pakai markDone/markFailed"
```

---

## Task 7: Agent — Fix JobProcessorTest

**Files:**
- Modify: `/home/brondol/Downloads/pak-pon-print-agent/app/src/test/kotlin/com/pakpon/printagent/service/JobProcessorTest.kt`

- [ ] **Step 1: Read existing test file**

Read full content of `app/src/test/kotlin/com/pakpon/printagent/service/JobProcessorTest.kt`. Note test cases and how `FakeHistoryWriter` (or similar) is structured.

- [ ] **Step 2: Update `FakeHistoryWriter` to match new interface**

The fake class implements `HistoryWriter`. Replace `insertDone(row)` / `insertFailed(row, reason)` overrides with `markDone(jobId, doneAt)` / `markFailed(jobId, reason, failedAt)`.

Example replacement (adapt to actual fake structure):

```kotlin
private class FakeHistoryWriter : HistoryWriter {
    val doneCalls = mutableListOf<Pair<String, String>>() // (jobId, doneAt)
    val failedCalls = mutableListOf<Triple<String, String, String>>() // (jobId, reason, failedAt)

    override suspend fun markDone(jobId: String, doneAt: String) {
        doneCalls += jobId to doneAt
    }

    override suspend fun markFailed(jobId: String, reason: String, failedAt: String) {
        failedCalls += Triple(jobId, reason, failedAt)
    }
}
```

- [ ] **Step 3: Update test assertions**

For each test in file, replace assertions on `insertDone/insertFailed` rows with assertions on `markDone/markFailed` calls. Job id should match `job.id`. Reason text assertions kept verbatim (markFailed signature includes reason).

- [ ] **Step 4: Run tests**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
./gradlew :app:testDebugUnitTest 2>&1 | tail -30
```

Expected: PASS. Fix any drifted assertions. Don't ADD new behavior — keep same test cases, just update assertion targets.

- [ ] **Step 5: Commit**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
git add app/src/test/kotlin/com/pakpon/printagent/service/JobProcessorTest.kt
git commit -m "test(agent): update JobProcessor tests for markDone/markFailed"
```

---

## Task 8: Agent — HeartbeatRepository.amIPrimary()

**Files:**
- Modify: `/home/brondol/Downloads/pak-pon-print-agent/app/src/main/kotlin/com/pakpon/printagent/data/heartbeat/HeartbeatRepository.kt`

- [ ] **Step 1: Add `amIPrimary()` method + supporting data class**

At end of class (before `companion object`, around line 67), insert:

```kotlin
    /**
     * Polling guard: cek apakah device ini yang lagi flag primary di web.
     * Single-row SELECT by indexed agent_uuid — sub-millisecond. Dipanggil
     * tiap 60s di PendingJobPoller, jadi battery impact negligible.
     */
    suspend fun amIPrimary(): Boolean {
        val probe = supabase.from(TABLE_NAME).select(
            columns = Columns.list("is_primary"),
        ) {
            filter { eq("agent_uuid", settings.getAgentUuid()) }
            limit(1)
        }.decodeList<PrimaryProbe>()
        return probe.firstOrNull()?.is_primary == true
    }
```

At top of file (after imports, before class declaration), add:

```kotlin
@kotlinx.serialization.Serializable
private data class PrimaryProbe(val is_primary: Boolean)
```

- [ ] **Step 2: Build to confirm compile**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
./gradlew :app:assembleDebug 2>&1 | tail -10
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 3: Commit**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
git add app/src/main/kotlin/com/pakpon/printagent/data/heartbeat/HeartbeatRepository.kt
git commit -m "feat(agent): HeartbeatRepository.amIPrimary() probe"
```

---

## Task 9: Agent — PendingJobPoller

**Files:**
- Create: `/home/brondol/Downloads/pak-pon-print-agent/app/src/main/kotlin/com/pakpon/printagent/service/PendingJobPoller.kt`
- Create: `/home/brondol/Downloads/pak-pon-print-agent/app/src/test/kotlin/com/pakpon/printagent/service/PendingJobPollerTest.kt`

**TDD: test first.**

- [ ] **Step 1: Tulis failing test**

Path: `/home/brondol/Downloads/pak-pon-print-agent/app/src/test/kotlin/com/pakpon/printagent/service/PendingJobPollerTest.kt`

```kotlin
package com.pakpon.printagent.service

import com.pakpon.printagent.data.print.InlineJob
import com.pakpon.printagent.data.print.PrintHistoryRow
import com.pakpon.printagent.data.print.PrintTarget
import com.pakpon.printagent.data.print.PrintTrigger
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.TestScope
import org.junit.Assert.assertEquals
import org.junit.Test

class PendingJobPollerTest {

    private fun rowOf(id: String) = PrintHistoryRow(
        id = id,
        tx_id = null,
        agent_label = "test",
        target = "dapur",
        trigger = "test",
        item_ids = null,
        bytes_b64 = "AA==",
        status = "pending",
        failure_reason = null,
        done_at = null,
        failed_at = null,
        created_at = "2026-06-26T00:00:00Z",
    )

    @Test
    fun `tickOnce skip kalau bukan primary`() = runBlocking {
        val processed = mutableListOf<String>()
        val poller = PendingJobPoller(
            fetchPending = { listOf(rowOf("a"), rowOf("b")) },
            amIPrimary = { false },
            processFromRow = { processed += it.id },
            scope = TestScope(),
        )
        poller.tickOnce()
        assertEquals(emptyList<String>(), processed)
    }

    @Test
    fun `tickOnce process semua pending kalau primary`() = runBlocking {
        val processed = mutableListOf<String>()
        val poller = PendingJobPoller(
            fetchPending = { listOf(rowOf("a"), rowOf("b")) },
            amIPrimary = { true },
            processFromRow = { processed += it.id },
            scope = TestScope(),
        )
        poller.tickOnce()
        assertEquals(listOf("a", "b"), processed)
    }

    @Test
    fun `tickOnce handle empty pending gracefully`() = runBlocking {
        val processed = mutableListOf<String>()
        val poller = PendingJobPoller(
            fetchPending = { emptyList() },
            amIPrimary = { true },
            processFromRow = { processed += it.id },
            scope = TestScope(),
        )
        poller.tickOnce()
        assertEquals(emptyList<String>(), processed)
    }

    @Test
    fun `tickOnce continue saat processFromRow throw`() = runBlocking {
        val processed = mutableListOf<String>()
        val poller = PendingJobPoller(
            fetchPending = { listOf(rowOf("a"), rowOf("b"), rowOf("c")) },
            amIPrimary = { true },
            processFromRow = {
                processed += it.id
                if (it.id == "b") throw RuntimeException("simulate fail")
            },
            scope = TestScope(),
        )
        poller.tickOnce()
        // Semua row di-attempt; failure di b ga block c
        assertEquals(listOf("a", "b", "c"), processed)
    }
}
```

- [ ] **Step 2: Run test (expect compile fail — class missing)**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
./gradlew :app:testDebugUnitTest --tests "*.PendingJobPollerTest" 2>&1 | tail -15
```

Expected: compilation error — `PendingJobPoller` not found.

- [ ] **Step 3: Tulis `PendingJobPoller` class**

Path: `/home/brondol/Downloads/pak-pon-print-agent/app/src/main/kotlin/com/pakpon/printagent/service/PendingJobPoller.kt`

```kotlin
package com.pakpon.printagent.service

import android.util.Log
import com.pakpon.printagent.data.print.PrintHistoryRow
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Polling fallback kalau FCM ga nyampe / tertunda.
 *
 * - Hanya jalan saat agent ini primary (amIPrimary). Non-primary device
 *   skip polling (battery saving + cegah race antar agent).
 * - In-process dedup di JobProcessor.inFlight memastikan FCM × poll race
 *   tidak double-process job yang sama.
 * - Cron sweep web mark pending >5min jadi failed; poller fetch dengan
 *   filter `created_at > now()-5min` jadi nggak proses row yang sudah
 *   ke-sweep timeout.
 *
 * Lambda-style dependencies supaya unit-testable tanpa Supabase + tanpa
 * koneksi ke heartbeat repo.
 */
class PendingJobPoller(
    private val fetchPending: suspend () -> List<PrintHistoryRow>,
    private val amIPrimary: suspend () -> Boolean,
    private val processFromRow: suspend (PrintHistoryRow) -> Unit,
    private val scope: CoroutineScope,
    private val pollIntervalMs: Long = 60_000L,
) {
    private var job: Job? = null

    fun start() {
        job?.cancel()
        job = scope.launch {
            while (isActive) {
                runCatching { tickOnce() }
                    .onFailure { Log.w(TAG, "poll tick error: ${it.message}") }
                delay(pollIntervalMs)
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    /**
     * Dipanggil tiap interval atau manual via "Cek pending" button.
     * Internal exception per-row di-catch supaya satu failure ga block
     * row berikutnya.
     */
    suspend fun tickOnce() {
        if (!amIPrimary()) return
        val pending = fetchPending()
        for (row in pending) {
            runCatching { processFromRow(row) }
                .onFailure { Log.w(TAG, "process row ${row.id} failed: ${it.message}") }
        }
    }

    companion object {
        private const val TAG = "PendingPoller"
    }
}
```

- [ ] **Step 4: Run tests (expect PASS)**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
./gradlew :app:testDebugUnitTest --tests "*.PendingJobPollerTest" 2>&1 | tail -15
```

Expected: 4 tests pass.

- [ ] **Step 5: Run all agent tests**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
./gradlew :app:testDebugUnitTest 2>&1 | tail -15
```

Expected: ALL pass (existing + new).

- [ ] **Step 6: Commit**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
git add app/src/main/kotlin/com/pakpon/printagent/service/PendingJobPoller.kt app/src/test/kotlin/com/pakpon/printagent/service/PendingJobPollerTest.kt
git commit -m "feat(agent): PendingJobPoller for FCM-loss fallback"
```

---

## Task 10: Agent — Wire PendingJobPoller in lifecycle

**Files:**
- Modify: `/home/brondol/Downloads/pak-pon-print-agent/app/src/main/kotlin/com/pakpon/printagent/di/ServiceLocator.kt`
- Modify: `/home/brondol/Downloads/pak-pon-print-agent/app/src/main/kotlin/com/pakpon/printagent/service/PrintAgentService.kt`

- [ ] **Step 1: Register poller factory in ServiceLocator**

Read current ServiceLocator to understand pattern. Add new lazy property OR factory method (depends on existing style).

Add after existing `lateinit var jobProcessor: JobProcessor` declaration (around line 28):

```kotlin
    // PendingJobPoller dibuat per-PrintAgentService.start() karena butuh
    // scope yang lifecycle-aware (cancelled on stop). Factory bukan
    // lateinit var.
    fun createPendingJobPoller(scope: kotlinx.coroutines.CoroutineScope): com.pakpon.printagent.service.PendingJobPoller =
        com.pakpon.printagent.service.PendingJobPoller(
            fetchPending = { printHistoryRepository.fetchPending() },
            amIPrimary = { heartbeatRepository.amIPrimary() },
            processFromRow = { row ->
                val job = com.pakpon.printagent.data.print.InlineJob(
                    id = row.id,
                    txId = row.tx_id,
                    target = com.pakpon.printagent.data.print.PrintTarget.valueOf(row.target),
                    trigger = com.pakpon.printagent.data.print.PrintTrigger.valueOf(row.trigger),
                    itemIds = row.item_ids ?: emptyList(),
                    bytesB64 = row.bytes_b64,
                )
                jobProcessor.processJob(job)
            },
            scope = scope,
        )
```

(Adjust imports / package style to match existing ServiceLocator conventions.)

- [ ] **Step 2: Wire start/stop in PrintAgentService**

Read `PrintAgentService.kt`. Add field:

```kotlin
    private var pendingJobPoller: com.pakpon.printagent.service.PendingJobPoller? = null
```

In `onStartCommand`, after `_isRunning.value = true` + immediate heartbeat send (around line 70-75 area), add poller start:

```kotlin
        pendingJobPoller?.stop()
        pendingJobPoller = ServiceLocator.createPendingJobPoller(scope = serviceScope).also {
            it.start()
        }
```

(`serviceScope` is whatever existing CoroutineScope is used in PrintAgentService — read file to find exact name.)

In `onDestroy`, before `markOffline()` block (around line 119), add:

```kotlin
        pendingJobPoller?.stop()
        pendingJobPoller = null
```

- [ ] **Step 3: Build**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
./gradlew :app:assembleDebug 2>&1 | tail -10
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 4: Run tests**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
./gradlew :app:testDebugUnitTest 2>&1 | tail -10
```

Expected: ALL pass.

- [ ] **Step 5: Commit**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
git add app/src/main/kotlin/com/pakpon/printagent/di/ServiceLocator.kt app/src/main/kotlin/com/pakpon/printagent/service/PrintAgentService.kt
git commit -m "feat(agent): wire PendingJobPoller in service lifecycle"
```

---

## Task 11: Agent — "Cek pending" button UI

**Files:**
- Modify: `/home/brondol/Downloads/pak-pon-print-agent/app/src/main/kotlin/com/pakpon/printagent/ui/main/MainViewModel.kt`
- Modify: Compose screen (likely `MainActivity.kt` or `MainScreen.kt` — locate it)

- [ ] **Step 1: Locate Compose screen**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
grep -rln "fun MainScreen\|setContent\|onRefreshClick" app/src/main/kotlin/com/pakpon/printagent/ui/ | head -5
```

Note paths and call sites.

- [ ] **Step 2: Add `checkPending` to MainViewModel**

Read existing MainViewModel structure. Add method near other action handlers (e.g., near `onRefreshClick` or `retryJob`):

```kotlin
    fun checkPending() {
        viewModelScope.launch {
            val poller = ServiceLocator.createPendingJobPoller(scope = viewModelScope)
            try {
                poller.tickOnce()
                refreshAgentsAndJobs()
                _events.emit(UiEvent.Toast("Cek pending selesai"))
            } catch (e: Exception) {
                Log.w(TAG, "checkPending error: ${e.message}")
                _events.emit(UiEvent.Toast("Cek pending gagal: ${e.message}"))
            }
        }
    }
```

(Adapt to actual ViewModel patterns: `_events`, `UiEvent.Toast`, `refreshAgentsAndJobs` may have different names. Use what's there.)

- [ ] **Step 3: Add button to Compose screen**

In the Compose UI file located in Step 1, find the area where Refresh button or Start/Stop controls live. Add:

```kotlin
Button(
    onClick = { viewModel.checkPending() },
    enabled = isRunning,
) {
    Text("Cek pending")
}
```

(Place near Refresh / Stop button. `isRunning` likely already a State in the screen.)

- [ ] **Step 4: Build**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
./gradlew :app:assembleDebug 2>&1 | tail -10
```

Expected: BUILD SUCCESSFUL.

- [ ] **Step 5: Commit**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
git add app/src/main/kotlin/com/pakpon/printagent/ui/main/
git commit -m "feat(agent): manual 'Cek pending' button"
```

---

## Task 12: Coordinated deploy + E2E verification

**Files:** none (verification only).

This is a coordinated rollout. Web + agent must deploy together — incompatible during transition window.

- [ ] **Step 1: Build agent release APK**

```bash
cd /home/brondol/Downloads/pak-pon-print-agent
./gradlew :app:assembleRelease 2>&1 | tail -10
# APK at: app/build/outputs/apk/release/app-release.apk
```

- [ ] **Step 2: Pre-flight check Supabase state**

```sql
-- Via MCP execute_sql, confirm:
SELECT count(*) FROM print_history WHERE status='pending';
-- Expected: 0 (any old pending row from testing is now stale).
-- Kalau ada, manual cleanup:
-- UPDATE print_history SET status='failed', failure_reason='pre-deploy cleanup' WHERE status='pending';
```

- [ ] **Step 3: Plan rollout window**

Pilih timeslot **off-peak** (e.g., siang menjelang sore, sebelum operasional ramai). Inform owner.

- [ ] **Step 4: Apply migrations (already done via Task 1 step 3-4 ke remote)**

Re-verify dengan Step 5 di Task 1.

- [ ] **Step 5: Install agent APK ke semua devices yang aktif**

Untuk tiap Android tablet/HP yang punya agent app:
1. Stop agent app (pencet Stop button).
2. Install APK baru (overwrite install).
3. Buka app, pencet Start.
4. Konfirmasi heartbeat masuk di Supabase.

- [ ] **Step 6: Deploy web (Vercel)**

```bash
cd /home/brondol/Downloads/pak-pon
git push origin feat/primary-agent-selection
# Trigger Vercel deploy (auto kalau branch terhubung, atau manual push to master after merge)
```

**Catatan**: branch `feat/primary-agent-selection` masih harus di-merge ke master sebelum bisa deploy via Vercel production. Decide:
- Option A: Merge to master (existing primary-agent branch + this new pending feature), deploy master.
- Option B: Set Vercel preview deploy from `feat/primary-agent-selection` branch URL for staging-only test, merge after sign-off.

Recommend Option B (preview deploy first), kemudian merge.

- [ ] **Step 7: Smoke test scenarios**

Scenario A — Happy path:
1. Save tx baru di web.
2. Web INSERT row print_history dengan status='pending'.
3. FCM dispatch ke primary agent.
4. Agent receive, TCP print, UPDATE row → status='done'.
5. Verify nota fisik keluar. Cek debug page: row done, agent_label benar.
6. Verify `transaction_items.printed_dapur_at` ke-set (trigger fired).

Scenario B — FCM hilang (simulate):
1. Stop FCM service di agent (bisa via Android system settings → Force stop Google Play Services briefly, OR test by killing app right after Save).
2. Save tx baru: web INSERT pending + FCM dispatch (FCM lost).
3. Restart agent app → polling tick dalam <60s.
4. Pending row di-claim, processed, UPDATE done.
5. Nota fisik keluar.

Scenario C — Agent offline:
1. Stop agent. Save tx baru.
2. Web INSERT pending. FCM dispatch (no handler aktif).
3. Tunggu 5 menit. Cron sweep fires → row jadi failed dengan reason 'timeout: agent did not ack'.
4. Debug page: row failed visible.

Scenario D — Manual "Cek pending":
1. With agent running, INSERT pending row manually via SQL (or trigger Scenario B kondisi).
2. Pencet "Cek pending" di agent app.
3. Toast "Cek pending selesai" muncul.
4. Pending row processed.

Scenario E — Race FCM + poll:
1. Hard to simulate manually. Assume covered oleh `inFlight` dedup tests.

- [ ] **Step 8: Monitor logs (24h)**

Pakai wide-event logs untuk monitor:
- `POST /api/print/send` — `inserted_pending=true` di tiap dispatch.
- `GET /api/cron/print-sweep` — `pending_timeout_count` per 5min.
- Agent app LogCapture: "Poll tick", "FCM skipped: already processing".

Kalau ada anomali (sweep mark failed terlalu sering), investigate.

- [ ] **Step 9: Sign-off**

Owner konfirmasi:
- ✅ Print normal jalan, 1 nota only.
- ✅ Pending row visible saat in-flight.
- ✅ Recovery dari FCM hilang via polling work.
- ✅ Timeout sweep mark failed sesuai.

- [ ] **Step 10: Merge ke master**

Setelah sign-off:

```bash
cd /home/brondol/Downloads/pak-pon
git checkout master
git merge --no-ff feat/primary-agent-selection
git push origin master

cd /home/brondol/Downloads/pak-pon-print-agent
git checkout master
git merge --no-ff feat/pending-status-poll
git push origin master
```

---

## Task 13: Update CLAUDE.md

**Files:**
- Modify: `/home/brondol/Downloads/pak-pon/CLAUDE.md`

- [ ] **Step 1: Find Print system section**

Section header: `## Print system (Phase 1+2+3 shipped 2026-06-25, primary agent 2026-06-26)`.

- [ ] **Step 2: Update header date**

Replace header dengan:

```markdown
## Print system (Phase 1+2+3 shipped 2026-06-25, primary agent 2026-06-26, pending state 2026-06-26)
```

- [ ] **Step 3: Update Dispatch bullet**

Find bullet starting with `- **Dispatch**:`. Replace dengan:

```markdown
- **Dispatch**: `POST /api/print/send` cek primary agent → INSERT `print_history` row (status='pending') → kirim FCM ke 1 primary (no fan-out, no race). Agent UPDATE row jadi done/failed saat selesai (bukan INSERT). Polling fallback 60s di primary agent: kalau FCM hilang, agent fetch pending rows dari DB (`status='pending' AND created_at > now()-5min`) dan process. In-process `JobProcessor.inFlight` set cegah FCM × poll dari double-process job yang sama. Cron `/api/cron/print-sweep` (*/5 min) mark pending >5min jadi `failed` dengan reason 'timeout: agent did not ack'. Primary di-set owner di `/setup/printer/debug` (PATCH `/api/agent/[label]` → RPC `set_primary_agent`). Trigger `mark_items_printed_history` fire di transisi `pending→done` (AFTER UPDATE OF status). DELETE primary blok 409 kalau masih ada agent lain.
```

- [ ] **Step 4: Update Audit bullet (kalau ada)**

Find/check existing **Audit** bullet. Update kalau perlu — flow audit sekarang: web yang INSERT pending, agent UPDATE. `print_history.id` di-allocate web saat POST `/api/print/send`.

- [ ] **Step 5: Commit**

```bash
cd /home/brondol/Downloads/pak-pon
git add CLAUDE.md
git commit -m "docs: pending status flow + polling fallback di CLAUDE.md"
```

---

## Final Checklist

- [ ] Migrations 0025 + 0026 applied to prod Supabase
- [ ] Web deploy live (INSERT pending)
- [ ] Agent APK installed on all active devices
- [ ] Vercel cron `print-sweep` schedule enabled
- [ ] Tests pass (web vitest + agent JUnit)
- [ ] Lint pass
- [ ] Build pass (Next.js + agent Gradle release)
- [ ] Manual E2E scenarios A-D verified
- [ ] Owner sign-off
- [ ] CLAUDE.md updated
- [ ] Branches merged to master in both repos
