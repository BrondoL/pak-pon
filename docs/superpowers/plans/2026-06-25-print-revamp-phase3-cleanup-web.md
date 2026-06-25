# Phase 3 (WEB SIDE) — Cleanup — Implementation Plan

> **For agentic workers:** Plan ini dijalankan inline oleh controller (scope kecil). Spec referensi: `docs/superpowers/specs/2026-06-25-print-revamp-design.md` Phase 3.

**Goal:** Hapus sisa `print_queue` infrastructure setelah Phase 2 web ship. Drop table, hapus route handler legacy, clean `lib/fcm.ts` dari fallback `check_queue`.

**Breaking change:** Agent yang masih pakai code Phase 1 (`PrintRepository.markPrinting/markDone` via Supabase client) akan error karena table tidak ada lagi. Aman karena owner sedang rework agent ke Phase 2 (yang pakai `print_history` only).

**Out of scope:** Agent code (separate repo).

---

## Steps

### 1. Migration 0021 — DROP print_queue

```sql
-- 0021_drop_print_queue.sql
ALTER PUBLICATION supabase_realtime DROP TABLE print_queue;
DROP TABLE IF EXISTS print_queue CASCADE;
```

Apply via MCP. Commit file.

### 2. Delete dead API routes

Files to delete:
- `app/api/print/queue/route.ts`
- `app/api/print/queue/[id]/retry/route.ts`
- `app/api/print/queue/[id]/cancel/route.ts`
- `app/api/print/queue/recent/route.ts`
- `app/api/print/queue/_schema.ts`
- `app/api/print/queue/_schema.test.ts`

Delete the entire `app/api/print/queue/` directory.

### 3. Clean `lib/fcm.ts` legacy fallback

Remove the `: { action: 'check_queue' }` branch — payload always carries inline job after Phase 2.

### 4. Verify

`npm run test`, `npm run build`, `npm run lint`. All green.

### 5. Update docs

`docs/tasks.md` add Phase 1-3 completion summary.

### 6. Commit

3-4 commits: migration, route deletes, fcm cleanup, docs.
