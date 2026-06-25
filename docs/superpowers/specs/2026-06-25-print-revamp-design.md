# Print System Revamp — Design Spec

**Tanggal**: 2026-06-25
**Status**: Approved, ready untuk implementation planning
**Repo terkait**: `pak-pon` (web) + `pak-pon-print-agent` (Android)

## Tujuan

Dua perubahan saling berkaitan, dikemas dalam 1 spec karena tracking item yang sudah dicetak (Section A) butuh sumber kebenaran dari arsitektur baru (Section B):

1. **Format nota berbeda untuk dapur/minuman vs customer.** Saat ini semua nota memakai 1 format dengan harga & total. Owner mau dapur/minuman dapat versi ringkas (item & qty saja, double-size supaya gampang dibaca), dan nota dengan harga jadi versi opsional khusus untuk customer by request. Plus, kalau owner edit transaksi sambil menambah item, nota baru ke dapur/minuman cukup berisi item tambahan (jangan ulang yang sebelumnya — biar tidak bingung).
2. **Arsitektur print FCM-only.** Saat ini agent dipanggil lewat 4 jalur paralel (realtime watcher Supabase + FCM + periodic catch-up + AlarmManager). Realtime + FCM bisa double-trigger dan boros kompleksitas. Owner mau FCM jadi satu-satunya jalur trigger, agent punya tombol start/stop yang explicit, dan web cek dulu status agent sebelum push (kalau offline langsung kasih tau owner).

## Out of scope

- Multi-printer per target (tetap 1 printer dapur + 1 minuman).
- Customer receipt PDF/WhatsApp (sudah backlog terpisah).
- Bluetooth printer.
- Auto-deferred queue (jika agent offline saat save, nota tidak dijadwalkan auto-print saat agent online lagi — owner harus klik manual "Cetak tambahan").

## Architecture overview

### Sebelum

```
Web                                  Agent
─────────────                        ────────
POST /api/print/queue                FCM receiver       ┐
  │ INSERT print_queue (pending)     Realtime watcher   │ 4 trigger paths,
  │ FCM push (action=print_job)  ──► Periodic 60s loop  │ rawan double print
  │                                  Alarm 2-min wake   ┘
  ▼
Supabase (print_queue + agent_heartbeats)
                          ▲
                          │ markPrinting / markDone
                          └─ Agent updates rows
```

### Sesudah

```
Web                                       Agent (saat ONLINE saja)
─────────────                             ────────
POST /api/print/send                      FCM receiver (single path)
  1. Cek agent_heartbeats:                  • parse payload inline
     status='online' AND                    • TCP print
     last_seen_at > now() - 90s             • INSERT print_history
  2. Kalau kosong → 503 (no_agent)            (status='done' | 'failed')
  3. Kalau ada → fan-out FCM (inline)      Stop button → status='offline'
                                           Start button → status='online'
                                           Tab History → list + retry button
                          ▲
                          │ INSERT history rows
                          └─ Trigger update transaction_items.printed_X_at
```

Web TIDAK insert ke Supabase saat dispatch — agent yang punya `print_history` (write-only dari agent side). Web cuma melakukan SELECT (cek online + tampilkan history di debug page).

## Decisions yang sudah ditetapkan

| # | Topik | Keputusan |
|---|---|---|
| 1 | `print_queue` setelah migrasi | **DROP CASCADE** (Phase 3) |
| 2 | Threshold agent stale | **90s** (heartbeat 30s × 3 ticks toleransi) |
| 3 | Kapan agent insert ke `print_history` | **Status `done`/`failed` saja** — NO intermediate `processing` state |
| 4 | Rollout | **Phased** — Phase 1 nota format → Phase 2 architecture switch → Phase 3 cleanup |
| 5 | Spec file | **Gabung 1 file** (file ini) |

---

# Phase 1 — Format Nota (web-only, no breaking change)

Tujuan: deliver nota baru + tracking flag tanpa coordinated deploy ke agent. Setelah Phase 1 ship, owner sudah bisa pakai format kitchen baru, tombol "Cetak tambahan", "Cetak nota customer", dan footer "Terima kasih". Arsitektur masih pakai `print_queue` + realtime.

## 1.1 Schema migrations

### `supabase/migrations/0013_transaction_items_printed.sql`

```sql
-- Track kapan tiap item sudah dicetak ke target dapur/minuman.
-- Nullable: NULL = belum pernah dicetak ke target ini.
-- Dipakai filter "Cetak tambahan" — items dengan flag NULL belum sampai dapur.
ALTER TABLE transaction_items
  ADD COLUMN printed_dapur_at   timestamptz NULL,
  ADD COLUMN printed_minuman_at timestamptz NULL;
```

### `supabase/migrations/0014_printer_settings_footer.sql`

```sql
-- Footer text untuk nota customer ("Terima kasih atas kunjungan Anda" dst).
-- Dapur/minuman tidak pakai footer.
ALTER TABLE printer_settings
  ADD COLUMN footer_text text NOT NULL DEFAULT '';
```

### `supabase/migrations/0015_print_queue_item_ids.sql`

```sql
-- List item_id yang ter-include di job ini. Null untuk test print & customer
-- receipt (customer tidak update flag).
ALTER TABLE print_queue
  ADD COLUMN item_ids uuid[] NULL;
```

### `supabase/migrations/0016_mark_items_printed_trigger.sql`

```sql
-- Saat job kitchen sukses (status='done'), tandai items terkait.
-- Akan di-drop di Phase 2 (diganti trigger di print_history).
CREATE OR REPLACE FUNCTION mark_items_printed_queue() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'done'
     AND OLD.status IS DISTINCT FROM 'done'
     AND NEW.item_ids IS NOT NULL
     AND NEW.tx_id IS NOT NULL THEN
    IF NEW.target = 'dapur' THEN
      UPDATE transaction_items
        SET printed_dapur_at = COALESCE(NEW.completed_at, now())
        WHERE id = ANY(NEW.item_ids)
          AND transaction_id = NEW.tx_id;
    ELSIF NEW.target = 'minuman' THEN
      UPDATE transaction_items
        SET printed_minuman_at = COALESCE(NEW.completed_at, now())
        WHERE id = ANY(NEW.item_ids)
          AND transaction_id = NEW.tx_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_print_queue_mark_items
AFTER UPDATE OF status ON print_queue
FOR EACH ROW EXECUTE FUNCTION mark_items_printed_queue();
```

## 1.2 `lib/escpos.ts` refactor

**Sekarang**: 1 fungsi `renderTicket(input, settings)` dipakai untuk dapur, minuman, reprint.
**Target**: 2 fungsi terpisah.

### `renderKitchenTicket(input, settings): Uint8Array`

Format untuk dapur/minuman:
- Header (warung name dari `header_text`, bold center)
- Block info: Date · Order Number · Customer · Meja
- Items dengan `GS ! 0x11` (double-width + double-height), prefix `qty + 'x' + name` (uppercase optional)
- Notes per item di bawah, ukuran normal: `> {note}`
- Footer: `Total Item N`
- Feed + cut sesuai settings

Tambahan constant di file:
```ts
const DOUBLE_SIZE_ON  = new Uint8Array([GS, 0x21, 0x11]);
const DOUBLE_SIZE_OFF = new Uint8Array([GS, 0x21, 0x00]);
```

### `renderCustomerReceipt(input, settings): Uint8Array`

Sama dengan `renderTicket` lama (header + items dengan unit_price + line total + Total bold) **plus**:
- Setelah Total: kalau `settings.footer_text` non-empty, print centered + bold-off + feed-2 + footer_text (split per `\n`) + feed-1.
- Lalu feed_lines_before_cut + cut.

### Backward compat

Rename `renderTicket` → `renderCustomerReceipt`. Kode pemanggil di-update sekaligus (Section 1.4). Tidak ada fallback alias supaya kalau ada caller yang ketinggalan, langsung error build (lebih baik daripada silent salah format).

### Test updates di `lib/escpos.test.ts`

- `renderKitchenTicket`: assert ada bytes `GS ! 0x11`, ada `Total Item N`, TIDAK ada `Total Rp` di output.
- `renderCustomerReceipt` dengan `footer_text=''`: persis sama dengan output lama.
- `renderCustomerReceipt` dengan `footer_text='Terima kasih\n~ Pak Pon ~'`: ada baris itu di-encode.
- Encoding: pastikan non-Latin-1 char di footer ke-replace `?` (sesuai `encodeText`).

## 1.3 PrinterSettings extension

### `lib/printer-settings.ts`

```ts
export type PrinterSettings = {
  // ... existing fields ...
  footer_text: string;
};

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  // ... existing ...
  footer_text: '',
};
```

### `lib/printer-settings-server.ts`

`getPrinterSettings()` baca kolom baru, fallback `''` kalau null (defensive — Supabase RLS).

### `app/(app)/setup/printer/settings/printer-settings-form.tsx`

Tambah field textarea untuk `footer_text` (multiline, max ~4 baris, helper text "Dicetak di nota customer setelah Total. Kosongkan kalau tidak mau footer."). Action `actions.ts` masukin field baru ke validasi Zod.

## 1.4 Component changes

### `components/reprint-card.tsx` → rewrite

Sumber data:
- Server-side compute per target: `pendingDapur: Item[]` (items kategori makanan/nasi yang `printed_dapur_at IS NULL`) dan `pendingMinuman: Item[]`.

Layout (sesuai keputusan Section G dari brainstorm):

```
┌─ Cetak ─────────────────────────────────┐
│  [⚡ Cetak tambahan (N item)]    ← primary, fan-out otomatis ke
│                                    dapur + minuman                  │
│  Cetak ulang ke dapur/minuman:                                      │
│  [Dapur]  [Minuman]  [Keduanya]   ← full reprint, semua item        │
│                                                                     │
│  [🧾 Cetak nota customer]         ← format dengan harga + total     │
└─────────────────────────────────────────┘
```

State logic:
- "Cetak tambahan" disable kalau `pendingDapur.length === 0 && pendingMinuman.length === 0`. Label sebut count gabungan.
- "Cetak ulang ke X" disable kalau target tsb tidak punya item (e.g. tx full minuman → "Dapur" disable).
- "Cetak nota customer" enable kalau ada items (≥1).

Per tombol, panggil endpoint sama: `POST /api/print/queue` (Phase 1 masih queue) dengan:
- `target`: 'dapur' | 'minuman' (atau 2x untuk Keduanya & Tambahan)
- `trigger`: 'auto_additional' | 'reprint' | 'reprint_additional' | 'customer'
- `item_ids`: array UUID
- `bytes_b64`: hasil render

Render selection:
- Kitchen target (dapur/minuman) → `renderKitchenTicket`
- Customer → `renderCustomerReceipt` (target di queue: tambah `'customer'` ke check constraint).

**Note**: `print_queue.target` saat ini check constraint `('dapur','minuman')`. Phase 1 perlu update constraint untuk allow `'customer'` value (atau pakai 'dapur'/'minuman' tergantung mana yang ditugaskan owner untuk print receipt — pertanyaan operasional). **Keputusan**: tambah `'customer'` ke check constraint. Agent decide printer mana yang dipakai untuk customer (probably printer dapur, configurable di settings Phase 2).

Tambah migration:
```sql
-- 0017_print_queue_target_customer.sql
ALTER TABLE print_queue DROP CONSTRAINT IF EXISTS print_queue_target_check;
ALTER TABLE print_queue ADD CONSTRAINT print_queue_target_check
  CHECK (target IN ('dapur', 'minuman', 'customer'));

ALTER TABLE print_queue DROP CONSTRAINT IF EXISTS print_queue_trigger_check;
ALTER TABLE print_queue ADD CONSTRAINT print_queue_trigger_check
  CHECK (trigger IN ('auto', 'auto_additional', 'reprint', 'reprint_additional', 'customer', 'test'));
```

### `components/nota-review-form.tsx` → modify `handleConfirm`

Setelah PATCH transaction sukses:
1. Baca `data.transaction.status_before_save` (atau bandingkan tx.status saat load vs setelah save). Sederhana: tx props punya `wasConfirmedBefore: boolean` yang server kasih ke client.
2. Build jobs:
   - **Pertama save** (wasConfirmedBefore=false): items kitchen di-split per kategori, full ke dapur + minuman. trigger=`'auto'`.
   - **Edit save** (wasConfirmedBefore=true): query items dengan `printed_dapur_at IS NULL` (untuk dapur) dan `printed_minuman_at IS NULL` (minuman). Skip target kalau kosong. trigger=`'auto_additional'`.
3. Fire jobs paralel via `Promise.all`. Existing toast pattern dipertahankan.

Server perlu return items + flag-nya setelah PATCH (untuk client tahu mana yang masih NULL). PATCH route `app/api/transactions/[id]/route.ts` sudah return `items`, tambahkan `printed_dapur_at`/`printed_minuman_at` di select.

### `components/transaction-detail.tsx` → tambah prop

Terima `pendingDapur`, `pendingMinuman` dari server component parent (`app/(app)/transactions/[id]/page.tsx`).

### `app/(app)/transactions/[id]/page.tsx`

Select items dengan kolom baru, hitung pending per target, pass ke `TransactionDetail`.

## 1.5 API route changes (Phase 1)

### `POST /api/print/queue` (existing — modify)

`_schema.ts` extend:
```ts
PrintQueueInsertSchema = z.object({
  tx_id: z.string().uuid().nullable(),
  target: z.enum(['dapur', 'minuman', 'customer']),
  trigger: z.enum(['auto', 'auto_additional', 'reprint', 'reprint_additional', 'customer', 'test']),
  item_ids: z.array(z.string().uuid()).nullable(),
  bytes_b64: z.string().min(1),
}).strict();
```

Route handler: insert `item_ids` ke print_queue row. Tidak ada perubahan FCM logic.

## 1.6 Phase 1 testing

- `lib/escpos.test.ts` — 4 test baru sesuai 1.2.
- `lib/transactions.test.ts` — kalau ada split-by-printed-status helper, test edge cases (empty target, partial NULL).
- Manual:
  1. Save tx baru → 2 nota dapur+minuman BIG format ke-print.
  2. Edit tx tambah 1 item → 1 nota tambahan ke target relevan only.
  3. Reset all (klik "Cetak ulang Keduanya") → 2 nota full.
  4. Klik "Cetak nota customer" → nota lengkap dengan harga + footer.
  5. Cek DB: `transaction_items.printed_dapur_at` ter-set setelah job status='done'.

## 1.7 Phase 1 acceptance criteria

- [ ] Kitchen ticket double-size, no price, no total amount.
- [ ] Customer receipt sama dengan format sekarang + footer kalau `footer_text` non-empty.
- [ ] "Cetak tambahan" deteksi item NULL flag, fan-out otomatis ke dua target.
- [ ] "Cetak ulang Dapur/Minuman/Keduanya" full reprint, tidak peduli flag.
- [ ] Save tx confirmed yang ditambahin item → auto-print delta only.
- [ ] Toast error muncul kalau print job submit gagal.

---

# Phase 2 — FCM-Only Architecture

Tujuan: pindahkan trigger dari `print_queue` realtime ke FCM only. Agent state explicit. Koordinasi deploy web + agent.

## 2.1 Schema migrations

### `supabase/migrations/0018_print_history.sql`

```sql
-- print_history: audit + retry-from-history dari agent app.
-- Agent yang INSERT ke table ini saat job selesai (done/failed).
-- Web hanya SELECT (debug page) + receive trigger updates ke transaction_items.
CREATE TABLE print_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_id           uuid REFERENCES transactions(id) ON DELETE SET NULL,
  agent_id        uuid REFERENCES agent_heartbeats(id) ON DELETE SET NULL,
  agent_label     text,
  target          text NOT NULL CHECK (target IN ('dapur','minuman','customer')),
  trigger         text NOT NULL CHECK (trigger IN
                    ('auto','auto_additional','reprint','reprint_additional','customer','test')),
  item_ids        uuid[] NULL,
  bytes_b64       text NOT NULL,    -- preserve payload, agent app pakai untuk retry
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

**Catatan**: status `'done'` dan `'failed'` saja — TIDAK ada intermediate `processing` (sesuai keputusan Section G.3). Agent insert hanya saat job selesai (sukses ATAU gagal final), tidak ada record untuk job in-flight.

### `supabase/migrations/0019_agent_heartbeats_status.sql`

```sql
ALTER TABLE agent_heartbeats
  ADD COLUMN status text NOT NULL DEFAULT 'offline'
              CHECK (status IN ('online','offline'));

CREATE INDEX agent_heartbeats_online_idx
  ON agent_heartbeats (status, last_seen_at DESC)
  WHERE status = 'online';
```

### `supabase/migrations/0020_mark_items_printed_history_trigger.sql`

```sql
-- Drop trigger lama yang basis-nya print_queue.
DROP TRIGGER IF EXISTS trg_print_queue_mark_items ON print_queue;
DROP FUNCTION IF EXISTS mark_items_printed_queue();

-- Versi baru: trigger di print_history.
-- Karena agent insert langsung dengan status='done', cukup AFTER INSERT.
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

## 2.2 Prerequisite: sync `agent_uuid` column

Repo `pak-pon` schema (migration 0005) define `agent_heartbeats` cuma punya `id` UUID PK + `agent_label` UNIQUE. **Tapi** agent code (`HeartbeatRepository.kt`) pakai `agent_uuid` UNIQUE via `onConflict='agent_uuid'`. Ini berarti ada migration yang ada di Supabase tapi belum di-commit ke repo.

**Action**: sebelum apply migration 0018-0020, owner harus:
1. Cek schema di Supabase: `SELECT column_name FROM information_schema.columns WHERE table_name='agent_heartbeats';`
2. Kalau kolom `agent_uuid` ada, commit migration backfill ke repo (sebagai `0011a_agent_heartbeats_agent_uuid.sql` retrofit) supaya source of truth konsisten.
3. Migration 0018 reference `agent_heartbeats(id)`. Kalau di Supabase agent malah pakai `agent_uuid` sebagai PK alternatif, sesuaikan FK target.

## 2.3 Web API: `/api/print/send`

### NEW: `app/api/print/send/route.ts`

```ts
// Schema
const PrintSendSchema = z.object({
  tx_id: z.string().uuid().nullable(),
  target: z.enum(['dapur', 'minuman', 'customer']),
  trigger: z.enum(['auto','auto_additional','reprint','reprint_additional','customer','test']),
  item_ids: z.array(z.string().uuid()).nullable(),
  bytes_b64: z.string().min(1),
}).strict();

// Logic
POST:
  1. Auth check.
  2. Validate body.
  3. job_id = randomUUID()  // generated server-side
  4. Query agents online:
     SELECT id, agent_label, fcm_token FROM agent_heartbeats
     WHERE status='online'
       AND last_seen_at > now() - INTERVAL '90 seconds'
       AND fcm_token IS NOT NULL
  5. Kalau hasil kosong:
     - Log evt (no_agent_online), return 503
       { error: 'agent_offline', detail: 'no online agent available' }
  6. Fan-out FCM ke semua tokens, payload data:
     {
       action: 'print_job',
       job_id: <uuid>,
       tx_id: <uuid|''>,
       target, trigger,
       item_ids: JSON.stringify(item_ids ?? []),
       bytes_b64,
     }
  7. Log + return 200:
     { job_id, dispatched_to: agents.map(a => a.agent_label) }
  8. Cleanup invalid FCM tokens (existing pattern).
```

Penting:
- TIDAK insert ke Supabase. Agent yang punya tanggung jawab insert ke `print_history` saat selesai.
- 503 response harus actionable buat client: tampilkan toast "Agent printer offline. Nyalakan agent di Android, lalu klik Cetak tambahan."

### `lib/fcm.ts` modify

Extend `PushAgentArgs.job`:
```ts
job?: {
  id: string;
  tx_id: string | null;
  target: 'dapur' | 'minuman' | 'customer';
  trigger: string;
  item_ids: string[] | null;
  bytes_b64: string;
};
```

Build data payload:
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
  : { action: 'check_queue' };  // legacy fallback
```

Hapus `check_queue` action di Phase 3 setelah agent tidak butuh.

### DELETE routes (akan di-DROP di Phase 3, tapi sudah unreachable setelah Phase 2 client switch)

- `POST /api/print/queue` — sudah tidak dipakai client.
- `POST /api/print/queue/[id]/retry`
- `POST /api/print/queue/[id]/cancel`
- `GET /api/print/queue/recent` — replace dengan `GET /api/print/history?limit=N&status=N` (untuk debug page).

Keep di-build sampai Phase 3 (kalau ada caller yang ketinggalan, jangan langsung 404 — log warning).

### NEW: `GET /api/print/history`

```ts
GET /api/print/history?limit=50&status=failed&tx_id=...
  Auth + return print_history rows ordered DESC by created_at.
  Mirror struktur response /api/print/queue/recent biar debug page tinggal swap endpoint.
```

## 2.4 Component changes (Phase 2)

### `components/reprint-card.tsx` & `components/nota-review-form.tsx`

Switch endpoint dari `/api/print/queue` → `/api/print/send`. Body sama (`tx_id, target, trigger, item_ids, bytes_b64`).

Handle 503 response:
```ts
if (res.status === 503) {
  toast.warning('Agent printer offline', {
    description: 'Nyalakan agent di Android dulu. Klik "Cetak tambahan" setelah online.',
    duration: 8000,
  });
  return { ok: false, error: 'agent_offline' };
}
```

### `components/printer-status-banner.tsx` (existing)

Update logic: agent dianggap online kalau ada row di `agent_heartbeats` dengan `status='online' AND last_seen_at > now() - 90s`. Sebelumnya mungkin cuma cek `last_seen_at` (tanpa kolom status).

### `app/(app)/setup/printer/debug/page.tsx`

Switch source list dari `print_queue` ke `print_history`. Hilangkan tombol "Retry" / "Cancel" di web (retry sekarang lewat agent app). Atau keep tombol "Re-send" yang fire ulang POST `/api/print/send` dengan payload sama (re-render dari tx).

## 2.5 Agent changes — DETAIL

Ini perubahan di repo `pak-pon-print-agent`. Susunan task disusun supaya bisa langsung dikerjain dengan sub-skill `superpowers:subagent-driven-development`.

### 2.5.1 Schema integration

Tidak perlu migration baru di agent — schema-nya web yang punya. Tapi agent perlu nambah data class:

#### CREATE `app/src/main/kotlin/com/pakpon/printagent/data/print/PrintHistoryRow.kt`

```kotlin
package com.pakpon.printagent.data.print

import kotlinx.serialization.Serializable

@Serializable
data class PrintHistoryRow(
    val id: String,
    val tx_id: String? = null,
    val agent_id: String? = null,
    val agent_label: String? = null,
    val target: String,
    val trigger: String,
    val item_ids: List<String>? = null,
    val bytes_b64: String,
    val status: String,            // "done" | "failed"
    val failure_reason: String? = null,
    val done_at: String? = null,
    val failed_at: String? = null,
    val created_at: String,
)

@Serializable
data class PrintHistoryInsert(
    val id: String,
    val tx_id: String? = null,
    val agent_id: String? = null,
    val agent_label: String? = null,
    val target: String,
    val trigger: String,
    val item_ids: List<String>? = null,
    val bytes_b64: String,
    val status: String,
    val failure_reason: String? = null,
    val done_at: String? = null,
    val failed_at: String? = null,
)
```

#### CREATE `app/src/main/kotlin/com/pakpon/printagent/data/print/PrintHistoryRepository.kt`

```kotlin
package com.pakpon.printagent.data.print

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order

class PrintHistoryRepository(
    private val supabase: SupabaseClient,
) {
    suspend fun insertDone(row: PrintHistoryInsert) {
        supabase.from(TABLE_NAME).insert(row.copy(status = "done"))
    }

    suspend fun insertFailed(row: PrintHistoryInsert, reason: String) {
        supabase.from(TABLE_NAME).insert(
            row.copy(status = "failed", failure_reason = reason.take(MAX_REASON_LENGTH))
        )
    }

    suspend fun fetchRecent(limit: Int = 50, agentId: String? = null): List<PrintHistoryRow> {
        return supabase.from(TABLE_NAME).select(columns = Columns.raw(FULL_COLUMNS)) {
            order("created_at", Order.DESCENDING)
            limit(limit.toLong())
            if (agentId != null) {
                filter { eq("agent_id", agentId) }
            }
        }.decodeList()
    }

    companion object {
        const val TABLE_NAME = "print_history"
        const val MAX_REASON_LENGTH = 500
        private const val FULL_COLUMNS =
            "id, tx_id, agent_id, agent_label, target, trigger, item_ids, " +
            "bytes_b64, status, failure_reason, done_at, failed_at, created_at, " +
            "transactions(customer_name, table_no)"
    }
}
```

#### MODIFY `app/src/main/kotlin/com/pakpon/printagent/data/heartbeat/HeartbeatRow.kt`

Tambah `status` field:

```kotlin
@Serializable
data class HeartbeatRow(
    val agent_uuid: String,
    val agent_label: String,
    val last_seen_at: String,
    val agent_version: String? = null,
    val device_info: String? = null,
    val fcm_token: String? = null,
    val status: String = "offline",     // "online" | "offline"
)

@Serializable
data class HeartbeatUpsert(
    val agent_uuid: String,
    val agent_label: String,
    val last_seen_at: String,
    val agent_version: String,
    val device_info: String,
    val fcm_token: String? = null,
    val status: String,                 // selalu kirim explicit
)
```

#### MODIFY `app/src/main/kotlin/com/pakpon/printagent/data/heartbeat/HeartbeatRepository.kt`

Tambah parameter `status` ke `sendHeartbeat(status)`. Default-nya `"offline"`. Saat dipanggil dari `PrintAgentService` heartbeat loop (yang fire saat agent running), pass `"online"`. Saat Stop button ditekan, fire 1x heartbeat dengan `status="offline"` lalu service stop.

Tambah helper:
```kotlin
suspend fun markOffline() {
    val row = HeartbeatUpsert(
        agent_uuid = settings.getAgentUuid(),
        agent_label = settings.getAgentLabel(),
        last_seen_at = Instant.now().toString(),
        agent_version = BuildConfig.VERSION_NAME,
        device_info = deviceInfo,
        fcm_token = fcmTokenManager.ensureToken(),
        status = "offline",
    )
    supabase.from(TABLE_NAME).upsert(row) { onConflict = "agent_uuid" }
}
```

### 2.5.2 Strip realtime + polling dari `PrintAgentService`

#### MODIFY `app/src/main/kotlin/com/pakpon/printagent/service/PrintAgentService.kt`

Hapus:
- `subscribeToPrintQueueRealtime()` + call site di `onStartCommand`
- `periodicCatchUpLoop()` + call site
- `CatchUpAlarmReceiver` schedule + cancel + call site
- `listenForOnDemandCatchUp()` + `requestCatchUp()` static (sudah tidak dipakai)
- `logRealtimeStatus()` (tidak ada realtime lagi, no value)

Keep:
- Foreground notification + wake lock (agent harus stay alive untuk terima FCM saat OEM freeze).
- Heartbeat loop (interval bisa stretch ke 60s setelah FCM proven, lihat firebase-fcm-plan.md Task 13).
- Notifikasi tray "Agent ONLINE".

`onStartCommand` jadi minimal: foreground + wake lock + start heartbeat loop dengan `status="online"`.

#### MODIFY `onDestroy`

Sebelum service stop, fire `markOffline()` synchronously (`runBlocking`) supaya web langsung tau. Tidak masalah block onDestroy ~500ms — Android allow up to ~10s.

#### DELETE files

- `app/src/main/kotlin/com/pakpon/printagent/service/CatchUpAlarmReceiver.kt`
- Manifest entry untuk `CatchUpAlarmReceiver`.

#### MODIFY `app/src/main/kotlin/com/pakpon/printagent/data/print/PrintRepository.kt`

Hapus method:
- `observePendingJobs()` + import realtime
- `fetchPendingJobs()`
- `fetchRecent()` (replaced by `PrintHistoryRepository.fetchRecent()`)
- `markPrinting()`, `markDone()`, `markFailed()`, `retry()`

Sebenarnya seluruh class bisa dihapus karena tidak ada konsumen lagi. **Action**: DELETE file `PrintRepository.kt`. Update `ServiceLocator` untuk swap dengan `PrintHistoryRepository`.

#### MODIFY `app/src/main/kotlin/com/pakpon/printagent/di/ServiceLocator.kt`

Replace `printRepository: PrintRepository` dengan `printHistoryRepository: PrintHistoryRepository`. Hapus realtime client wiring kalau ada.

### 2.5.3 `PakPonFcmService` — single-trigger path

#### MODIFY `app/src/main/kotlin/com/pakpon/printagent/service/PakPonFcmService.kt`

Tujuan: FCM jadi satu-satunya entry. Saat `onMessageReceived`:
1. Cek apakah service running (state global di `PrintAgentService.isRunning: Boolean`).
2. Kalau **TIDAK running** (user pencet Stop) → log "FCM diabaikan karena agent stopped" + return. Tidak insert apa-apa. (Web kemungkinan ngga seharusnya kirim, tapi defensive.)
3. Kalau running → parse payload inline (job_id, tx_id, target, trigger, item_ids, bytes_b64).
4. Process via `JobProcessor.processJob(...)`.
5. JobProcessor tugas: TCP send ke printer → `PrintHistoryRepository.insertDone(...)` atau `.insertFailed(...)`.

Hapus:
- `handleCatchUp()` branch
- `runBlocking { auth.refreshCurrentSession() }` (tetap useful, keep) — actually keep ini karena ada race auth setelah long freeze.

Skeleton baru:
```kotlin
override fun onMessageReceived(message: RemoteMessage) {
    if (!ServiceLocator.isInit()) ServiceLocator.init(applicationContext)

    if (!PrintAgentService.isRunning()) {
        Log.i(TAG, "FCM ignored — agent stopped")
        LogCapture.info("FCM diabaikan: agent stopped")
        return
    }

    val data = message.data
    val job = parseInlineJob(data) ?: run {
        Log.w(TAG, "FCM payload incomplete: $data")
        return
    }

    runBlocking {
        runCatching {
            SupabaseClientFactory.get().auth.refreshCurrentSession()
        }.onFailure { Log.w(TAG, "Auth refresh failed: ${it.message}") }
        JobProcessor.processJob(job)
    }
}
```

`parseInlineJob(data: Map<String,String>): InlineJob?` → return data class baru:
```kotlin
data class InlineJob(
    val id: String,
    val txId: String?,
    val target: String,    // dapur|minuman|customer
    val trigger: String,
    val itemIds: List<String>,
    val bytesB64: String,
    val agentLabel: String,
)
```

### 2.5.4 `JobProcessor` — rewrite untuk insert ke `print_history`

#### MODIFY `app/src/main/kotlin/com/pakpon/printagent/service/JobProcessor.kt`

Sekarang JobProcessor `markPrinting → TCP → markDone/markFailed` flow ke `print_queue`. Refactor jadi:

```kotlin
suspend fun processJob(job: InlineJob) {
    val agentLabel = ServiceLocator.settingsRepository.getAgentLabel()
    val agentId = lookupAgentId(agentLabel)  // optional, hash from settings

    val ip: String?; val port: Int
    when (job.target) {
        "dapur" -> { ip = settings.getDapurIp(); port = settings.getDapurPort() }
        "minuman" -> { ip = settings.getMinumanIp(); port = settings.getMinumanPort() }
        "customer" -> {
            // Customer receipt: gunakan printer dapur default (configurable di settings nanti)
            ip = settings.getCustomerReceiptIp() ?: settings.getDapurIp()
            port = settings.getCustomerReceiptPort() ?: settings.getDapurPort()
        }
        else -> {
            insertFailed(job, agentId, agentLabel, "unknown target: ${job.target}")
            return
        }
    }

    if (ip.isNullOrBlank()) {
        insertFailed(job, agentId, agentLabel, "IP belum diset untuk ${job.target}")
        return
    }

    val bytes = Base64.decode(job.bytesB64, Base64.DEFAULT)
    val result = runCatching {
        PrinterTcpClient.send(ip, port, bytes, connectTimeoutMs = 5000)
    }
    if (result.isSuccess) {
        insertDone(job, agentId, agentLabel)
    } else {
        val err = result.exceptionOrNull()
        insertFailed(job, agentId, agentLabel, err?.message ?: "unknown")
    }
}

private suspend fun insertDone(job: InlineJob, agentId: String?, agentLabel: String) {
    val row = PrintHistoryInsert(
        id = job.id,
        tx_id = job.txId.takeUnless { it.isNullOrBlank() },
        agent_id = agentId,
        agent_label = agentLabel,
        target = job.target,
        trigger = job.trigger,
        item_ids = job.itemIds.takeIf { it.isNotEmpty() },
        bytes_b64 = job.bytesB64,
        status = "done",
        done_at = Instant.now().toString(),
    )
    ServiceLocator.printHistoryRepository.insertDone(row)
}
```

Catatan implementasi:
- `Base64.decode` perlu try/catch (corrupt payload → insertFailed).
- TCP timeout 5s, retry sekali? Phase 2 simple version: no retry. Phase 3 evaluasi.
- `id` job dari FCM payload. Insert ke print_history pakai PK ini supaya idempotent — kalau FCM redeliver (rare), insert akan duplicate-key error, agent log & abort.

### 2.5.5 UI: Tab History (sudah ada) + Retry baru

Saat ini `MainViewModel` punya history filter (All/Today/Failed) yang fetch `print_queue` via `printRepository.fetchRecent`. Switch ke `printHistoryRepository.fetchRecent`.

#### MODIFY `MainViewModel`

```kotlin
class MainViewModel(
    private val printHistoryRepo: PrintHistoryRepository,   // dulu PrintRepository
    private val heartbeatRepo: HeartbeatRepository,
    private val settings: SettingsRepository,
) : ViewModel() {
    // ...
    fun refreshAgentsAndJobs() {
        viewModelScope.launch {
            ...
            val jobs = printHistoryRepo.fetchRecent(limit = 50)
            ...
        }
    }
}
```

`retryJob(historyRow: PrintHistoryRow)` baru: re-send TCP dari `bytes_b64` row tsb. Insert row baru ke history dengan trigger='reprint' atau `'reprint_additional'`, sukses/gagal sesuai hasil. **TIDAK** update row lama — preserve audit.

```kotlin
fun retryJob(row: PrintHistoryRow) {
    viewModelScope.launch {
        val newJob = InlineJob(
            id = UUID.randomUUID().toString(),
            txId = row.tx_id,
            target = row.target,
            trigger = "reprint",  // user-driven retry from app
            itemIds = row.item_ids ?: emptyList(),
            bytesB64 = row.bytes_b64,
            agentLabel = settings.getAgentLabel(),
        )
        JobProcessor.processJob(newJob)
        refreshAgentsAndJobs()
    }
}
```

### 2.5.6 Start/Stop button

#### MODIFY `MainViewModel` / Start button handler

Sekarang Start = `PrintAgentService.start(context)`. Modify supaya juga fire heartbeat dengan `status="online"` SEGERA (jangan tunggu loop) supaya web langsung tau.

Stop: `PrintAgentService.stop(context)` + onDestroy lifecycle handler yang sudah modify di 2.5.2.

#### MODIFY `PrintAgentService`

```kotlin
private val running = AtomicBoolean(false)

override fun onStartCommand(...): Int {
    running.set(true)
    // ...immediate heartbeat
    scope.launch {
        runCatching { ServiceLocator.heartbeatRepository.sendHeartbeat(status = "online") }
    }
    // ...heartbeat loop
}

override fun onDestroy() {
    running.set(false)
    runBlocking {
        runCatching { ServiceLocator.heartbeatRepository.markOffline() }
    }
    // ... existing cleanup
}

companion object {
    fun isRunning(): Boolean = runningInstance?.running?.get() == true
    // ... existing
}
```

## 2.6 Phase 2 testing

### Web

- `app/api/print/send/route.test.ts` (kalau pakai vitest e2e): mock supabase + FCM, assert 503 saat agents empty.
- `lib/fcm.test.ts` (kalau ada): assert payload data shape dengan `item_ids` stringified.
- Component test `reprint-card.test.tsx`: handle 503 → toast warning.

### Agent

- `PrintHistoryRepositoryTest` — insert with reserved chars in failure_reason.
- `JobProcessorTest` — happy path + IP not set + TCP timeout → insertFailed dengan reason yang benar.
- `PakPonFcmServiceTest` — service stopped → ignored; service running + valid payload → JobProcessor called.

### Manual end-to-end

1. Pencet Stop di agent → web banner "Agent offline" muncul (≤90s setelah).
2. Pencet Simpan & Cetak dari web → toast warning "Agent printer offline".
3. Pencet Start di agent → web banner clear, status='online' di DB.
4. Pencet Cetak ulang Dapur → nota print, row baru di `print_history` (status='done'), `transaction_items.printed_dapur_at` ter-set.
5. Matikan printer fisik, klik Cetak lagi → row baru di history (status='failed', `failure_reason='Connection timeout'`).
6. Buka agent app → tab History → tap "Retry" pada row failed → kalau printer sudah nyala, nota print, row baru status='done'.

## 2.7 Phase 2 acceptance criteria

- [ ] Web tidak insert ke `print_queue` (dropped routes return 410 Gone atau no-op).
- [ ] Web cek `agent_heartbeats.status='online' AND last_seen_at>now()-90s` sebelum push. Kalau kosong → 503.
- [ ] FCM payload bawa `item_ids` (JSON string).
- [ ] Agent terima FCM saat running → insert `print_history` (done/failed) + TCP print.
- [ ] Agent stopped → FCM diabaikan, log entry visible.
- [ ] Start button → status='online' instant.
- [ ] Stop button → status='offline' instant.
- [ ] Trigger `mark_items_printed_history` set `printed_X_at` saat history.status='done'.

---

# Phase 3 — Cleanup

Setelah Phase 2 stable di production ~1-2 minggu, cleanup boleh dijalankan.

## 3.1 Schema

### `supabase/migrations/0021_drop_print_queue.sql`

```sql
-- Akhiri masa transisi. print_queue sudah unused sejak Phase 2.
-- CASCADE: tidak ada FK lain yang reference (dependant trigger sudah di-DROP).
DROP TABLE IF EXISTS print_queue CASCADE;
ALTER PUBLICATION supabase_realtime DROP TABLE print_queue;
-- (kalau publish_realtime row sudah tidak ada, DROP TABLE sendiri yang clean up)
```

### Catatan: rollback plan untuk Phase 3

Karena DROP CASCADE, rollback = restore dari backup. Sebelum apply migration, owner harus:
1. Verify backup Supabase up-to-date (auto daily).
2. Pastikan `print_history` punya data minimal 1 minggu (sebagai bukti agent route works).

## 3.2 Web

- DELETE `app/api/print/queue/route.ts`, `[id]/retry/route.ts`, `[id]/cancel/route.ts`, `recent/route.ts`, `_schema.ts`, `_schema.test.ts`.
- DELETE Phase 2 fallback FCM `action='check_queue'` di `lib/fcm.ts`.
- DELETE usage `PrintRepository.checkQueue` kalau ada di test/scripts.

## 3.3 Agent

- DELETE `PrintJob.kt` (sudah unused setelah `PrintRepository` deleted).
- DELETE realtime + ktor channel deps kalau tidak dipakai komponen lain.
- Update `build.gradle.kts` — remove `supabase-kt:realtime` dependency.

## 3.4 Phase 3 acceptance criteria

- [ ] `print_queue` table tidak ada di Supabase.
- [ ] Tidak ada code path yang reference `print_queue` di web atau agent repo.
- [ ] Agent APK size berkurang ~50-100KB (realtime kt dropped).

---

# Risk register

| Risk | Likelihood | Impact | Mitigasi |
|---|---|---|---|
| FCM delivery delay >5s saat OEM freeze | Med | Nota print terlambat | TTL 60s di FCM; UX expectation set di toast "biasanya <5s" |
| Agent crash setelah TCP print sebelum insert history | Low | Nota fisik ada, audit hilang, flag NULL | Owner observe via "Cetak tambahan" yang akan reuse item |
| `agent_heartbeats.agent_uuid` mismatch (schema drift) | Med | Migration 0018 FK gagal apply | Pre-flight check di 2.2 sebelum jalan Phase 2 |
| Print job sukses tapi DB write gagal (network) | Low | Sama dengan crash above | Optional: agent retry insert 3x sebelum log warning |
| Owner pencet Simpan, agent offline, tidak realize | Med | Nota tidak tercetak | Toast 503 jelas + banner "Agent offline" sticky |
| Multi agent same warung receive same FCM | Low | Double print | PK `id` di payload → insert print_history clash → agent kedua abort |
| Owner test print via agent app saat FCM offline | Low | Test gagal | Tidak relevan — test print pakai TCP langsung, bypass FCM |

---

# Rollout checklist

```
PHASE 1 — Format & flag tracking
  [ ] Apply migrations 0013-0017 ke Supabase (staging + prod)
  [ ] Implement & test lib/escpos.ts + komponen + auto-print behavior
  [ ] Deploy web → smoke test full flow
  [ ] Sign-off owner: kitchen format OK, footer customer OK

PHASE 2 — FCM-only architecture
  [ ] Pre-flight: konfirmasi schema agent_heartbeats.agent_uuid ada
  [ ] Apply migrations 0018-0020 ke Supabase
  [ ] Implement web /api/print/send + handle 503 di komponen
  [ ] Implement agent: PrintHistoryRepository + JobProcessor rewrite +
      strip realtime/periodic/alarm + Start/Stop online status
  [ ] Coordinated deploy:
      a) Deploy web (legacy /api/print/queue masih ada, agent masih realtime)
      b) Install new agent build → owner pencet Start → verify online di DB
      c) Switch web client ke /api/print/send (gradual: feature flag atau big bang)
      d) Tunggu 24h, monitor print_history vs print_queue
  [ ] Sign-off owner: print biasa OK, edit tambahan OK, offline handling OK

PHASE 3 — Cleanup
  [ ] Apply migration 0021 (DROP print_queue)
  [ ] Delete dead code di web + agent
  [ ] Verify APK size & build green
```

---

# Open prerequisites / questions

1. **Schema `agent_uuid` di repo**: confirm + commit retrofit migration sebelum Phase 2 jalan.
2. **Customer receipt printer**: target='customer' di agent harus print ke printer mana? Default dapur. Pertanyaan operasional untuk owner — kalau jawab "ke dapur OK", aman pakai default. Kalau mau kasih owner pilih dari Settings, butuh kolom `customer_receipt_target` di `printer_settings` (or di agent SharedPreferences).
3. **`PrintHistoryRow.bytes_b64` retention**: row simpan full payload Base64 (~10-50KB per job). 50 jobs/hari × 365 hari = ~1GB/tahun. Mungkin perlu cron retention (e.g. drop bytes_b64 setelah 30 hari, keep header only). Out of scope untuk spec ini, taruh di backlog.
4. **Feature flag untuk transisi Phase 2**: optional. Kalau dipakai, tambah ENV `NEXT_PUBLIC_PRINT_SEND_ENDPOINT='/api/print/send'` (default) vs `'/api/print/queue'`. Kalau no flag, big bang deploy.

---

# Referensi

- Brainstorm transcript: dialog 2026-06-25 (tidak di-commit, ada di Claude history).
- Existing print system docs:
  - `docs/superpowers/specs/2026-06-23-print-nota-design.md`
  - `docs/superpowers/specs/2026-06-23-print-agent-design.md`
  - `pak-pon-print-agent/docs/firebase-fcm-plan.md` (Pre-flight FCM)
- Relevant code (sebelum Phase 1):
  - `lib/escpos.ts:117` (`renderTicket`)
  - `components/reprint-card.tsx`
  - `components/nota-review-form.tsx:232` (`handleConfirm`)
  - `app/api/print/queue/route.ts`
  - `pak-pon-print-agent/app/src/main/kotlin/com/pakpon/printagent/service/PakPonFcmService.kt`
