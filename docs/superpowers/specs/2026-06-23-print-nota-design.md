# Print Nota — Web Refactor (Queue Paradigm) — Design Spec

**Date:** 2026-06-23 (revised same day after live-test failure on Android — original RawBT-intent approach abandoned)
**Status:** Approved (brainstorming phase complete, ready for implementation plan)
**Scope:** Web-side only. Print Agent Android app di-spec terpisah (Spec B, akan dibuat setelah Spec A done).
**Depends on:** Migration `0004_print_nota.sql` (`transactions.daily_seq`), `lib/escpos.ts`, `lib/daily-seq.ts`.

## 1. Latar belakang & alasan pivot

### Awal (gagal di production)

Spec sebelumnya pakai pendekatan **Android Intent URL ke RawBT bridge app**: web app generate ESC/POS bytes, encode base64, kirim via `intent://print/#Intent;scheme=rawbt;...;S.profile=Dapur;...;end` ke Android Chrome → RawBT pick up → print ke LAN printer.

Implementation selesai (Tasks 1-18 di plan lama), 97/97 tests pass, deploy ke preview, tapi **live test di HP Android Samsung dengan RawBT installed: zero UI feedback, tidak ada print**. Banner status di home page bahkan tidak muncul di HP (works di desktop). Setelah research:

1. **URL format SALAH** — pendekatan `intent://...#Intent;...;S.payload=BASE64;end` bukan format yang RawBT registered untuk handle. RawBT documentation + community example (`qhoirulanwar/ionic4-print-rawbt`) pakai format simpler `rawbt:base64,<data>`. URL format diperbaiki dalam commit `caf562e`.
2. **RawBT tidak support multi-printer per request via URL** — RawBT cuma punya 1 default printer. URL tidak bisa pilih profile. Multi-printer dapur+minuman simultan: TIDAK MUNGKIN dengan RawBT URL scheme.
3. **Banner gak muncul di HP** — separate issue dari intent URL. Diagnosa belum dilakukan karena pivot total.

Konklusi: arsitektur "browser → intent URL → RawBT → printer" tidak workable untuk requirement multi-printer + reliability.

### Pivot

User propose & approve: **arsitektur "Print Agent" — web sebagai producer print job, mobile app sebagai consumer.**

- Web app POST job ke `print_queue` table di Supabase
- Print Agent Android app (separate, Spec B) subscribe ke realtime channel `print_queue`
- Agent terima job → identify target (dapur/minuman) → kirim ESC/POS via TCP socket ke IP printer yang sesuai
- Agent report back status via UPDATE `print_queue.status`

Manfaat: multi-printer trivial (agent tau IP per target), reliable (queue-based dengan retry), backend-driven (gak terpengaruh quirk Android Chrome × RawBT × hydration).

## 2. Scope split

Pivot ini di-split jadi 2 spec terpisah:

- **Spec A (dokumen ini)**: Web Refactor → Queue paradigm. Web POST job, render UI, baca status.
- **Spec B (separate file, akan dibuat berikutnya)**: Print Agent Android App — foreground service, Supabase Realtime subscribe, TCP print, history view + manual reprint.

Spec A bisa shipped dulu — queue accumulates pending jobs. Agent (Spec B) consume saat sudah ready.

## 3. Decisions ringkas

| # | Decision | Reason |
|---|---|---|
| Q1 | Job delivery: **Supabase Realtime** (built-in, free tier cukup: 200 concurrent, 2M msg/bulan) | Lower latency, $0 cost, infra simple |
| Q2 | Auth agent: **owner login** (same Supabase auth as web) | Konsisten dgn 1-account warung pattern |
| Q3 | Retry on print fail: **single try, no auto-retry, mark failed in DB** | Simple, manual retry visible at owner level |
| Q4 | Cleanup approach: **atomic refactor** (replace in place, delete unused, single PR) | End state clean, owner gak butuh A/B test |
| Q5 | Bytes_b64 inline di queue row | Agent jadi dumb pipe, gak perlu port escpos ke Kotlin |
| Q6 | Auto-cleanup queue: extend existing cron, delete done/failed >7 hari | Konsisten dgn retention pattern |
| Q7 | Banner status: simple binary (online hidden / offline red) | YAGNI — no yellow stale state |
| Q8 | Heartbeat interval: 30 detik | Balance freshness vs Supabase write rate |
| Q9 | Agent offline threshold: 2 menit since last heartbeat | Tolerate brief network blips |

## 4. Architecture & data flow

```
┌─────────────────────────────────────────────────────────────┐
│                    [Supabase backend]                        │
│                                                              │
│  ┌─────────────────────────┐  ┌────────────────────────┐    │
│  │  print_queue table      │  │  agent_heartbeats      │    │
│  │  - id, tx_id, target    │  │  - agent_label         │    │
│  │  - bytes_b64, status    │  │  - last_seen_at        │    │
│  │  - failure_reason       │  └────────────────────────┘    │
│  └─────────────────────────┘                                 │
│              │                                                │
│              ▼                                                │
│  ┌─────────────────────────┐                                 │
│  │  Realtime channel       │                                 │
│  │  on print_queue INSERT  │                                 │
│  └─────────────────────────┘                                 │
└──┬──────────────────────────┬──────────────────────────────┘
   │ POST /api/print/queue   │ subscribe realtime (Spec B)
   │ GET recent              │ PATCH status (Spec B)
   │ POST retry              │ UPSERT heartbeat (Spec B)
   ▼                         ▼
[Web app]              [Print Agent — Spec B]
- Scan + confirm        - Foreground service Kotlin/Flutter
- Test print            - Subscribe Realtime
- Reprint               - TCP socket ke IP printer
- Banner agent status     dapur ATAU minuman
- Debug page              berdasarkan target field
- POST jobs ke queue    - PATCH status
                        - UPSERT heartbeat tiap 30s
```

**Key principles:**
1. Web app gak peduli printer — cuma POST job ke queue
2. Agent gak peduli source — cuma consume queue
3. Multi-printer routing dilakukan di agent (agent tau IP per target)
4. Status feedback via Supabase Realtime — web bisa optionally subscribe untuk live update
5. Heartbeat = indicator agent online — banner & debug page baca ini

## 5. Data model

### 5.1 Migration baru — `0005_print_queue.sql`

```sql
-- 0005_print_queue.sql — print job queue + agent heartbeat

-- Drop print_events (replaced by print_queue + wide-event logger)
DROP TABLE IF EXISTS print_events;

-- 1. print_queue — job queue, agent consume from here
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

-- 2. agent_heartbeats — track agent online status
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

-- 3. Enable realtime on print_queue
ALTER PUBLICATION supabase_realtime ADD TABLE print_queue;
```

### 5.2 Status state machine

```
pending ─(agent pick up)──→ printing ─(success)──→ done
   │                            │
   │                            └─(error)──→ failed
   └─(agent never picks up)─→ stays pending (banner warning kalau >5 min stuck)
```

### 5.3 Cleanup retention

Extend existing cron `/api/cron/cleanup`:
- Delete `print_queue` rows dengan `status IN ('done', 'failed') AND created_at < now() - interval '7 days'`
- Konsisten dgn retention pattern transaksi (soft-delete >7 hari hard-delete)

### 5.4 Data size estimate

- `bytes_b64` per row: ~500-2000 chars (ESC/POS kitchen ticket)
- Volume: ~50 jobs/hari × 2 targets = 100 rows/hari
- After 7-day retention: max ~700 rows ~1.4 MB
- Supabase free tier 500 MB: aman jauh

## 6. API endpoints

### 6.1 `POST /api/print/queue` — submit job

**Body** (Zod validated):
```ts
{
  tx_id: string | null,            // null for test prints
  target: 'dapur' | 'minuman',
  trigger: 'auto' | 'reprint' | 'test',
  bytes_b64: string,               // ESC/POS bytes base64
}
```

**Behavior:**
- Auth required (Supabase session)
- Insert row dengan `status='pending'`, `created_by=user.id`
- Realtime channel auto-push INSERT
- Return `201 { job_id }` immediately

### 6.2 `GET /api/print/queue/recent`

**Query:** `?limit=20&status=all|pending|done|failed`

**Behavior:**
- Auth required
- Return rows ordered by `created_at DESC`, exclude `bytes_b64` (untuk response size)

**Returns:** `200 { jobs: [{ id, tx_id, target, trigger, status, failure_reason, created_at, completed_at }] }`

### 6.3 `POST /api/print/queue/[id]/retry`

**Behavior:**
- Auth required
- If `status='failed'` → set `status='pending'`, clear `failure_reason`, `completed_at`. Realtime push.
- Else: 409

**Returns:** `200 { job }` atau `409`

### 6.4 `POST /api/print/queue/[id]/cancel`

**Behavior:**
- Auth required
- If `status='pending'` → set `status='failed'`, `failure_reason='cancelled by user'`
- Else: 409

**Returns:** `200 { job }` atau `409`

### 6.5 `GET /api/agent/heartbeat`

**Behavior:**
- Auth required
- Return all `agent_heartbeats` rows
- Consumer (banner) compute "online" jika `last_seen_at > now() - 2 min`

**Returns:** `200 { agents: [{ agent_label, last_seen_at, agent_version }] }`

### 6.6 Agent endpoints (documented here, implemented in Spec B)

- `POST /api/agent/heartbeat` — UPSERT by agent_label
- `PATCH /api/print/queue/[id]` — update status pending→printing→done/failed

### 6.7 Deleted endpoints

- `POST /api/print/log` (lama) → DELETED
- `GET /api/print/log/recent` (lama) → DELETED

## 7. Web UI refactor

### 7.1 `components/nota-review-form.tsx` (auto-print)

After PATCH confirm success, replace existing intent-URL trigger dengan:
- `splitItemsByTarget(items)` → list targets dengan items
- Per target: `renderTicket(...)` → `uint8ToBase64(...)` → `fetch('/api/print/queue', POST, { tx_id, target, trigger:'auto', bytes_b64 })`
- Promise.all submit semua targets paralel
- Toast: "Nota tersimpan, N print job dikirim ke agent"
- Redirect ke `/transactions` (existing)

Button text: tetap **"✓ Simpan & Cetak"**.

### 7.2 `components/reprint-card.tsx`

UI: 3 button (Cetak Dapur, Cetak Minuman, Cetak Keduanya) dengan disabled state per kategori availability.

Action handler: POST ke `/api/print/queue` (target + bytes_b64), tampilkan loading per button, toast success/error berdasarkan HTTP response.

Tidak ada modal "Apakah berhasil?" — itu agent yang report status.

Optional: subscribe Supabase Realtime ke print_queue updates untuk tampilkan live status badge.

### 7.3 `components/test-print-dialog.tsx`

State machine (6 phase):
- `idle` — show "Cetak Tes Sekarang" button
- `submitting` — spinner "Mengirim..."
- `awaiting_agent` — show "Job dikirim. Tunggu agent process..." dengan optional realtime status subscription
- `done` (job.status='done' from realtime/poll) — green check "Berhasil!" + auto close
- `failed` (job.status='failed') — red "Gagal: {reason}" + retry button
- `timeout` (>5 min in awaiting_agent without update) — "Agent gak respond" + retry button

Phase transitions: idle → submitting (on tap) → awaiting_agent (POST success) → done/failed (realtime update) atau timeout (5 min timer).

### 7.4 `components/printer-status-banner.tsx`

Fetch `/api/agent/heartbeat` di mount + optional realtime subscription.
- 0 agent online → red banner "Print agent belum jalan" + link `/setup/printer`
- ≥1 agent online → hidden

### 7.5 `app/(app)/setup/printer/page.tsx`

Refactor jadi placeholder:
- Title "Setup Print Agent"
- Penjelasan singkat: web app butuh agent app berjalan di tab Android untuk print
- Link untuk download APK (placeholder URL — diisi setelah Spec B implementation done)
- Reference: lihat Spec B docs untuk panduan teknis

### 7.6 `app/(app)/setup/printer/debug/page.tsx`

3 section:
1. **Agent status** — list agent_heartbeats, badge online/offline
2. **Pending queue** — rows status='pending'/'printing'
3. **Recent jobs** — last 20 rows done/failed, with retry button per failed

Update via realtime subscription kalau ada perubahan.

## 8. Cleanup checklist

**DELETE:**
- `lib/print-intent.ts`
- `lib/print-intent.test.ts`
- `lib/printer-status.ts`
- `lib/printer-status.test.ts`
- `app/api/print/log/route.ts`
- `app/api/print/log/_schema.ts`
- `app/api/print/log/_schema.test.ts`
- `app/api/print/log/recent/route.ts`

**REFACTOR:**
- `components/nota-review-form.tsx`
- `components/reprint-card.tsx`
- `components/reprint-card.test.tsx` (update assertions untuk new flow)
- `components/test-print-dialog.tsx`
- `components/test-print-dialog.test.tsx`
- `components/printer-status-banner.tsx`
- `components/printer-status-banner.test.tsx`
- `app/(app)/setup/printer/page.tsx` (placeholder content)
- `app/(app)/setup/printer/debug/page.tsx`
- `app/api/cron/cleanup/route.ts` (extend dengan print_queue delete)
- `docs/logging.md` (event types baru)

**KEEP:**
- `lib/escpos.ts` + test (still generates bytes)
- `lib/daily-seq.ts` + test (still used by PATCH confirm)
- `lib/date.ts` (existing helpers)
- `lib/logger.ts` (wide-event pattern)
- `app/api/transactions/[id]/route.ts` (PATCH set daily_seq tetap)
- `scripts/printer-emulator.js` (masih useful untuk Spec B dev testing — agent dapur dapat IP emulator alih-alih IP printer real)
- Migration `0004_print_nota.sql` (`transactions.daily_seq` column kept; only `print_events` table dropped via new migration 0005)
- `vitest.setup.ts` localStorage polyfill (mungkin masih dipakai test lain)

**ADD:**
- `supabase/migrations/0005_print_queue.sql`
- Helper `uint8ToBase64`: extract to `lib/escpos.ts` (paling related) atau new `lib/base64.ts`
- `app/api/print/queue/route.ts` + `_schema.{ts,test.ts}`
- `app/api/print/queue/recent/route.ts`
- `app/api/print/queue/[id]/retry/route.ts`
- `app/api/print/queue/[id]/cancel/route.ts`
- `app/api/agent/heartbeat/route.ts`

## 9. Error handling

| # | Skenario | Detection | Mitigation |
|---|---|---|---|
| 1 | POST /api/print/queue gagal (network) | HTTP error | Toast error, transaksi tetap saved |
| 2 | DB insert gagal | HTTP 500 | Toast error, manual retry via reprint button |
| 3 | Agent gak running saat POST | Tidak detect saat insert | Job pending, banner warning, owner cek agent |
| 4 | Agent picks up tapi printer offline | Agent reports failed | Detail page tampil failure_reason + retry button |
| 5 | Agent crash mid-print | Job stuck `printing` | UI timeout 5 min → treat as failed, allow retry |
| 6 | Realtime drop | Agent reconnect (Spec B) | Auto-reconnect. Pending jobs queue, processed saat reconnect |
| 7 | bytes_b64 corrupted in transit | Agent decode error | status='failed', reason='invalid_payload', retry akan re-render |
| 8 | Duplicate submission (double-click) | Tidak prevented | Agent print 2x — acceptable di low volume warung |
| 9 | DB bloat | Cron cleanup | Delete done/failed >7 hari |
| 10 | Heartbeat lag tapi agent hidup | last_seen_at fresh | UI tampilkan "last seen X minutes ago" untuk konteks |

## 10. Testing strategy

### 10.1 Unit (Vitest)

- `lib/escpos.ts` — existing tests kept
- `lib/daily-seq.ts` — existing tests kept
- Helper `uint8ToBase64` — 2-3 tests for round-trip + edge cases

### 10.2 Component (RTL)

- `<PrinterStatusBanner />` — mock fetch heartbeat, render online/offline state
- `<TestPrintDialog />` — mock fetch POST queue, verify body shape + state transitions
- `<ReprintCard />` — mock fetch, verify buttons + disabled + submitting state

### 10.3 Schema (Vitest)

- `POST /api/print/queue` body Zod validation tests

### 10.4 Integration / Manual

- Apply migration locally → verify Realtime broadcast bekerja via Supabase Studio
- POST /api/print/queue → row appears in print_queue
- Mark row status='done' manually → optional realtime subscriber on UI side updates

### 10.5 E2E (deferred to Spec B implementation)

End-to-end agent ↔ queue ↔ printer flow tested setelah agent dibangun.

## 11. Migration sequence

1. Apply DB migration `0005_print_queue.sql` (drop print_events, create print_queue & agent_heartbeats, enable realtime)
2. Atomic refactor PR (single branch / merge):
   - Add new endpoints + schemas
   - Add helper uint8ToBase64
   - Refactor 4 components
   - Refactor 2 pages
   - Delete unused files (lib/print-intent, lib/printer-status, /api/print/log)
   - Extend cron cleanup
   - Update docs/logging.md
3. Run full test suite (Vitest) — expected: tests untuk components updated to new flow
4. Deploy ke Vercel preview
5. Manual verification: POST /api/print/queue via DevTools, see row in Supabase Studio
6. Merge ke master, deploy production
7. Web Phase 1 selesai — queue accumulates pending jobs, no printing yet
8. Start Spec B (Print Agent) brainstorming + implementation

## 12. Open questions deferred to Spec B

- Print Agent language (Kotlin vs Flutter vs Java) — user open ke Kotlin
- Foreground service implementation detail
- Agent UI scope (login, settings, status, history print)
- APK distribution mechanism (sideload via Drive direct link)
- Multi-printer routing logic di agent
- Agent retry behavior on transient errors
- Heartbeat freq & reconnect strategy
- Agent settings storage (Android Keystore for credentials)

## 13. Out of scope (Spec A)

- ❌ Print Agent Android app implementation (Spec B)
- ❌ Multi-warung config
- ❌ Print struk customer (separate backlog)
- ❌ Capacitor wrap fallback
- ❌ iOS support
- ❌ WebSocket fallback if Supabase Realtime down
- ❌ Print job priority queue
- ❌ Bulk print operations

## 14. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Supabase Realtime free tier hit | Low | Medium | Monitor, upgrade if needed |
| Agent app belum ready → queue stuck pending | Medium | High | Phase 1 web only deploy — owner aware no printing yet |
| Auto-cleanup salah delete | Low | Medium | Test carefully first weeks |
| Realtime push lambat | Low | Medium | Agent polling fallback bisa ditambah di Spec B |
| User confused karena print "tidak terjadi" sebelum agent | Medium | Medium | Banner clear: "Agent belum jalan" |
