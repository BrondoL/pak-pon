# Pending Status di Print History — Design Spec

**Tanggal**: 2026-06-26
**Status**: Approved, ready untuk implementation planning
**Repo terkait**: `pak-pon` (web) + `pak-pon-print-agent` (Android)
**Base branch**: `feat/primary-agent-selection` (build di atas, bukan dari master)

## Tujuan

Refaktor flow print dispatch supaya web punya **proof of dispatch** dan agent app punya **polling fallback** kalau FCM hilang. Sekarang web fire-and-forget ke FCM, agent yang INSERT row print_history saat job selesai — kalau FCM ga nyampe, ga ada bukti job pernah ada, dan ga ada mekanisme recovery selain owner pencet ulang.

Setelah refaktor:
1. Web INSERT `print_history` dengan `status='pending'` **sebelum** kirim FCM. Row jadi proof bahwa web udah dispatch.
2. Agent UPDATE row tsb saat selesai (bukan INSERT lagi).
3. Agent app jalanin polling tiap 60s: kalau ada pending row dan device ini primary, claim & process. Recovery otomatis kalau FCM lost.
4. Web cron sweep pending > 5min → mark failed (timeout).

## Motivasi (user-stated)

- **Visibility**: owner bisa lihat job in-flight di debug page (sekarang baru muncul setelah selesai).
- **Audit**: proof bahwa web udah dispatch, bahkan kalau agent ga pernah ack.
- **Reliability**: polling fallback kalau FCM lost (OEM doze deeper than expected, push service down, etc.).
- **Konsistensi**: agent UPDATE row yang sudah di-allocate web, bukan INSERT row baru — id consistent dari awal.

## Out of scope

- DB-level claim via `'processing'` status. Concurrency dihandle in-memory di agent (Section 3.2). Komplikasi extra state ga sebanding dengan benefit untuk single-warung single-agent setup.
- Persist agent's in-memory dedup set across restart. Edge case rare, recoverable manually.
- Auto-resend FCM saat sweep. Sweep cukup mark failed, owner retry manual.
- Web mengirim ulang FCM kalau insert pending sukses tapi FCM call gagal. Polling akan catch dalam <60s.
- Multi-agent processing pending. Polling hanya jalan di primary (filter di Section 3.2).

## Decisions yang sudah ditetapkan

| # | Topik | Keputusan |
|---|---|---|
| 1 | Polling interval | **60 detik** + manual "Cek pending" button di agent app |
| 2 | Stale pending handling | **Auto-mark failed** setelah 5 menit via cron sweep. `failure_reason='timeout: agent did not ack'` |
| 3 | Concurrency (FCM + poll race) | **In-memory dedup** di agent app, bukan DB-level claim |
| 4 | Status check constraint | Tambah `'pending'`, jadi `('pending','done','failed')` — tidak ada `'processing'` |
| 5 | Trigger `mark_items_printed_history` | Migrasi dari `AFTER INSERT` ke `AFTER UPDATE OF status` |
| 6 | Polling scope | **Hanya primary agent** yang polling. Non-primary skip (battery saving + cegah race) |

---

## Architecture overview

### Sebelum (current state)

```
Web POST /api/print/send
  │ generate job_id
  │ query primary agent (is_primary=true + online + fcm_token)
  │ kosong → 503
  └─► FCM push (inline payload) ──────► Agent
                                          │ receive FCM
                                          │ TCP print
                                          └─► INSERT print_history
                                                (status='done'|'failed')
```

### Sesudah

```
Web POST /api/print/send
  │ generate job_id
  │ query primary agent
  │ kosong → 503
  │ INSERT print_history (status='pending')   ◄── NEW
  │ INSERT gagal → 500
  └─► FCM push (inline payload) ──────► Agent FCM path
                                          │ in-mem dedup check
                                          │ TCP print
                                          └─► UPDATE print_history
                                                SET status='done'|'failed'
                                                WHERE id=?

Agent polling (every 60s, primary-only) ────────┘
  │ SELECT pending rows
  │ for each: dedup check → process → UPDATE

Web cron sweep (extend existing 02:00 WIB job, +interval check pertama)
  │ pending AND created_at < now()-5min
  │ → UPDATE status='failed', failure_reason='timeout: agent did not ack'
```

---

## 1. Schema migrations

### `supabase/migrations/0025_print_history_pending_status.sql`

```sql
-- 0025_print_history_pending_status.sql
-- Tambah 'pending' state ke print_history.
-- Web INSERT pending → FCM → agent UPDATE done/failed.
-- Polling fallback di agent kalau FCM lost.
-- Lihat docs/superpowers/specs/2026-06-26-pending-status-print-history-design.md.

ALTER TABLE print_history DROP CONSTRAINT IF EXISTS print_history_status_check;
ALTER TABLE print_history ADD CONSTRAINT print_history_status_check
  CHECK (status IN ('pending','done','failed'));

-- Index dipakai oleh polling agent + cron sweep.
-- Partial index = rows pending only (kebanyakan rows done, jadi index kecil).
CREATE INDEX print_history_pending_idx
  ON print_history (created_at)
  WHERE status = 'pending';
```

### `supabase/migrations/0026_mark_items_printed_on_update.sql`

```sql
-- 0026_mark_items_printed_on_update.sql
-- Sebelumnya trigger AFTER INSERT (agent insert dengan status final).
-- Sekarang web INSERT pending dulu → agent UPDATE → fire trigger di transisi
-- pending→done. Avoid double-fire dengan check OLD.status='pending'.

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

**Catatan**: trigger fungsi tidak punya `WHEN` clause supaya logic check status di body — sama dengan style versi sebelumnya. `AFTER UPDATE OF status` = fire saat kolom status berubah saja (efisien).

---

## 2. Web changes

### 2.1 `POST /api/print/send` — INSERT pending before FCM

File: `app/api/print/send/route.ts`

Setelah `targets.length === 0` check (existing), tambah blok INSERT sebelum `pushPrintJob`:

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

// FCM push tetap fire-and-forget. Kalau gagal, polling akan catch dalam <60s.
pushPrintJob({ ... existing ... });
```

Behavior:
- INSERT pending dulu, baru FCM. Kalau INSERT fail → 500, ga kirim FCM (row kosong = no proof, lebih jelas error).
- FCM tetap fire-and-forget (existing pattern). Tidak retry, tidak tunggu ack. Pending row + polling = safety net.
- `agent_label` di-set ke primary label saat insert. Kalau primary swap antara INSERT dan UPDATE, label di row pertama ga akurat — acceptable, primary swap sangat jarang. Field ini cuma untuk audit; routing dispatch sudah via FCM token primary saat itu.

**Catatan strict mode**: response shape tetap `{ job_id, dispatched_to }` — ga ada perubahan contract klien.

### 2.2 Cron sweep — pending > 5min → failed

File: `app/api/cron/cleanup/route.ts` — extend existing handler.

Setelah block `print_history cleanup > 7 hari` (sudah ada), tambah:

```ts
// Sweep pending rows yang stuck > 5 menit. Agent ga ack (FCM lost,
// crash, atau printer mati). Mark failed supaya owner lihat di debug
// page; bisa retry manual. 5 menit cukup longgar untuk normal print
// (biasanya <5s) sekaligus cepat enough buat recovery.
const pendingCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const { count: timeoutCount, error: timeoutErr } = await supabase
  .from('print_history')
  .update({
    status: 'failed',
    failure_reason: 'timeout: agent did not ack',
    failed_at: new Date().toISOString(),
  }, { count: 'exact' })
  .eq('status', 'pending')
  .lt('created_at', pendingCutoff);
if (timeoutErr) {
  evt.warn(`pending sweep error: ${timeoutErr.message}`);
} else {
  evt.set('pending_timeout_count', timeoutCount ?? 0);
}
```

**Schedule**: cron job di `vercel.json` schedule existing adalah `0 19 * * *` UTC (02:00 WIB) — sekali sehari. Untuk sweep pending yang harus cepat (5 menit), perlu **schedule baru lebih sering**. Pilihan:

- **Opsi A**: Tambah endpoint baru `app/api/cron/print-sweep/route.ts`, schedule tiap 5 menit. Cleanup harian tetap di endpoint lama.
- **Opsi B**: Pindahin sweep ke endpoint baru, biarkan harian cron tetap untuk cleanup retention. Sweep run tiap 1-5 menit.

**Keputusan**: Opsi A. Endpoint baru `/api/cron/print-sweep`, schedule `*/5 * * * *` (tiap 5 menit). Pisahkan concern (sweep != cleanup). Vercel Hobby plan support cron tiap menit, jadi 5 min OK.

Tambahan ke `vercel.json` (existing path) di array `crons`:
```json
{ "path": "/api/cron/print-sweep", "schedule": "*/5 * * * *" }
```

(Tidak perlu migrasi ke `vercel.ts` untuk perubahan ini.)

Endpoint `/api/cron/print-sweep` minimal: auth via `CRON_SECRET`, run query above, log + return.

### 2.3 Debug page — show pending in history

File: `app/(app)/setup/printer/debug/page.tsx`

Type `Job` extend status union:
```ts
status: 'pending' | 'done' | 'failed';
```

Counter row (existing): tambah pending count:
```tsx
<p className="text-xs text-coal-soft">
  Pending: {pending.length} · Failed: {failed.length} · Done: {done.length}.
</p>
```
dengan `const pending = jobs.filter(j => j.status === 'pending');` di mapping.

Per-row status badge: tambah branch:
```tsx
<span className={
  j.status === 'pending' ? 'bg-mustard/20 text-coal' :
  j.status === 'done' ? 'bg-leaf/15 text-leaf' :
  'bg-brick/15 text-brick'
}>
  {j.status}
</span>
```

Hover/tooltip di pending row: "Lagi diproses agent (atau menunggu pickup)". Optional, low priority.

### 2.4 `GET /api/print/history` — include pending in response

File: `app/api/print/history/route.ts` (or wherever exists; controller verify saat plan).

Pastikan query tidak filter out `status='pending'` (default behavior: all statuses). Kalau ada filter param `status=failed`, biarkan; tambah dukungan `status=pending` kalau perlu (Phase 2 — kalau dibutuhkan, controller decide).

---

## 3. Agent changes (pak-pon-print-agent)

### 3.1 FCM path: INSERT → UPDATE

File: `app/src/main/kotlin/com/pakpon/printagent/data/print/PrintHistoryRepository.kt`

Sebelumnya method `insertDone` / `insertFailed` (INSERT). Ganti dengan:

```kotlin
suspend fun markDone(jobId: String, doneAt: Instant) {
    supabase.from(TABLE_NAME)
      .update({
        set("status", "done")
        set("done_at", doneAt.toString())
      })
      .eq("id", jobId)
      .eq("status", "pending")  // claim filter: cuma update kalau masih pending
}

suspend fun markFailed(jobId: String, reason: String, failedAt: Instant) {
    supabase.from(TABLE_NAME)
      .update({
        set("status", "failed")
        set("failure_reason", reason.take(MAX_REASON_LENGTH))
        set("failed_at", failedAt.toString())
      })
      .eq("id", jobId)
      .eq("status", "pending")
}
```

**Catatan `.eq("status", "pending")` di UPDATE**: race protection. Kalau UPDATE matches 0 rows (sudah done/failed dari worker lain, atau sudah ke-sweep timeout), it's a no-op. Agent log silent skip.

Method `fetchRecent` untuk tab History agent app — tidak berubah, tapi sekarang akan include rows status='pending' juga.

### 3.2 In-memory dedup set + polling loop

File baru: `app/src/main/kotlin/com/pakpon/printagent/service/PendingJobPoller.kt`

```kotlin
package com.pakpon.printagent.service

import com.pakpon.printagent.data.print.PrintHistoryRepository
import com.pakpon.printagent.data.heartbeat.HeartbeatRepository
import kotlinx.coroutines.*
import java.util.Collections

object ProcessingDedup {
    // Set<String> dari job_id yang lagi diproses agent. Dibersihin setelah
    // UPDATE selesai (atau exception). Prevent FCM + poll double-process.
    private val active = Collections.synchronizedSet(mutableSetOf<String>())

    fun tryClaim(jobId: String): Boolean = active.add(jobId)
    fun release(jobId: String) { active.remove(jobId) }
}

class PendingJobPoller(
    private val printHistoryRepo: PrintHistoryRepository,
    private val heartbeatRepo: HeartbeatRepository,
    private val jobProcessor: JobProcessor,
    private val scope: CoroutineScope,
) {
    private var job: Job? = null

    fun start() {
        job?.cancel()
        job = scope.launch {
            while (isActive) {
                runCatching { tick() }
                  .onFailure { Log.w(TAG, "poll tick error: ${it.message}") }
                delay(POLL_INTERVAL_MS)
            }
        }
    }

    fun stop() { job?.cancel(); job = null }

    suspend fun tickOnce() = tick()  // dipanggil manual "Cek pending" button

    private suspend fun tick() {
        // Skip kalau bukan primary (battery saving + cegah race antar agent).
        if (!heartbeatRepo.amIPrimary()) return

        val pending = printHistoryRepo.fetchPending(limit = 5)
        for (row in pending) {
            if (!ProcessingDedup.tryClaim(row.id)) continue  // already processing
            try {
                jobProcessor.processFromRow(row)
            } finally {
                ProcessingDedup.release(row.id)
            }
        }
    }

    companion object {
        private const val TAG = "PendingPoller"
        private const val POLL_INTERVAL_MS = 60_000L
    }
}
```

**Catatan tentang `amIPrimary()`**: butuh helper di `HeartbeatRepository`:

```kotlin
suspend fun amIPrimary(): Boolean {
    val row = supabase.from(TABLE_NAME)
        .select(Columns.list("is_primary"))
        .eq("agent_uuid", settings.getAgentUuid())
        .maybeSingleOrNull<HeartbeatPrimaryProbe>()
    return row?.is_primary == true
}

@Serializable
private data class HeartbeatPrimaryProbe(val is_primary: Boolean)
```

Performance: 1 query per 60s (single row by indexed `agent_uuid`). Negligible.

**Method `fetchPending` di repo**:

```kotlin
suspend fun fetchPending(limit: Int = 5): List<PrintHistoryRow> {
    return supabase.from(TABLE_NAME)
        .select(columns = Columns.raw(FULL_COLUMNS_FOR_PROCESS)) {
            filter {
                eq("status", "pending")
                // Hanya yang belum kena sweep timeout. Defensive (sweep
                // sudah mark failed kalau >5min, tapi belt-and-suspenders).
                gte("created_at", Instant.now().minusSeconds(5 * 60).toString())
            }
            order("created_at", Order.ASCENDING)
            limit(limit.toLong())
        }
        .decodeList()
}
```

`FULL_COLUMNS_FOR_PROCESS = "id, tx_id, target, trigger, item_ids, bytes_b64"` — minimal columns untuk process. Hemat bandwidth.

### 3.3 JobProcessor refactor

File: `app/src/main/kotlin/com/pakpon/printagent/service/JobProcessor.kt`

Rename/refactor existing `processJob(InlineJob)` jadi `processFromInline(InlineJob)` dan tambah sibling `processFromRow(PrintHistoryRow)`. Kedua method delegate ke core `process(target, bytesB64, jobId, txId, trigger, itemIds)`.

`processFromInline` (dipakai FCM path) decode payload string, validate, then core.
`processFromRow` (dipakai poll path) langsung extract fields dari row.

Core method:
1. Resolve printer IP based on target (existing logic).
2. TCP print (existing).
3. On success: `repo.markDone(jobId, now)`.
4. On failure: `repo.markFailed(jobId, errMessage, now)`.

**Bukan INSERT lagi**. Branch yang sebelumnya `insertDone` / `insertFailed` dihapus.

### 3.4 FCM service — pakai dedup

File: `app/src/main/kotlin/com/pakpon/printagent/service/PakPonFcmService.kt`

Sebelumnya `onMessageReceived` langsung process. Sekarang:

```kotlin
override fun onMessageReceived(message: RemoteMessage) {
    if (!ServiceLocator.isInit()) ServiceLocator.init(applicationContext)
    if (!PrintAgentService.isRunning()) {
        LogCapture.info("FCM diabaikan: agent stopped")
        return
    }

    val data = message.data
    val job = parseInlineJob(data) ?: run {
        Log.w(TAG, "FCM payload incomplete: $data")
        return
    }

    if (!ProcessingDedup.tryClaim(job.id)) {
        LogCapture.info("FCM skipped: job ${job.id} already processing (polled)")
        return
    }

    runBlocking {
        runCatching {
            SupabaseClientFactory.get().auth.refreshCurrentSession()
        }.onFailure { Log.w(TAG, "Auth refresh failed: ${it.message}") }
        try {
            JobProcessor.processFromInline(job)
        } finally {
            ProcessingDedup.release(job.id)
        }
    }
}
```

### 3.5 Agent service lifecycle

File: `app/src/main/kotlin/com/pakpon/printagent/service/PrintAgentService.kt`

Tambah `PendingJobPoller` instance, start/stop bareng service:

```kotlin
private var poller: PendingJobPoller? = null

override fun onStartCommand(...): Int {
    // ... existing ...
    poller = PendingJobPoller(
        printHistoryRepo = ServiceLocator.printHistoryRepository,
        heartbeatRepo = ServiceLocator.heartbeatRepository,
        jobProcessor = JobProcessor,
        scope = scope,
    ).also { it.start() }
}

override fun onDestroy() {
    poller?.stop()
    poller = null
    // ... existing markOffline etc.
}
```

### 3.6 UI: "Cek pending" button

File: `app/src/main/kotlin/com/pakpon/printagent/ui/MainViewModel.kt`

Tambah method `checkPending()`:

```kotlin
fun checkPending() {
    viewModelScope.launch {
        try {
            poller?.tickOnce()
            _events.emit(UiEvent.Toast("Cek pending selesai"))
            refreshAgentsAndJobs()
        } catch (e: Exception) {
            _events.emit(UiEvent.Toast("Cek pending gagal: ${e.message}"))
        }
    }
}
```

UI Compose (existing MainActivity / agent screen): tambah `Button("Cek pending")` di toolbar atau dekat Refresh button. Disable kalau service ga running.

---

## 4. Concurrency analysis

### 4.1 FCM vs poll race (intra-agent)

Skenario: FCM arrive at T=2s, poll fires at T=60s, but TCP print stuck → FCM thread masih ngerun saat poll fires.

- FCM thread: tryClaim(job.id) → true → start processing → eventually finish, release.
- Poll thread (T=60s): fetchPending returns the row (still pending), tryClaim(job.id) → **false** (FCM thread holds claim) → skip.

✅ Aman.

### 4.2 FCM vs poll race (inter-agent, e.g. primary swap mid-process)

Skenario: Tab S6 (primary) starts processing via FCM. Owner swap primary ke Pixel Tablet. Pixel polls, fetches pending row, tries to process.

- Tab S6 thread: holds in-mem claim (di Tab S6 device).
- Pixel poll: `amIPrimary()` → true (just promoted). Pixel's ProcessingDedup ga aware Tab S6 sedang process (different device). Pixel claims (local) → processes → UPDATE `status='done' WHERE id=? AND status='pending'`.
- Tab S6 finishes TCP, calls UPDATE `... AND status='pending'`. If Pixel already updated, Tab S6's UPDATE matches 0 rows. Silent skip.

⚠️ Race: **double TCP print** kalau dua device punya akses ke printer yang sama (kemungkinan kecil untuk warung typical).

Mitigasi:
- Primary swap **rare** (owner action via web UI).
- Agent app process biasanya <5s, race window kecil.
- Worst case 1 nota double-print → recoverable manual.
- **Acceptable** untuk MVP. Kalau jadi masalah, owner advice: ganti primary saat ga ada print in-flight.

### 4.3 Sweep race (web vs agent)

Skenario: Agent baru mulai process (TCP slow, 4 menit). Sweep fires saat T=5min1s → UPDATE pending → failed. Agent finishes TCP saat T=5min10s → UPDATE pending → done. Tapi `.eq('status', 'pending')` ga match (sudah failed). Silent skip.

Result: nota fisik ke-print, tapi DB recorded failed. Trigger `mark_items_printed_history` ga fire (karena OLD.status='failed' bukan 'pending'). Owner lihat di debug page: "failed (timeout)". Tx items tetap dengan `printed_X_at=NULL`. Owner pencet "Cetak tambahan" → second print untuk item yang sudah dicetak fisik.

⚠️ **Risk**: phantom timeout — nota fisik benar, tapi flag print salah → reprint di "Cetak tambahan" workflow.

Mitigasi:
- 5 menit timeout cukup longgar untuk print normal (biasanya <5s).
- Agent yang TCP print >5min biasanya tanda printer crash / network masalah serius — owner expected investigate.
- **Acceptable** untuk MVP.

---

## 5. Logging

Wide-event tambahan:

- `POST /api/print/send`:
  - `inserted_pending: true` saat berhasil insert (new field).
- `GET /api/cron/print-sweep` (new endpoint):
  - `pending_timeout_count: N` — berapa pending di-mark failed.
  - `evt.warn` kalau update error.
- Agent app (logcat + LogCapture):
  - "Poll tick: claimed N pending jobs, processed N"
  - "FCM skipped: job ID already processing (polled)"
  - "UPDATE skipped: id=X status mismatch (race or sweep)"

---

## 6. Testing

### 6.1 Unit (web)

- `app/api/print/send/route.test.ts` (kalau dibikin): assert INSERT pending dipanggil sebelum FCM. Mock supabase + FCM.
- `app/api/cron/print-sweep/route.test.ts`: mock supabase, assert UPDATE pending+lt(created_at)+set failure_reason dipanggil. Auth check (CRON_SECRET).

### 6.2 Schema

- Apply migration 0025 + 0026 lokal/staging.
- INSERT row dengan `status='pending'` → trigger ga fire (cek `printed_X_at` masih NULL).
- UPDATE row status='done' (dengan OLD.status='pending') → trigger fire, `printed_X_at` di-set.
- UPDATE row status='failed' → trigger no-op, `printed_X_at` tetap NULL.

### 6.3 Manual E2E

1. Migration applied; web deploy; agent app update.
2. Save tx baru: web INSERT pending → FCM ke primary → agent UPDATE done → nota print → debug page show "done".
3. Stop agent: save tx → web INSERT pending → FCM (no handler) → 5 menit kemudian sweep → row jadi failed dengan reason "timeout".
4. Stop agent, save tx (pending in DB), Start agent. Polling tick 60s berikutnya: agent fetch pending, process, UPDATE done. Nota print.
5. Manual "Cek pending" button di agent app: skip 60s wait, langsung tick → process pending kalau ada.
6. Race test: kalau bisa, FCM dan poll fire saat bersamaan untuk 1 job (sulit dipicu manual). Verify 1 nota only.

### 6.4 Agent unit

- `PendingJobPollerTest`: mock `amIPrimary` true/false, mock `fetchPending` returning N rows, assert `processFromRow` called N times when primary, 0 times when not.
- `ProcessingDedupTest`: tryClaim returns true once, false on subsequent, true after release.

---

## 7. Rollout

Single phase, coordinated web + agent deploy (agent's UPDATE flow incompatible dengan web yang masih INSERT-only).

```
[ ] Branch off feat/primary-agent-selection (atau merge dulu, lalu branch dari master).
[ ] Apply migrations 0025 + 0026 ke staging Supabase.
[ ] Implement & test web changes (INSERT pending, cron sweep endpoint).
[ ] Implement & test agent changes (markDone/markFailed UPDATE,
    PendingJobPoller, dedup set, Cek pending button).
[ ] Coordinated deploy:
    a) Deploy web ke prod (INSERT pending live, but agent masih INSERT done).
       Race window: agent INSERTs duplicate key (pending id sudah ada).
       → MITIGASI: pre-deploy upgrade agent app first ATAU rolling-update
       dengan rollback ready. Pilih: upgrade agent first via APK push.
    b) Install agent build → restart service → polling start, UPDATE path active.
    c) Deploy web setelah agent sudah running new build.
[ ] Apply migrations 0025 + 0026 ke prod Supabase.
[ ] Enable cron print-sweep di vercel.json.
[ ] Smoke test: scenarios 4.3 manual E2E.
[ ] Sign-off owner: pending visible di debug, polling fallback work, sweep marks timeout.
```

### Rollback plan

- Migration: tidak ada DROP destructive. Revert ke previous status constraint via new migration `0027_print_history_revert.sql` kalau perlu.
- Web: revert PR, redeploy. INSERT pending hilang, FCM tetap jalan (agent masih INSERT done — kalau agent baru udah deployed, tetap UPDATE, jadi UPDATE 0 rows matches, silent skip). Agent app rollback APK juga kalau perlu (agent baru cuma UPDATE, kalau web ga insert pending lagi, tx ga ada bukti).

Coordinated rollback: web + agent rollback bersamaan.

---

## 8. Risk register

| Risk | Likelihood | Impact | Mitigasi |
|---|---|---|---|
| Web INSERT sukses, FCM gagal, agent ga polling | Low | Pending stuck → 5min sweep mark failed → owner retry | Polling 60s catch sebelum sweep biasanya |
| Agent crash mid-print (TCP done, UPDATE belum) | Low | Row tetap pending → sweep mark failed → owner pikir gagal padahal fisik printed | Acceptable; owner observe + retry decision |
| Primary swap mid-FCM-process | Very Low | Double print kalau both devices share printer | Owner advice: swap saat idle |
| Sweep mark failed sebelum agent UPDATE (slow TCP >5min) | Very Low | DB recorded failed, nota fisik printed, trigger ga fire | Owner observe; acceptable for MVP |
| Cron `*/5` tidak jalan (Vercel issue) | Low | Pending stuck forever sampai cron resume | Polling 60s tetap process pending <5min lama |
| Agent dedup hilang setelah restart, ulang process row pending recent | Low | 1 nota double-print | Polling filter `created_at > now()-5min`; restart rare event |
| Web deploy duluan sebelum agent (race compat) | Med | Agent insert duplicate key error pada saat menerima FCM | Deploy order: agent first, then web (Section 7) |

---

## 9. Referensi

- `docs/superpowers/specs/2026-06-25-print-revamp-design.md` — Phase 2 arsitektur dasar (akan jadi outdated setelah ini).
- `docs/superpowers/specs/2026-06-26-primary-agent-selection-design.md` — primary agent selection (prerequisite).
- Existing code (sebelum perubahan):
  - `app/api/print/send/route.ts` (lines 75-99 FCM dispatch)
  - `supabase/migrations/0018_print_history.sql` (schema awal)
  - `supabase/migrations/0020_mark_items_printed_history_trigger.sql` (trigger)
  - `app/api/cron/cleanup/route.ts` (cleanup pattern)
  - `pak-pon-print-agent/app/src/main/kotlin/com/pakpon/printagent/service/PakPonFcmService.kt`
  - `pak-pon-print-agent/app/src/main/kotlin/com/pakpon/printagent/data/print/PrintHistoryRepository.kt`
