# Primary Print Agent Selection — Design Spec

**Tanggal**: 2026-06-26
**Status**: Approved, ready untuk implementation planning
**Repo terkait**: `pak-pon` (web) — server-side only, tidak ada perubahan di `pak-pon-print-agent`

## Tujuan

`POST /api/print/send` saat ini fan-out FCM ke **semua** agent yang `status='online' AND last_seen_at > now() - 24h AND fcm_token IS NOT NULL`. Kalau 2 agent online dan dua-duanya proses pesan, akan terjadi:

1. **Double print fisik** — nota keluar 2x di printer yang sama (atau di printer paralel kalau agent ke-2 punya konfigurasi sama).
2. **Duplicate key error** di `print_history` — kedua agent insert pakai `job_id` UUID yang sama (PK), salah satu gagal dan terlihat sebagai `status='failed'` di tab History agent app.

Spec [print-revamp](2026-06-25-print-revamp-design.md) (line 1044) mencatat ini sebagai mitigasi by-design ("agent kedua abort"), tapi praktiknya menimbulkan noise (false-positive failed) dan boros (2x cetak fisik kalau printer beda).

**Solusi**: owner pilih satu **primary agent** persistent. Dispatch hanya ke primary. Tidak ada fan-out, tidak ada auto-fallback.

## Out of scope

- Per-print agent picker (dropdown di tiap modal cetak).
- Auto-fallback ke agent online lain kalau primary offline.
- Multi-warung / multi-tenant primary (1 row primary saja di tabel).
- Perubahan agent app (Kotlin). Agent tidak perlu tahu konsep primary — web yang filter.

## Decisions yang sudah ditetapkan

| # | Topik | Keputusan |
|---|---|---|
| 1 | Persistensi pilihan | **Persistent setting** — set sekali di `/setup/printer/debug`, jarang ganti. Tidak ada per-print toggle. |
| 2 | Behavior kalau primary offline | **503 + toast** sama seperti sekarang. Tidak ada auto-fallback ke agent lain. |
| 3 | Initial state saat migrasi | **Auto-elect agent paling lama** (smallest `created_at`) sebagai primary. Owner ga perlu intervensi kalau cuma 1 agent. |
| 4 | Constraint "max 1 primary" | **Partial unique index** `WHERE is_primary = true`. Database-level guarantee, bukan app-level. |
| 5 | UI placement | `/setup/printer/debug` — tambah badge + button di card agent. Bukan halaman baru. |
| 6 | Konfirmasi switch primary | **AlertDialog shadcn** ("Ganti primary ke X? Print akan dikirim ke device ini."). Tidak boleh `window.confirm`. |

---

## Architecture overview

### Sebelum

```
POST /api/print/send
  │ query agents:
  │   WHERE status='online'
  │     AND last_seen_at > now() - 24h
  │     AND fcm_token IS NOT NULL
  ▼
fan-out FCM ke SEMUA matching agents
  │
  ▼
2 agent terima → 2x TCP print + 1 INSERT print_history sukses + 1 duplicate-key failed
```

### Sesudah

```
POST /api/print/send
  │ query agents:
  │   WHERE is_primary = true        ← NEW filter
  │     AND status='online'
  │     AND last_seen_at > now() - 24h
  │     AND fcm_token IS NOT NULL
  ▼
result paling banyak 1 row
  │
  ├─ kosong → 503 detail='primary_offline'
  │
  └─ 1 row → FCM ke primary saja → 1x TCP print + 1 INSERT history
```

---

## 1. Schema

### `supabase/migrations/0024_agent_heartbeats_is_primary.sql`

```sql
-- Primary agent receives all print dispatch. Hanya 1 row boleh true via
-- partial unique index. Set lewat PATCH /api/agent/[label].
ALTER TABLE agent_heartbeats
  ADD COLUMN is_primary boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX agent_heartbeats_primary_singleton_idx
  ON agent_heartbeats (is_primary)
  WHERE is_primary = true;

-- Auto-elect agent dengan heartbeat terbaru (DESC) sebagai primary saat
-- migrasi. Tie-break id ASC supaya deterministik. Kalau tabel kosong
-- (fresh install), no-op — primary ke-set saat owner pilih manual dari
-- debug page.
UPDATE agent_heartbeats
  SET is_primary = true
  WHERE id = (
    SELECT id FROM agent_heartbeats
    ORDER BY last_seen_at DESC, id ASC
    LIMIT 1
  );
```

**Catatan**: `agent_heartbeats` tidak punya kolom `created_at` (verified — schema di 0005 + alterations 0011a/0012/0019). Awalnya rencana `ASC` (longest-registered), tapi prod cek menunjukkan agent paling lama bisa jadi yang offline (stale). `DESC` lebih aman: agent yang paling baru heartbeat-nya kemungkinan besar adalah yang lagi dipakai operasional.

### Agent app upsert tidak perlu diubah

`HeartbeatRepository.kt` upsert lewat `supabase-kt` pakai `onConflict='agent_uuid'`. Postgres `INSERT ... ON CONFLICT DO UPDATE` hanya update kolom yang ada di payload (via `EXCLUDED.col`). Karena agent app tidak kirim field `is_primary`, kolom ini tidak tersentuh saat heartbeat — flag persistent across heartbeats.

**Risk verifikasi** (pre-deploy): test scenario "set primary → wait heartbeat → cek `is_primary` masih true". Kalau ternyata supabase-kt SDK pakai full-row REPLACE behavior (bukan partial UPDATE), perlu mitigasi:
- Option A: agent kirim field `is_primary` (read-then-write pattern) — butuh perubahan agent app.
- Option B: tambah RLS policy yang block UPDATE `is_primary` dari agent's anon role — server-side enforcement.

Mitigasi spesifik diputuskan saat plan tahap implementasi setelah verifikasi.

---

## 2. API changes

### 2.1 `POST /api/print/send` — tambah filter primary

File: `app/api/print/send/route.ts`

Modifikasi query agent (line 48-53):

```ts
const { data: agents, error: queryErr } = await supabase
  .from('agent_heartbeats')
  .select('agent_label, fcm_token')
  .eq('is_primary', true)                          // ← NEW
  .eq('status', 'online')
  .gte('last_seen_at', threshold)
  .not('fcm_token', 'is', null);
```

Modifikasi response 503 (line 65-72) supaya pesan spesifik:

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

Response 200 tetap pakai shape `{ job_id, dispatched_to: [label] }` — `dispatched_to` selalu max 1 entry, tapi tetap array untuk backward-compat.

**Catatan ke-trivial**: kalau tidak ada satupun row dengan `is_primary=true` (e.g., owner delete primary tanpa pilih ganti), query return kosong → 503 sama dengan "primary offline". Toast frontend perlu copy yang covers kedua kasus.

### 2.2 `PATCH /api/agent/[label]` — set primary

File: `app/api/agent/[label]/route.ts` — tambah handler `PATCH` di samping `DELETE` yang sudah ada.

```ts
const PatchSchema = z.object({
  is_primary: z.literal(true),  // hanya bisa promote, bukan demote (demote = pilih agent lain)
}).strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ label: string }> },
) {
  const { label } = await params;
  const evt = newEvent('PATCH /api/agent/[label]', { agent_label: label });
  try {
    // ... auth check ...
    const body = await request.json();
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    // Verify target exists
    const { data: target, error: lookupErr } = await supabase
      .from('agent_heartbeats')
      .select('id, is_primary')
      .eq('agent_label', label)
      .maybeSingle();
    if (lookupErr || !target) {
      tagStatus(evt, 404);
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    if (target.is_primary) {
      // Sudah primary — no-op idempotent.
      tagStatus(evt, 200);
      return NextResponse.json({ ok: true, already_primary: true });
    }

    // Two-step swap. Tidak ada transaction client di supabase-js,
    // jadi pakai RPC `set_primary_agent(target_id uuid)` (lihat 2.4).
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
  } catch (err) { /* ... */ } finally { evt.emit(); }
}
```

### 2.3 `DELETE /api/agent/[label]` — proteksi primary

Modifikasi route yang sudah ada: blokir delete kalau target adalah primary, **kecuali** ada agent lain yang bisa di-promote. UX flow: owner harus pindahin primary dulu, baru delete.

```ts
// Sebelum delete, cek apakah primary
const { data: target } = await supabase
  .from('agent_heartbeats')
  .select('is_primary')
  .eq('agent_label', label)
  .maybeSingle();

if (target?.is_primary) {
  const { count: othersCount } = await supabase
    .from('agent_heartbeats')
    .select('id', { count: 'exact', head: true })
    .neq('agent_label', label);
  if ((othersCount ?? 0) > 0) {
    tagStatus(evt, 409);
    return NextResponse.json(
      {
        error: 'primary_in_use',
        detail: 'Pindahkan primary ke agent lain sebelum hapus agent ini.',
      },
      { status: 409 },
    );
  }
  // Kalau dia satu-satunya agent, delete OK — fresh state, primary kosong.
}
```

### 2.4 RPC `set_primary_agent`

File: `supabase/migrations/0024_agent_heartbeats_is_primary.sql` (lanjutan bagian schema).

```sql
CREATE OR REPLACE FUNCTION set_primary_agent(target_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- Atomic swap: clear existing primary, set target.
  -- Partial unique index akan reject kalau ada 2 row primary di tengah,
  -- jadi WAJIB clear dulu sebelum set.
  UPDATE agent_heartbeats SET is_primary = false WHERE is_primary = true;
  UPDATE agent_heartbeats SET is_primary = true WHERE id = target_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent % not found', target_id USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION set_primary_agent(uuid) TO authenticated;
```

Pakai RPC supaya dua UPDATE jalan dalam transaksi yang sama (Postgres function = implicit transaction). Tanpa ini, ada window microsecond di mana tabel punya 0 primary, dispatch yang masuk barengan akan 503.

### 2.5 `GET /api/agent/heartbeat` — include `is_primary`

File: `app/api/agent/heartbeat/route.ts` — tambah `is_primary` di select & response.

```ts
.select('agent_label, last_seen_at, agent_version, device_info, status, is_primary')
```

Mapping (line 41-58):

```ts
return {
  agent_label: a.agent_label,
  // ... existing fields ...
  status: a.status,
  is_primary: a.is_primary,         // ← NEW
  display_state,
  online: display_state === 'online',
};
```

Tambah field di `evt.merge`:

```ts
primary_label: agents.find((a) => a.is_primary)?.agent_label ?? null,
primary_display_state: agents.find((a) => a.is_primary)?.display_state ?? null,
```

---

## 3. UI changes

### 3.1 `/setup/printer/debug` — primary badge & toggle

File: `app/(app)/setup/printer/debug/page.tsx`

Di setiap card agent (sekarang line ~139-175), tambah:

> **Shadcn note**: `components/ui/badge.tsx` belum ada di repo (cek `components/ui/` saat ini: alert-dialog, button, card, chart, dialog, input, label, radio-group, select, sonner, textarea). Install via `npx shadcn@latest add badge` saat implementasi, atau pakai inline `<span>` ber-styling — implementor pilih sesuai konvensi.

```tsx
<div className="flex items-center gap-2">
  <p className="truncate font-medium text-coal">{a.agent_label}</p>
  {a.is_primary && (
    <Badge variant="default" className="text-xs">Primary</Badge>
  )}
</div>

{/* ... status badge, delete button existing ... */}

{!a.is_primary && (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button variant="outline" size="sm">Jadikan Primary</Button>
    </AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Ganti primary agent ke &ldquo;{a.agent_label}&rdquo;?</AlertDialogTitle>
        <AlertDialogDescription>
          Semua nota akan dikirim ke device ini. Pastikan device aktif dan
          printer-nya sudah benar di-set.
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

Handler:

```ts
async function setPrimary(label: string) {
  const res = await fetch(`/api/agent/${encodeURIComponent(label)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_primary: true }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast.error('Gagal set primary', { description: err.detail ?? err.error });
    return;
  }
  toast.success(`${label} sekarang primary`);
  await refetch();
}
```

### 3.2 `components/printer-status-banner.tsx` — primary-aware

File saat ini render banner berdasarkan "any agent online/stale/offline" (line 44-46: `hasOnline`, `hasStale`). Refactor: peduli **hanya** ke primary agent.

State machine (urutan check):

1. `agents === null` → return null (existing).
2. Tidak ada `agents.find((a) => a.is_primary)` → banner **merah** "Belum ada primary agent. Buka Setup → Printer → Debug." (link `/setup/printer/debug`).
3. Primary `display_state === 'online'` → return null (no banner — happy path).
4. Primary `display_state === 'stale'` → banner **kuning** "Primary (HP Kasir 1) kemungkinan di-background. Cek HP kalau cetak ngga jalan." (warna existing `mustard/40` + `mustard-faint`).
5. Primary `display_state === 'offline'` → banner **merah** "Primary (HP Kasir 1) belum jalan. Pencet Start di device." (warna existing `brick-soft` + `brick-faint`).

Agent non-primary tidak mempengaruhi banner — purely cadangan visual di debug page.

Implementasi: ganti `hasOnline`/`hasStale` jadi `primary = agents.find((a) => a.is_primary)` dan branch berdasar `primary?.display_state`. Sisa styling reuse existing (jangan overhaul color tokens).

### 3.3 `/setup/printer/debug` — empty-primary alert

Kalau owner buka debug page dan tidak ada satupun agent dengan `is_primary=true`, tampilkan alert di atas list. Karena `components/ui/alert.tsx` belum ada, pakai pattern div ber-styling konsisten dengan `printer-status-banner.tsx` (atau install shadcn alert: `npx shadcn@latest add alert`).

```tsx
{agents.length > 0 && !agents.some((a) => a.is_primary) && (
  <div className="rounded-md border border-brick-soft bg-brick-faint p-3 text-sm text-brick-dark">
    <p className="font-medium">Belum ada primary agent</p>
    <p>Print tidak akan jalan sampai owner pilih satu agent sebagai primary.
       Klik &ldquo;Jadikan Primary&rdquo; pada salah satu agent di bawah.</p>
  </div>
)}
```

---

## 4. Testing

### 4.1 Unit / integration (web)

- `app/api/print/send/route.test.ts` — kalau ada: assert query include filter `is_primary=true`. Skenario:
  - 2 agent online, hanya 1 primary → dispatch hanya ke primary.
  - Primary offline (`status='offline'`) → 503 `detail='primary agent offline or not set'`.
  - Tidak ada primary di tabel → 503 sama.
- `app/api/agent/[label]/route.test.ts` (baru atau extend):
  - PATCH set primary ke agent baru → sukses, response `{ ok: true }`, DB row `is_primary=true` + row lama jadi false.
  - PATCH ke agent yang sudah primary → `{ ok: true, already_primary: true }`, no-op.
  - PATCH ke label non-existent → 404.
  - PATCH body invalid (`{ is_primary: false }`) → 400.
  - DELETE primary agent saat ada agent lain → 409 `primary_in_use`.
  - DELETE primary agent saat satu-satunya → 200 OK.
- `app/api/agent/heartbeat/route.test.ts` — assert response include `is_primary` per agent.

### 4.2 Schema

- Apply migration ke local Supabase, lalu insert 3 baris dummy → verify partial unique index reject `INSERT` row ke-2 dengan `is_primary=true`.
- Test RPC `set_primary_agent(uuid)`: panggil 2x dengan target berbeda, pastikan akhir state cuma 1 row primary.

### 4.3 Manual end-to-end

1. Migrasi: cek `agent_heartbeats` — agent paling lama otomatis `is_primary=true`.
2. Buka `/setup/printer/debug` → badge "Primary" tampil di salah satu agent.
3. Klik "Jadikan Primary" di agent kedua → dialog konfirmasi → klik Set Primary → badge pindah, agent pertama tidak punya badge lagi.
4. Save tx baru saat primary online → nota print di printer device primary only (cek tidak ada double print).
5. Stop agent primary → banner berubah merah "Primary OFFLINE". Save tx → toast 503 "Primary agent offline".
6. Start agent primary lagi (atau set primary ke agent lain yang online) → cetak ulang berhasil.
7. Coba DELETE primary di UI → 409 toast "Pindahkan primary dulu".
8. Heartbeat agent jalan terus selama 5 menit → cek `is_primary` masih true (verifikasi 1.2 risk).

---

## 5. Logging

Wide-event tambahan (sesuai pattern `docs/logging.md`):

- `POST /api/print/send`:
  - `reject_reason='primary_offline'` saat 503 (sebelumnya `agent_offline` generic).
  - `dispatched_to` tetap, tapi length max 1.
- `PATCH /api/agent/[label]`:
  - `new_primary_label`, `previous_primary_label` (lookup sebelum swap).
- `GET /api/agent/heartbeat`:
  - `primary_label`, `primary_display_state` — visible di log untuk diagnose "kenapa print gagal".

---

## 6. Rollout

Single phase, deploy normal — tidak butuh koordinasi dengan agent app (Kotlin):

```
[ ] Pre-flight: pull schema `agent_heartbeats` dari Supabase, konfirmasi `created_at` ada.
[ ] Apply migration 0024 ke staging → verify backfill set 1 primary.
[ ] Implement & test API + UI changes.
[ ] Deploy web ke staging → manual end-to-end (Section 4.3).
[ ] Verify heartbeat tidak ke-reset is_primary setelah 5+ menit.
[ ] Apply migration 0024 ke prod, deploy web.
[ ] Smoke test prod: save tx → 1 nota saja keluar.
[ ] Sign-off owner.
```

Rollback: revert web deploy (filter `is_primary` hilang, kembali ke fan-out behavior). Schema bisa di-leave-in-place — kolom `is_primary` tidak menyakiti kalau tidak dipakai.

---

## 7. Risk register

| Risk | Likelihood | Impact | Mitigasi |
|---|---|---|---|
| Agent heartbeat upsert overwrite `is_primary=false` setiap 30s | Med | Primary ke-reset, semua dispatch 503 | Verifikasi manual saat staging (4.3 step 8). Kalau confirmed, RLS block atau partial-column UPDATE policy. |
| Owner delete primary tanpa set ganti, lalu coba print | Med | Toast 503, owner confused | Empty-primary alert di debug page (3.3) + 409 protection saat delete (2.3). |
| Race: dua owner pencet "Set Primary" barengan | Very Low | Salah satu request gagal | RPC atomic via PG function. Single-user system, race ekstrim. |
| Backfill tidak jalan (tabel kosong saat migrasi) | Low | Fresh install, primary kosong | Acceptable — agent register pertama akan jadi primary saat owner buka debug page (UI prompt set primary). |
| `dispatched_to` array yang sebelumnya >1 sekarang max 1 — caller yang baca panjang | Very Low | Behavior change client | Tidak ada caller yang baca panjang `dispatched_to` saat ini (cek `components/` saat implementasi). Cukup catat di changelog. |

---

## Referensi

- `docs/superpowers/specs/2026-06-25-print-revamp-design.md` — arsitektur print yang ada sekarang (Phase 2 FCM-only).
- Code (sebelum perubahan):
  - `app/api/print/send/route.ts` — query agent + fan-out.
  - `app/api/agent/[label]/route.ts` — hanya DELETE handler saat ini.
  - `app/api/agent/heartbeat/route.ts` — response shape buat banner.
  - `app/(app)/setup/printer/debug/page.tsx` — UI agent list (line 139+).
  - `components/printer-status-banner.tsx` — banner status.
- Migration history: `supabase/migrations/0019_agent_heartbeats_status.sql`, `0023_drop_print_history_agent_id.sql` (terakhir di-apply).
