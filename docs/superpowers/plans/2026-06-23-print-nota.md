# Print Nota Dapur & Minuman — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-print 2 thermal printer (dapur + minuman) iWare via RawBT bridge app setelah kasir confirm scan nota, plus reprint manual di halaman detail dan diagnostic UI untuk dev support remote.

**Architecture:** Web app generate ESC/POS bytes di client → trigger Android intent URL ke RawBT (bridge app di tab Android) → RawBT forward via TCP:9100 ke printer LAN. Server set `daily_seq` saat confirm. Status printer di localStorage per-device. Log via wide-event server-side untuk remote diagnose.

**Tech Stack:** Next.js 16 App Router, TypeScript, Vitest + jsdom + React Testing Library, Supabase (Postgres + RLS), TailwindCSS, sonner (toast), Zod (validation). Pure-function libs di `lib/`, tests adjacent (`lib/foo.test.ts`).

**Spec:** `docs/superpowers/specs/2026-06-23-print-nota-design.md`

**Out of scope (separate plan jika perlu):**
- Plan B fallback (IP-direct via settings table) — di-stub via env flag tapi tidak diimplementasi
- Bluetooth printer fallback
- Print struk PDF untuk pelanggan
- Custom layout per printer
- Auto-detect printer / mDNS

---

## Task 1: Migration `0004_print_nota.sql` — kolom `daily_seq` + tabel `print_events`

**Files:**
- Create: `supabase/migrations/0004_print_nota.sql`

- [ ] **Step 1: Tulis migration SQL**

Buat file `supabase/migrations/0004_print_nota.sql`:

```sql
-- 0004_print_nota.sql — daily_seq column & print_events table

-- 1. Add daily_seq to transactions
-- Set saat status berubah ke 'confirmed' (di PATCH endpoint).
-- Nullable supaya transaksi 'pending_review' tidak punya seq.
-- Basis hari = business-day WIB (helper di lib/date.ts).
ALTER TABLE transactions ADD COLUMN daily_seq int;

-- Index untuk lookup harian (compute next seq, dan filter business-day)
-- Note: business_date dihitung di app (lib/date.ts), tidak via SQL expression
-- supaya konsisten dengan rest of app.
CREATE INDEX transactions_business_day_seq_idx
  ON transactions (
    ((created_at AT TIME ZONE 'Asia/Jakarta')::date),
    daily_seq
  );

-- 2. print_events table — persist subset wide-event untuk diagnostic page
CREATE TABLE print_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- tx_id nullable: test print events (trigger='test') tidak terkait transaksi
  tx_id       uuid REFERENCES transactions(id) ON DELETE CASCADE,
  daily_seq   int,
  target      text NOT NULL CHECK (target IN ('dapur', 'minuman')),
  trigger     text NOT NULL CHECK (trigger IN ('auto', 'reprint', 'test')),
  outcome     text NOT NULL CHECK (outcome IN ('dispatched', 'reported_success', 'reported_failed')),
  failure_note text,
  url_scheme_variant text,
  user_agent  text,
  user_id     uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX print_events_recent_idx
  ON print_events (created_at DESC);

ALTER TABLE print_events ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read/insert print_events
-- (warung internal, 1 account share, mirror existing transactions policies)
CREATE POLICY "auth read print_events" ON print_events
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth insert print_events" ON print_events
  FOR INSERT TO authenticated WITH CHECK (true);
```

- [ ] **Step 2: Apply migration locally**

Run:
```bash
# Asumsikan Supabase local atau remote project sudah di-link
npx supabase migration up
# atau kalau pakai db push:
# npx supabase db push
```

Expected: migration applied tanpa error, `daily_seq` column muncul di `transactions`, `print_events` table tercipta.

- [ ] **Step 3: Verifikasi schema**

Run:
```bash
npx supabase db dump --schema public 2>&1 | grep -E "daily_seq|print_events" | head
```

Expected: output menunjukkan `daily_seq integer` di transactions, dan struktur `print_events` table.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0004_print_nota.sql
git commit -m "feat(db): add daily_seq column & print_events table"
```

---

## Task 2: `lib/daily-seq.ts` — helper compute next daily seq

**Files:**
- Create: `lib/daily-seq.ts`
- Create: `lib/daily-seq.test.ts`

- [ ] **Step 1: Write the failing test**

Buat `lib/daily-seq.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeNextDailySeq } from './daily-seq';

describe('computeNextDailySeq', () => {
  it('returns 1 when no existing seq in business day', () => {
    expect(computeNextDailySeq([])).toBe(1);
  });

  it('returns max + 1 from existing seqs', () => {
    expect(computeNextDailySeq([1, 2, 3])).toBe(4);
  });

  it('ignores null seqs (pending_review tx)', () => {
    expect(computeNextDailySeq([1, null, 2, null])).toBe(3);
  });

  it('handles non-contiguous seqs (e.g. soft-deleted gaps)', () => {
    expect(computeNextDailySeq([1, 5, 7])).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/daily-seq.test.ts`
Expected: FAIL with "computeNextDailySeq is not defined" or "Cannot find module './daily-seq'"

- [ ] **Step 3: Implement the lib**

Buat `lib/daily-seq.ts`:

```ts
/**
 * Compute next daily_seq dari array existing seq dalam business-day yang sama.
 * Pure function — caller bertanggung jawab query DB untuk dapat existing seqs.
 *
 * Race condition: caller harus pakai SELECT ... FOR UPDATE atau retry-on-conflict
 * di DB transaction. Lib ini tidak handle locking.
 */
export function computeNextDailySeq(existingSeqs: Array<number | null>): number {
  const nonNull = existingSeqs.filter((s): s is number => s !== null);
  if (nonNull.length === 0) return 1;
  return Math.max(...nonNull) + 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/daily-seq.test.ts`
Expected: PASS, 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add lib/daily-seq.ts lib/daily-seq.test.ts
git commit -m "feat(lib): add computeNextDailySeq helper"
```

---

## Task 3: Modify `PATCH /api/transactions/[id]` — set `daily_seq` saat confirm

**Files:**
- Modify: `app/api/transactions/[id]/route.ts`

- [ ] **Step 1: Read existing PATCH handler**

Run: `cat app/api/transactions/\[id\]/route.ts | head -200`
Identify: bagian yang handle `status='confirmed'` transition.

- [ ] **Step 2: Tambah logic generate daily_seq saat status berubah confirmed**

Di handler PATCH `app/api/transactions/[id]/route.ts`, sebelum execute UPDATE transactions (atau di dalam helper `applyHeaderUpdate` kalau pattern existing pakai helper terpisah), tambah block:

```ts
// — TAMBAHAN: generate daily_seq saat status berubah ke 'confirmed' —
import { computeNextDailySeq } from '@/lib/daily-seq';
import { businessDate, businessDayRange } from '@/lib/date';

// ... di dalam handler PATCH, setelah validasi body & sebelum UPDATE transactions:

let dailySeqToSet: number | null = null;
const isConfirming =
  parsed.data.status === 'confirmed' && existingTx.status !== 'confirmed';

if (isConfirming) {
  // Business-day basis: tanggal saat ini (bukan dari created_at lama),
  // karena daily_seq cerminkan urutan confirm hari ini.
  const ymd = businessDate(new Date());
  const { start, end } = businessDayRange(ymd);

  const { data: sameDayTxs, error: queryErr } = await supabase
    .from('transactions')
    .select('daily_seq')
    .eq('status', 'confirmed')
    .is('deleted_at', null)
    .gte('created_at', start)
    .lt('created_at', end);

  if (queryErr) {
    tagStatus(evt, 500);
    evt.error(queryErr);
    return NextResponse.json({ error: queryErr.message }, { status: 500 });
  }

  const existingSeqs = (sameDayTxs ?? []).map((r) => r.daily_seq);
  dailySeqToSet = computeNextDailySeq(existingSeqs);
  evt.set('daily_seq_assigned', dailySeqToSet);
}
```

Lalu di UPDATE statement, tambah `daily_seq: dailySeqToSet` di payload kalau `isConfirming`. Contoh pattern:
```ts
const updatePayload: Record<string, unknown> = { /* existing fields */ };
if (isConfirming && dailySeqToSet !== null) {
  updatePayload.daily_seq = dailySeqToSet;
}
```

**Note race condition:** Pendekatan ini ada race kalau 2 PATCH bersamaan. Untuk warung kecil volume rendah, risiko diterima. Mitigasi sederhana kalau jadi masalah: add `UNIQUE (business_date, daily_seq)` constraint dan retry-on-conflict. Defer ke spec berikutnya kalau benar2 ada concurrent confirm conflict di prod.

- [ ] **Step 3: Manual smoke test**

Run dev server, scan nota, confirm, lalu query DB:
```sql
SELECT id, status, daily_seq, created_at FROM transactions
ORDER BY created_at DESC LIMIT 5;
```
Expected: transaksi yang baru di-confirm punya `daily_seq` integer, transaksi `pending_review` masih `NULL`.

- [ ] **Step 4: Commit**

```bash
git add app/api/transactions/\[id\]/route.ts
git commit -m "feat(api): set daily_seq when confirming transaction"
```

---

## Task 4: `lib/escpos.ts` — ESC/POS bytes generator

**Files:**
- Create: `lib/escpos.ts`
- Create: `lib/escpos.test.ts`

- [ ] **Step 1: Write the failing test**

Buat `lib/escpos.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderTicket, type TicketInput } from './escpos';

const baseInput: TicketInput = {
  target: 'dapur',
  daily_seq: 42,
  created_at: new Date('2026-06-23T07:32:00.000Z'), // 14:32 WIB
  customer_name: 'Pak Budi',
  table_no: '5',
  items: [
    { qty: 2, name: 'Ayam Goreng', note: 'Dada, DP' },
    { qty: 1, name: 'Nasi Putih', note: null },
  ],
};

describe('renderTicket', () => {
  it('produces non-empty Uint8Array for valid input', () => {
    const bytes = renderTicket(baseInput);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(20);
  });

  it('includes target header text', () => {
    const bytes = renderTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('DAPUR');
  });

  it('includes daily_seq with hash prefix', () => {
    const bytes = renderTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('#0042');
  });

  it('omits Meja line when table_no null', () => {
    const bytes = renderTicket({ ...baseInput, table_no: null });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toContain('Meja:');
  });

  it('omits customer line when customer_name null', () => {
    const bytes = renderTicket({ ...baseInput, customer_name: null });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toContain('Pak Budi');
  });

  it('omits note line when note null', () => {
    const bytes = renderTicket({
      ...baseInput,
      items: [{ qty: 1, name: 'Nasi Putih', note: null }],
    });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toMatch(/>\s*$/m);
  });

  it('renders MINUMAN header for minuman target', () => {
    const bytes = renderTicket({ ...baseInput, target: 'minuman' });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('MINUMAN');
  });

  it('ends with cut command', () => {
    const bytes = renderTicket(baseInput);
    // ESC/POS cut: 0x1D 0x56 0x00 (full cut) or 0x1D 0x56 0x42 0x00
    const last5 = Array.from(bytes.slice(-5));
    expect(last5).toContain(0x1d);
    expect(last5).toContain(0x56);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/escpos.test.ts`
Expected: FAIL with module not found error.

- [ ] **Step 3: Implement the lib**

Buat `lib/escpos.ts`:

```ts
/**
 * ESC/POS bytes generator untuk kitchen/bar ticket.
 *
 * Subset minimal command supaya compatible dengan banyak printer thermal:
 * - ESC @         (0x1B 0x40)        Init
 * - ESC a n       (0x1B 0x61 n)       Align (0=left 1=center 2=right)
 * - ESC E n       (0x1B 0x45 n)       Bold on/off
 * - GS ! n        (0x1D 0x21 n)       Char size (0=normal, 0x11=double)
 * - LF            (0x0A)              Line feed
 * - GS V 0        (0x1D 0x56 0x00)    Full cut
 *
 * Codepage default: CP437 / Latin-1 compatible ASCII (no full UTF-8 for non-ASCII glyphs).
 */

export type TicketInput = {
  target: 'dapur' | 'minuman';
  daily_seq: number;
  created_at: Date;
  customer_name: string | null;
  table_no: string | null;
  items: Array<{
    qty: number;
    name: string;
    note: string | null;
  }>;
};

// ESC/POS command constants
const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const INIT = new Uint8Array([ESC, 0x40]);
const ALIGN_CENTER = new Uint8Array([ESC, 0x61, 0x01]);
const ALIGN_LEFT = new Uint8Array([ESC, 0x61, 0x00]);
const BOLD_ON = new Uint8Array([ESC, 0x45, 0x01]);
const BOLD_OFF = new Uint8Array([ESC, 0x45, 0x00]);
const SIZE_DOUBLE = new Uint8Array([GS, 0x21, 0x11]);
const SIZE_NORMAL = new Uint8Array([GS, 0x21, 0x00]);
const CUT = new Uint8Array([GS, 0x56, 0x00]);

function encodeText(s: string): Uint8Array {
  // Latin-1 / CP437 encoding for thermal printer compatibility
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    bytes[i] = code > 0xff ? 0x3f : code; // '?' for non-Latin-1
  }
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.byteLength;
  }
  return out;
}

function lineFeed(n = 1): Uint8Array {
  return new Uint8Array(new Array(n).fill(LF));
}

function formatSeq(n: number): string {
  return `#${n.toString().padStart(4, '0')}`;
}

function formatTimestamp(d: Date): string {
  // Format ke WIB (UTC+7) DD/MM/YYYY HH:MM
  const wib = new Date(d.getTime() + 7 * 3600 * 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(wib.getUTCDate())}/${pad(wib.getUTCMonth() + 1)}/${wib.getUTCFullYear()} ${pad(wib.getUTCHours())}:${pad(wib.getUTCMinutes())}`;
}

export function renderTicket(input: TicketInput): Uint8Array {
  const parts: Uint8Array[] = [];

  // 1. Init + center align + bold + double size header
  parts.push(INIT);
  parts.push(ALIGN_CENTER);
  parts.push(BOLD_ON);
  parts.push(SIZE_DOUBLE);
  parts.push(encodeText(input.target === 'dapur' ? 'DAPUR' : 'MINUMAN'));
  parts.push(lineFeed(1));
  parts.push(SIZE_NORMAL);
  parts.push(BOLD_OFF);

  // 2. Center align: No. antrian + meja (kalau ada)
  let line2 = formatSeq(input.daily_seq);
  if (input.table_no) line2 += `  |  Meja: ${input.table_no}`;
  parts.push(encodeText(line2));
  parts.push(lineFeed(1));

  // 3. Customer name (kalau ada)
  if (input.customer_name) {
    parts.push(encodeText(input.customer_name));
    parts.push(lineFeed(1));
  }

  // 4. Timestamp
  parts.push(encodeText(formatTimestamp(input.created_at)));
  parts.push(lineFeed(1));

  // 5. Separator
  parts.push(ALIGN_LEFT);
  parts.push(encodeText('--------------------------------'));
  parts.push(lineFeed(1));

  // 6. Items
  for (const item of input.items) {
    parts.push(encodeText(`${item.qty}x ${item.name}`));
    parts.push(lineFeed(1));
    if (item.note) {
      parts.push(encodeText(`    > ${item.note}`));
      parts.push(lineFeed(1));
    }
  }

  // 7. Bottom separator + spacing
  parts.push(encodeText('--------------------------------'));
  parts.push(lineFeed(4));

  // 8. Full cut
  parts.push(CUT);

  return concat(...parts);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/escpos.test.ts`
Expected: PASS, 8 tests passed.

- [ ] **Step 5: Commit**

```bash
git add lib/escpos.ts lib/escpos.test.ts
git commit -m "feat(lib): add renderTicket ESC/POS generator"
```

---

## Task 5: `lib/print-intent.ts` — intent URL builder

**Files:**
- Create: `lib/print-intent.ts`
- Create: `lib/print-intent.test.ts`

- [ ] **Step 1: Write the failing test**

Buat `lib/print-intent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRawBtIntentUrl, splitItemsByTarget } from './print-intent';

describe('buildRawBtIntentUrl', () => {
  const dummyBytes = new Uint8Array([0x1b, 0x40, 0x48, 0x49]); // "HI" with init

  it('builds intent URL with profile name & base64 payload', () => {
    const url = buildRawBtIntentUrl({ profile: 'Dapur', bytes: dummyBytes });
    expect(url).toMatch(/^intent:\/\//);
    expect(url).toContain('scheme=rawbt');
    expect(url).toContain('S.profile=Dapur');
    expect(url).toContain('S.payload=');
    expect(url).toContain('end');
  });

  it('encodes bytes as base64 in payload', () => {
    const url = buildRawBtIntentUrl({ profile: 'Dapur', bytes: dummyBytes });
    // base64 of [0x1b, 0x40, 0x48, 0x49] = "G0BISQ=="
    expect(url).toContain('S.payload=G0BISQ%3D%3D'); // url-encoded
  });

  it('different profiles produce different URLs', () => {
    const a = buildRawBtIntentUrl({ profile: 'Dapur', bytes: dummyBytes });
    const b = buildRawBtIntentUrl({ profile: 'Minuman', bytes: dummyBytes });
    expect(a).not.toBe(b);
    expect(b).toContain('S.profile=Minuman');
  });
});

describe('splitItemsByTarget', () => {
  const items = [
    { id: '1', menu_name_snapshot: 'Ayam Goreng', menu_category: 'makanan', qty: 2, notes: null },
    { id: '2', menu_name_snapshot: 'Nasi Putih', menu_category: 'nasi', qty: 1, notes: null },
    { id: '3', menu_name_snapshot: 'Es Teh', menu_category: 'minuman', qty: 1, notes: null },
  ];

  it('routes makanan & nasi to dapur', () => {
    const { dapur } = splitItemsByTarget(items);
    expect(dapur).toHaveLength(2);
    expect(dapur.map((i) => i.menu_category)).toEqual(['makanan', 'nasi']);
  });

  it('routes minuman to minuman', () => {
    const { minuman } = splitItemsByTarget(items);
    expect(minuman).toHaveLength(1);
    expect(minuman[0].menu_category).toBe('minuman');
  });

  it('returns empty array for target without items', () => {
    const { dapur, minuman } = splitItemsByTarget([
      { id: '1', menu_name_snapshot: 'Es Teh', menu_category: 'minuman', qty: 1, notes: null },
    ]);
    expect(dapur).toEqual([]);
    expect(minuman).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/print-intent.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement the lib**

Buat `lib/print-intent.ts`:

```ts
/**
 * Build Android intent URL untuk trigger RawBT print job.
 *
 * Format default (Plan A — multi-profile via name):
 *   intent://print/#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;S.profile=Dapur;S.payload=<base64>;end
 *
 * RawBT terima intent, lookup profile by name dari setting-nya, kirim payload via TCP:9100.
 *
 * Plan B (env flag PAK_PON_PRINTER_MODE=ip_direct, future, gak diimplementasi di plan ini):
 *   intent://...;S.ip=192.168.1.50;I.port=9100;S.payload=<base64>;end
 */

const RAWBT_PACKAGE = 'ru.a402d.rawbtprinter';

export type PrintTarget = 'dapur' | 'minuman';

export type TransactionItemForPrint = {
  id: string;
  menu_name_snapshot: string;
  menu_category: string; // 'makanan' | 'nasi' | 'minuman'
  qty: number;
  notes: string | null;
};

export type SplitItems = {
  dapur: TransactionItemForPrint[];
  minuman: TransactionItemForPrint[];
};

function uint8ToBase64(bytes: Uint8Array): string {
  // Browser-safe base64 (no Node Buffer)
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa available in browser & jsdom
  return btoa(binary);
}

export function buildRawBtIntentUrl(args: {
  profile: string;
  bytes: Uint8Array;
}): string {
  const payloadB64 = uint8ToBase64(args.bytes);
  const encodedProfile = encodeURIComponent(args.profile);
  const encodedPayload = encodeURIComponent(payloadB64);
  return `intent://print/#Intent;scheme=rawbt;package=${RAWBT_PACKAGE};S.profile=${encodedProfile};S.payload=${encodedPayload};end`;
}

/**
 * Split transaction items berdasarkan kategori menu:
 * - makanan, nasi → dapur
 * - minuman      → minuman
 */
export function splitItemsByTarget(
  items: TransactionItemForPrint[]
): SplitItems {
  const dapur: TransactionItemForPrint[] = [];
  const minuman: TransactionItemForPrint[] = [];
  for (const it of items) {
    if (it.menu_category === 'minuman') {
      minuman.push(it);
    } else if (it.menu_category === 'makanan' || it.menu_category === 'nasi') {
      dapur.push(it);
    }
    // else: unknown category, skip (defensive)
  }
  return { dapur, minuman };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/print-intent.test.ts`
Expected: PASS, 6 tests passed.

- [ ] **Step 5: Commit**

```bash
git add lib/print-intent.ts lib/print-intent.test.ts
git commit -m "feat(lib): add buildRawBtIntentUrl & splitItemsByTarget"
```

---

## Task 6: `lib/printer-status.ts` — localStorage helper

**Files:**
- Create: `lib/printer-status.ts`
- Create: `lib/printer-status.test.ts`

- [ ] **Step 1: Write the failing test**

Buat `lib/printer-status.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPrinterStatus,
  setPrinterStatus,
  STORAGE_KEY,
  type PrinterStatusMap,
} from './printer-status';

describe('printer-status', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns not_configured default for both targets when empty', () => {
    const status = getPrinterStatus();
    expect(status.dapur.state).toBe('not_configured');
    expect(status.minuman.state).toBe('not_configured');
  });

  it('set + get roundtrip', () => {
    setPrinterStatus('dapur', { state: 'success', last_check: '2026-06-23T07:00:00Z' });
    const status = getPrinterStatus();
    expect(status.dapur.state).toBe('success');
    expect(status.dapur.last_check).toBe('2026-06-23T07:00:00Z');
    expect(status.minuman.state).toBe('not_configured');
  });

  it('set both targets independently', () => {
    setPrinterStatus('dapur', { state: 'success', last_check: '2026-06-23T07:00:00Z' });
    setPrinterStatus('minuman', { state: 'failed', last_check: '2026-06-23T07:01:00Z' });
    const status = getPrinterStatus();
    expect(status.dapur.state).toBe('success');
    expect(status.minuman.state).toBe('failed');
  });

  it('handles corrupted JSON gracefully', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    const status = getPrinterStatus();
    expect(status.dapur.state).toBe('not_configured');
    expect(status.minuman.state).toBe('not_configured');
  });

  it('STORAGE_KEY is prefixed pak_pon_', () => {
    expect(STORAGE_KEY).toMatch(/^pak_pon_/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/printer-status.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement the lib**

Buat `lib/printer-status.ts`:

```ts
/**
 * localStorage helper untuk track status printer per device.
 *
 * State per target (dapur, minuman):
 * - not_configured: belum pernah test atau status di-reset
 * - success: test/print terakhir berhasil
 * - failed: test/print terakhir gagal (manual lapor user)
 *
 * SSR-safe: cek typeof window.
 */

export const STORAGE_KEY = 'pak_pon_printer_status';

export type PrinterStatusState = 'success' | 'failed' | 'not_configured';
export type PrinterTarget = 'dapur' | 'minuman';

export type PrinterStatus = {
  state: PrinterStatusState;
  last_check: string | null; // ISO timestamp
  last_outcome_note?: string;
};

export type PrinterStatusMap = {
  dapur: PrinterStatus;
  minuman: PrinterStatus;
};

const DEFAULT: PrinterStatusMap = {
  dapur: { state: 'not_configured', last_check: null },
  minuman: { state: 'not_configured', last_check: null },
};

export function getPrinterStatus(): PrinterStatusMap {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<PrinterStatusMap>;
    return {
      dapur: parsed.dapur ?? DEFAULT.dapur,
      minuman: parsed.minuman ?? DEFAULT.minuman,
    };
  } catch {
    return DEFAULT;
  }
}

export function setPrinterStatus(target: PrinterTarget, status: PrinterStatus): void {
  if (typeof window === 'undefined') return;
  const current = getPrinterStatus();
  const next: PrinterStatusMap = { ...current, [target]: status };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/printer-status.test.ts`
Expected: PASS, 5 tests passed.

- [ ] **Step 5: Commit**

```bash
git add lib/printer-status.ts lib/printer-status.test.ts
git commit -m "feat(lib): add printer-status localStorage helper"
```

---

## Task 7: `POST /api/print/log` — log endpoint dengan persist ke `print_events`

**Files:**
- Create: `app/api/print/log/route.ts`
- Create: `app/api/print/log/_schema.ts`
- Create: `app/api/print/log/_schema.test.ts`

- [ ] **Step 1: Write schema test**

Buat `app/api/print/log/_schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PrintLogSchema } from './_schema';

describe('PrintLogSchema', () => {
  const valid = {
    tx_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    daily_seq: 42,
    target: 'dapur',
    trigger: 'auto',
    outcome: 'dispatched',
  };

  it('accepts valid payload', () => {
    const result = PrintLogSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects invalid target', () => {
    const result = PrintLogSchema.safeParse({ ...valid, target: 'bar' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid trigger', () => {
    const result = PrintLogSchema.safeParse({ ...valid, trigger: 'foo' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid outcome', () => {
    const result = PrintLogSchema.safeParse({ ...valid, outcome: 'xyz' });
    expect(result.success).toBe(false);
  });

  it('accepts null daily_seq', () => {
    const result = PrintLogSchema.safeParse({ ...valid, daily_seq: null });
    expect(result.success).toBe(true);
  });

  it('accepts null tx_id (for test prints)', () => {
    const result = PrintLogSchema.safeParse({ ...valid, tx_id: null });
    expect(result.success).toBe(true);
  });

  it('accepts optional failure_note, url_scheme_variant, user_agent', () => {
    const result = PrintLogSchema.safeParse({
      ...valid,
      failure_note: 'kertas habis',
      url_scheme_variant: 'rawbt-intent-v1',
      user_agent: 'Mozilla/5.0',
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/print/log/_schema.test.ts`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement schema**

Buat `app/api/print/log/_schema.ts`:

```ts
import { z } from 'zod';

export const PrintLogSchema = z.object({
  // tx_id null untuk test print (gak terkait transaksi)
  tx_id: z.string().uuid().nullable(),
  daily_seq: z.number().int().nullable(),
  target: z.enum(['dapur', 'minuman']),
  trigger: z.enum(['auto', 'reprint', 'test']),
  outcome: z.enum(['dispatched', 'reported_success', 'reported_failed']),
  failure_note: z.string().optional(),
  url_scheme_variant: z.string().optional(),
  user_agent: z.string().optional(),
}).strict();

export type PrintLogInput = z.infer<typeof PrintLogSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/print/log/_schema.test.ts`
Expected: PASS, 6 tests passed.

- [ ] **Step 5: Implement route handler**

Buat `app/api/print/log/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { PrintLogSchema } from './_schema';

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/print/log');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = PrintLogSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ validation_errors: parsed.error.flatten() });
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const payload = parsed.data;
    evt.merge({
      tx_id: payload.tx_id,
      daily_seq: payload.daily_seq,
      target: payload.target,
      trigger: payload.trigger,
      outcome: payload.outcome,
      url_scheme_variant: payload.url_scheme_variant,
      failure_note: payload.failure_note,
    });

    // Persist subset ke print_events table untuk diagnostic page
    const { error: insertErr } = await supabase
      .from('print_events')
      .insert({
        tx_id: payload.tx_id, // null untuk test print, valid uuid untuk auto/reprint
        daily_seq: payload.daily_seq,
        target: payload.target,
        trigger: payload.trigger,
        outcome: payload.outcome,
        failure_note: payload.failure_note ?? null,
        url_scheme_variant: payload.url_scheme_variant ?? null,
        user_agent: payload.user_agent ?? null,
        user_id: user.id,
      });
    if (insertErr) {
      tagStatus(evt, 500);
      evt.error(insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    tagStatus(evt, 204);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 6: Manual smoke test**

Run dev server, login, lalu via browser console:
```js
fetch('/api/print/log', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tx_id: '<existing-tx-id-from-db>',
    daily_seq: 1,
    target: 'dapur',
    trigger: 'test',
    outcome: 'dispatched',
  }),
}).then((r) => console.log(r.status));
```
Expected: status `204`. Verifikasi row baru di `print_events` via Supabase studio.

- [ ] **Step 7: Commit**

```bash
git add app/api/print/log/
git commit -m "feat(api): add POST /api/print/log endpoint"
```

---

## Task 8: `GET /api/print/log/recent` — fetch recent events

**Files:**
- Create: `app/api/print/log/recent/route.ts`

- [ ] **Step 1: Implement route**

Buat `app/api/print/log/recent/route.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/print/log/recent');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const limitParam = request.nextUrl.searchParams.get('limit');
    const limit = Math.min(
      Math.max(parseInt(limitParam ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    evt.set('limit', limit);

    const { data, error } = await supabase
      .from('print_events')
      .select('id, tx_id, daily_seq, target, trigger, outcome, failure_note, url_scheme_variant, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    evt.set('rows_count', data?.length ?? 0);
    tagStatus(evt, 200);
    return NextResponse.json({ events: data ?? [] });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
```

- [ ] **Step 2: Manual smoke test**

Setelah Task 7 sudah ada beberapa entry di `print_events`, run dev server, login, akses URL:
`http://localhost:3000/api/print/log/recent?limit=5`
Expected: JSON `{ events: [...] }` dengan array dari recent print events.

- [ ] **Step 3: Commit**

```bash
git add app/api/print/log/recent/
git commit -m "feat(api): add GET /api/print/log/recent endpoint"
```

---

## Task 9: `scripts/printer-emulator.js` — dev TCP printer emulator

**Files:**
- Create: `scripts/printer-emulator.js`

- [ ] **Step 1: Create the script**

Buat `scripts/printer-emulator.js`:

```js
#!/usr/bin/env node
/**
 * Printer emulator untuk dev self-test (§9.5 design spec).
 *
 * Listen TCP socket, capture ESC/POS bytes dari RawBT, dump ke file
 * dan print ASCII preview di terminal.
 *
 * Usage:
 *   node scripts/printer-emulator.js [port] [label]
 *
 * Examples:
 *   node scripts/printer-emulator.js 9100 dapur
 *   node scripts/printer-emulator.js 9101 minuman
 *
 * Run dua paralel di terminal berbeda untuk simulate 2 printer.
 */

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const PORT = parseInt(process.argv[2] || '9100', 10);
const LABEL = process.argv[3] || 'dapur';
const OUT_DIR = path.resolve('tmp/print-emulator', LABEL);

fs.mkdirSync(OUT_DIR, { recursive: true });

const server = net.createServer((socket) => {
  const chunks = [];
  socket.on('data', (chunk) => chunks.push(chunk));
  socket.on('end', () => {
    const buffer = Buffer.concat(chunks);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = path.join(OUT_DIR, `print-${ts}.bin`);
    fs.writeFileSync(filename, buffer);

    // ASCII preview: strip ESC/POS commands (any byte < 0x20 except 0x0A LF; any byte > 0x7E)
    const asciiPreview = buffer
      .toString('latin1')
      .replace(/[\x00-\x09\x0B-\x1F\x7F-\xFF]/g, '');
    console.log('━'.repeat(50));
    console.log(`✓ [${LABEL}] ${buffer.byteLength} bytes → ${filename}`);
    console.log('--- preview ---');
    console.log(asciiPreview);
    console.log('━'.repeat(50));
  });
  socket.on('error', (err) => console.error(`[${LABEL}] socket error:`, err.message));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[${LABEL}] listening on 0.0.0.0:${PORT}`);
  console.log(`[${LABEL}] output dir: ${OUT_DIR}`);
});

process.on('SIGINT', () => {
  console.log(`\n[${LABEL}] shutting down`);
  server.close(() => process.exit(0));
});
```

- [ ] **Step 2: Test the emulator manually**

Run di terminal:
```bash
node scripts/printer-emulator.js 9100 dapur
```
Di terminal lain, kirim bytes:
```bash
echo -e '\x1b@Hello world\n\x1dV\x00' | nc localhost 9100
```
Expected: terminal pertama tampilkan "✓ [dapur] N bytes → ...bin" dan preview "Hello world".

- [ ] **Step 3: Add convenience npm script**

Edit `package.json`, di section `scripts` tambah:

```json
"emulator:dapur": "node scripts/printer-emulator.js 9100 dapur",
"emulator:minuman": "node scripts/printer-emulator.js 9101 minuman"
```

- [ ] **Step 4: Add tmp/ to .gitignore**

Edit `.gitignore`, tambah baris kalau belum ada:
```
tmp/
```

- [ ] **Step 5: Commit**

```bash
git add scripts/printer-emulator.js package.json .gitignore
git commit -m "feat(dev): add printer emulator script for self-test"
```

---

## Task 10: `<PrinterStatusBanner />` component

**Files:**
- Create: `components/printer-status-banner.tsx`
- Create: `components/printer-status-banner.test.tsx`

- [ ] **Step 1: Write the failing test**

Buat `components/printer-status-banner.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrinterStatusBanner } from './printer-status-banner';
import { STORAGE_KEY } from '@/lib/printer-status';

describe('<PrinterStatusBanner />', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders red banner when both targets not_configured', () => {
    render(<PrinterStatusBanner />);
    expect(screen.getByText(/setup printer/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /setup printer/i })).toHaveAttribute('href', '/setup/printer');
  });

  it('renders red banner when any target failed', () => {
    const recentISO = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      dapur: { state: 'success', last_check: recentISO },
      minuman: { state: 'failed', last_check: recentISO },
    }));
    render(<PrinterStatusBanner />);
    expect(screen.getByText(/printer minuman/i)).toBeInTheDocument();
  });

  it('renders nothing (or hidden) when both success within 24h', () => {
    const recentISO = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      dapur: { state: 'success', last_check: recentISO },
      minuman: { state: 'success', last_check: recentISO },
    }));
    const { container } = render(<PrinterStatusBanner />);
    expect(container.querySelector('[data-testid="printer-banner"]')).toBeNull();
  });

  it('renders yellow stale warning when success >24h ago', () => {
    const staleISO = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      dapur: { state: 'success', last_check: staleISO },
      minuman: { state: 'success', last_check: staleISO },
    }));
    render(<PrinterStatusBanner />);
    expect(screen.getByText(/sudah lama tidak dites/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/printer-status-banner.test.tsx`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement component**

Buat `components/printer-status-banner.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getPrinterStatus, type PrinterStatusMap } from '@/lib/printer-status';

const STALE_MS = 24 * 3600 * 1000;

type BannerState = 'hidden' | 'red' | 'yellow';

function computeBannerState(status: PrinterStatusMap): {
  level: BannerState;
  failed_targets: string[];
} {
  const targets = ['dapur', 'minuman'] as const;
  const failed: string[] = [];
  let anyNotConfigured = false;
  let anyStale = false;

  for (const t of targets) {
    const s = status[t];
    if (s.state === 'not_configured') anyNotConfigured = true;
    else if (s.state === 'failed') failed.push(t);
    else if (s.state === 'success') {
      if (!s.last_check || (Date.now() - new Date(s.last_check).getTime() > STALE_MS)) {
        anyStale = true;
      }
    }
  }

  if (anyNotConfigured || failed.length > 0) return { level: 'red', failed_targets: failed };
  if (anyStale) return { level: 'yellow', failed_targets: [] };
  return { level: 'hidden', failed_targets: [] };
}

export function PrinterStatusBanner() {
  const [status, setStatus] = useState<PrinterStatusMap | null>(null);

  useEffect(() => {
    setStatus(getPrinterStatus());
  }, []);

  if (!status) return null;
  const banner = computeBannerState(status);
  if (banner.level === 'hidden') return null;

  if (banner.level === 'red') {
    const msg =
      banner.failed_targets.length > 0
        ? `Printer ${banner.failed_targets.join(' & ')} bermasalah`
        : 'Printer belum di-setup';
    return (
      <div
        data-testid="printer-banner"
        className="mx-4 my-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
      >
        <div className="flex items-center justify-between gap-2">
          <span>{msg}</span>
          <Link
            href="/setup/printer"
            className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white"
          >
            Setup printer
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="printer-banner"
      className="mx-4 my-2 rounded-md border border-yellow-300 bg-yellow-50 p-2 text-xs text-yellow-900"
    >
      <div className="flex items-center justify-between gap-2">
        <span>Sudah lama tidak dites — coba tes printer?</span>
        <Link href="/setup/printer" className="underline">
          Tes printer
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/printer-status-banner.test.tsx`
Expected: PASS, 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add components/printer-status-banner.tsx components/printer-status-banner.test.tsx
git commit -m "feat(ui): add PrinterStatusBanner component"
```

---

## Task 11: `<TestPrintDialog />` component

**Files:**
- Create: `components/test-print-dialog.tsx`
- Create: `components/test-print-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

Buat `components/test-print-dialog.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TestPrintDialog } from './test-print-dialog';
import { STORAGE_KEY, getPrinterStatus } from '@/lib/printer-status';

describe('<TestPrintDialog />', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    // Prevent jsdom navigation error from intent URL trigger
    vi.spyOn(window, 'open').mockImplementation(() => null);
    // Mock fetch for /api/print/log
    global.fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch;
  });

  it('renders trigger button initially', () => {
    render(<TestPrintDialog target="dapur" onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /cetak tes/i })).toBeInTheDocument();
  });

  it('shows confirmation prompt after firing test', async () => {
    const user = userEvent.setup();
    render(<TestPrintDialog target="dapur" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /cetak tes/i }));
    expect(screen.getByText(/berhasil/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /berhasil/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /gagal/i })).toBeInTheDocument();
  });

  it('sets status success when user confirms berhasil', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TestPrintDialog target="dapur" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /cetak tes/i }));
    await user.click(screen.getByRole('button', { name: /berhasil/i }));
    const status = getPrinterStatus();
    expect(status.dapur.state).toBe('success');
    expect(onClose).toHaveBeenCalled();
  });

  it('sets status failed when user confirms gagal & tutup', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TestPrintDialog target="dapur" onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: /cetak tes/i }));
    await user.click(screen.getByRole('button', { name: /gagal/i }));
    await user.click(screen.getByRole('button', { name: /tutup/i }));
    const status = getPrinterStatus();
    expect(status.dapur.state).toBe('failed');
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/test-print-dialog.test.tsx`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement component**

Buat `components/test-print-dialog.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { setPrinterStatus, type PrinterTarget } from '@/lib/printer-status';
import { renderTicket } from '@/lib/escpos';
import { buildRawBtIntentUrl } from '@/lib/print-intent';

type Phase = 'idle' | 'awaiting_confirm' | 'failed_followup';

function profileForTarget(target: PrinterTarget): string {
  return target === 'dapur' ? 'Dapur' : 'Minuman';
}

function fireTestIntent(target: PrinterTarget) {
  const bytes = renderTicket({
    target,
    daily_seq: 0,
    created_at: new Date(),
    customer_name: null,
    table_no: null,
    items: [{ qty: 1, name: `TES PRINTER ${target.toUpperCase()}`, note: null }],
  });
  const url = buildRawBtIntentUrl({ profile: profileForTarget(target), bytes });
  // Trigger intent via window.location for Android Chrome
  window.location.href = url;
}

async function postLog(payload: {
  target: PrinterTarget;
  outcome: 'dispatched' | 'reported_success' | 'reported_failed';
  failure_note?: string;
}) {
  try {
    await fetch('/api/print/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id: null, // test print gak terkait tx
        daily_seq: null,
        target: payload.target,
        trigger: 'test',
        outcome: payload.outcome,
        failure_note: payload.failure_note,
        url_scheme_variant: 'rawbt-intent-v1',
        user_agent: navigator.userAgent,
      }),
    });
  } catch {
    // Best-effort logging, swallow
  }
}

export function TestPrintDialog({
  target,
  onClose,
}: {
  target: PrinterTarget;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [failureNote, setFailureNote] = useState('');

  function handleFire() {
    fireTestIntent(target);
    postLog({ target, outcome: 'dispatched' });
    setPhase('awaiting_confirm');
  }

  function handleSuccess() {
    setPrinterStatus(target, {
      state: 'success',
      last_check: new Date().toISOString(),
      last_outcome_note: 'test print success',
    });
    postLog({ target, outcome: 'reported_success' });
    onClose();
  }

  function handleFailedClicked() {
    setPhase('failed_followup');
  }

  function handleRetry() {
    fireTestIntent(target);
    postLog({ target, outcome: 'dispatched' });
    setPhase('awaiting_confirm');
    setFailureNote('');
  }

  function handleCloseAsFailed() {
    setPrinterStatus(target, {
      state: 'failed',
      last_check: new Date().toISOString(),
      last_outcome_note: failureNote || 'test print failed',
    });
    postLog({ target, outcome: 'reported_failed', failure_note: failureNote || undefined });
    onClose();
  }

  const label = target.toUpperCase();

  if (phase === 'idle') {
    return (
      <div className="space-y-3 rounded-md border bg-card p-4">
        <h3 className="font-medium">Cetak tes printer {label}</h3>
        <p className="text-sm text-muted-foreground">
          Pastikan kertas terpasang, lalu tekan tombol di bawah.
        </p>
        <button
          onClick={handleFire}
          className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Cetak Tes Sekarang
        </button>
      </div>
    );
  }

  if (phase === 'awaiting_confirm') {
    return (
      <div className="space-y-3 rounded-md border bg-card p-4">
        <h3 className="font-medium">Apakah kertas keluar?</h3>
        <p className="text-sm text-muted-foreground">
          Bertuliskan &quot;TES PRINTER {label}&quot;
        </p>
        <div className="flex gap-2">
          <button
            onClick={handleSuccess}
            className="flex-1 rounded-md bg-green-600 px-4 py-2 text-white"
          >
            ✓ Berhasil
          </button>
          <button
            onClick={handleFailedClicked}
            className="flex-1 rounded-md border border-red-300 px-4 py-2 text-red-700"
          >
            ✗ Gagal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border bg-card p-4">
      <h3 className="font-medium">Apa yang terjadi?</h3>
      <textarea
        value={failureNote}
        onChange={(e) => setFailureNote(e.target.value)}
        placeholder="Kertas tidak keluar, error, dll (opsional)"
        className="w-full rounded-md border p-2 text-sm"
        rows={3}
      />
      <div className="flex gap-2">
        <button onClick={handleRetry} className="flex-1 rounded-md border px-4 py-2">
          Coba Lagi
        </button>
        <button
          onClick={handleCloseAsFailed}
          className="flex-1 rounded-md bg-red-600 px-4 py-2 text-white"
        >
          Tutup
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/test-print-dialog.test.tsx`
Expected: PASS, 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add components/test-print-dialog.tsx components/test-print-dialog.test.tsx
git commit -m "feat(ui): add TestPrintDialog component"
```

---

## Task 12: `<ReprintCard />` component

**Files:**
- Create: `components/reprint-card.tsx`
- Create: `components/reprint-card.test.tsx`

- [ ] **Step 1: Write the failing test**

Buat `components/reprint-card.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReprintCard } from './reprint-card';

const txBase = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  daily_seq: 42,
  created_at: '2026-06-23T07:32:00.000Z',
  customer_name: 'Pak Budi',
  table_no: '5',
};

const itemsBoth = [
  { id: '1', menu_name_snapshot: 'Ayam', menu_category: 'makanan', qty: 2, notes: null },
  { id: '2', menu_name_snapshot: 'Es Teh', menu_category: 'minuman', qty: 1, notes: null },
];
const itemsDapurOnly = [
  { id: '1', menu_name_snapshot: 'Ayam', menu_category: 'makanan', qty: 2, notes: null },
];
const itemsMinumanOnly = [
  { id: '1', menu_name_snapshot: 'Es Teh', menu_category: 'minuman', qty: 1, notes: null },
];

describe('<ReprintCard />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(window, 'open').mockImplementation(() => null);
    Object.defineProperty(window, 'location', {
      value: { ...window.location, href: '' },
      writable: true,
    });
    global.fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch;
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

  it('shows confirmation prompt after print', async () => {
    const user = userEvent.setup();
    render(<ReprintCard transaction={txBase} items={itemsBoth} />);
    await user.click(screen.getByRole('button', { name: /cetak dapur/i }));
    expect(screen.getByText(/berhasil/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/reprint-card.test.tsx`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement component**

Buat `components/reprint-card.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { renderTicket } from '@/lib/escpos';
import { buildRawBtIntentUrl, splitItemsByTarget, type TransactionItemForPrint } from '@/lib/print-intent';
import { setPrinterStatus, type PrinterTarget } from '@/lib/printer-status';

type TxBase = {
  id: string;
  daily_seq: number | null;
  created_at: string;
  customer_name: string | null;
  table_no: string | null;
};

function profileForTarget(target: PrinterTarget): string {
  return target === 'dapur' ? 'Dapur' : 'Minuman';
}

async function postLog(payload: {
  tx_id: string;
  daily_seq: number | null;
  target: PrinterTarget;
  outcome: 'dispatched' | 'reported_success' | 'reported_failed';
  trigger: 'reprint';
  failure_note?: string;
}) {
  try {
    await fetch('/api/print/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        url_scheme_variant: 'rawbt-intent-v1',
        user_agent: navigator.userAgent,
      }),
    });
  } catch {
    // best-effort
  }
}

export function ReprintCard({
  transaction,
  items,
}: {
  transaction: TxBase;
  items: TransactionItemForPrint[];
}) {
  const [pending, setPending] = useState<PrinterTarget | null>(null);
  const split = splitItemsByTarget(items);
  const hasDapur = split.dapur.length > 0;
  const hasMinuman = split.minuman.length > 0;

  function fireFor(target: PrinterTarget) {
    const targetItems = target === 'dapur' ? split.dapur : split.minuman;
    if (targetItems.length === 0) return;
    const bytes = renderTicket({
      target,
      daily_seq: transaction.daily_seq ?? 0,
      created_at: new Date(transaction.created_at),
      customer_name: transaction.customer_name,
      table_no: transaction.table_no,
      items: targetItems.map((i) => ({
        qty: i.qty,
        name: i.menu_name_snapshot,
        note: i.notes,
      })),
    });
    const url = buildRawBtIntentUrl({ profile: profileForTarget(target), bytes });
    window.location.href = url;
    postLog({
      tx_id: transaction.id,
      daily_seq: transaction.daily_seq,
      target,
      trigger: 'reprint',
      outcome: 'dispatched',
    });
    setPending(target);
  }

  function fireBoth() {
    if (hasDapur) fireFor('dapur');
    if (hasMinuman) {
      // Sequential dengan delay supaya RawBT gak overlap
      setTimeout(() => fireFor('minuman'), 300);
    }
  }

  function confirmSuccess() {
    if (!pending) return;
    setPrinterStatus(pending, {
      state: 'success',
      last_check: new Date().toISOString(),
      last_outcome_note: `reprint ${pending}`,
    });
    postLog({
      tx_id: transaction.id,
      daily_seq: transaction.daily_seq,
      target: pending,
      trigger: 'reprint',
      outcome: 'reported_success',
    });
    setPending(null);
  }

  function confirmFailed() {
    if (!pending) return;
    setPrinterStatus(pending, {
      state: 'failed',
      last_check: new Date().toISOString(),
      last_outcome_note: `reprint ${pending} failed`,
    });
    postLog({
      tx_id: transaction.id,
      daily_seq: transaction.daily_seq,
      target: pending,
      trigger: 'reprint',
      outcome: 'reported_failed',
    });
    setPending(null);
  }

  if (pending) {
    return (
      <div className="rounded-md border bg-card p-4 space-y-3">
        <h3 className="font-medium">Cetak ulang ke {pending.toUpperCase()}</h3>
        <p className="text-sm">Apakah kertas berhasil keluar?</p>
        <div className="flex gap-2">
          <button onClick={confirmSuccess} className="flex-1 rounded-md bg-green-600 px-4 py-2 text-white">
            ✓ Berhasil
          </button>
          <button onClick={confirmFailed} className="flex-1 rounded-md border border-red-300 px-4 py-2 text-red-700">
            ✗ Gagal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card p-4 space-y-3">
      <h3 className="font-medium">Cetak ulang</h3>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => fireFor('dapur')}
          disabled={!hasDapur}
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          Cetak Dapur
        </button>
        <button
          onClick={() => fireFor('minuman')}
          disabled={!hasMinuman}
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          Cetak Minuman
        </button>
      </div>
      <button
        onClick={fireBoth}
        disabled={!hasDapur && !hasMinuman}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        Cetak Keduanya
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/reprint-card.test.tsx`
Expected: PASS, 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add components/reprint-card.tsx components/reprint-card.test.tsx
git commit -m "feat(ui): add ReprintCard component"
```

---

## Task 13: Modify `components/nota-review-form.tsx` — auto-print on confirm

**Files:**
- Modify: `components/nota-review-form.tsx`

**Konteks:** Confirm handler ada di `handleConfirm()` (sekitar baris 73). Setelah PATCH success (response punya `{ transaction, items }`), saat ini langsung `router.push('/')`. Modifikasi: tambah trigger print sebelum redirect. Items punya `menu_id` (NotaItem type), category bisa di-lookup dari `menus: MenuOption[]` prop yang sudah ada.

- [ ] **Step 1: Cek shape MenuOption — pastikan punya category**

```bash
grep -n "MenuOption\|category" components/nota-item-modal.tsx
```
Expected: `MenuOption` type punya field `category`. Kalau tidak, tambah ke type definition (field sudah ada di DB schema `menus.category`).

- [ ] **Step 2: Tambah imports & helper di nota-review-form.tsx**

Di bagian imports atas:
```tsx
import { renderTicket } from '@/lib/escpos';
import { buildRawBtIntentUrl, splitItemsByTarget, type TransactionItemForPrint } from '@/lib/print-intent';
import { setPrinterStatus, type PrinterTarget } from '@/lib/printer-status';
```

Di dalam component scope (sebelum `return`), tambah helper:
```tsx
async function postPrintLog(args: {
  tx_id: string;
  daily_seq: number | null;
  target: PrinterTarget;
  outcome: 'dispatched';
}) {
  try {
    await fetch('/api/print/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...args,
        trigger: 'auto',
        url_scheme_variant: 'rawbt-intent-v1',
        user_agent: navigator.userAgent,
      }),
    });
  } catch { /* swallow */ }
}

function triggerAutoPrint(
  confirmedTx: { id: string; daily_seq: number | null; created_at: string; customer_name: string | null; table_no: string | null },
  itemsForPrint: TransactionItemForPrint[],
): PrinterTarget[] {
  const split = splitItemsByTarget(itemsForPrint);
  const targets: PrinterTarget[] = [];
  if (split.dapur.length > 0) targets.push('dapur');
  if (split.minuman.length > 0) targets.push('minuman');

  targets.forEach((target, idx) => {
    setTimeout(() => {
      const targetItems = target === 'dapur' ? split.dapur : split.minuman;
      const bytes = renderTicket({
        target,
        daily_seq: confirmedTx.daily_seq ?? 0,
        created_at: new Date(confirmedTx.created_at),
        customer_name: confirmedTx.customer_name,
        table_no: confirmedTx.table_no,
        items: targetItems.map((i) => ({
          qty: i.qty,
          name: i.menu_name_snapshot,
          note: i.notes,
        })),
      });
      const url = buildRawBtIntentUrl({
        profile: target === 'dapur' ? 'Dapur' : 'Minuman',
        bytes,
      });
      window.location.href = url;
      postPrintLog({
        tx_id: confirmedTx.id,
        daily_seq: confirmedTx.daily_seq,
        target,
        outcome: 'dispatched',
      });
      setPrinterStatus(target, {
        state: 'success',
        last_check: new Date().toISOString(),
        last_outcome_note: 'auto print',
      });
    }, idx * 300);
  });

  return targets;
}
```

- [ ] **Step 3: Modify `handleConfirm` untuk trigger print sebelum redirect**

Replace bagian try block di `handleConfirm()`:

**Before (existing):**
```tsx
const res = await fetch(`/api/transactions/${transaction.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
if (!res.ok) {
  const data: { error?: string } = await res.json().catch(() => ({}));
  throw new Error(data.error ?? 'patch-failed');
}
toast.success('Nota tersimpan', {
  description: 'Transaksi sudah masuk laporan harian.',
});
startTransition(() => {
  router.push('/');
});
```

**After:**
```tsx
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

// Lookup category dari `menus` prop pakai menu_id
const itemsForPrint: TransactionItemForPrint[] = data.items.map((it) => {
  const menu = menus.find((m) => m.id === it.menu_id);
  return {
    id: it.id,
    menu_name_snapshot: it.menu_name_snapshot,
    menu_category: menu?.category ?? 'makanan', // defensive fallback: unknown → dapur
    qty: it.qty,
    notes: it.notes,
  };
});

const printedTargets = triggerAutoPrint(data.transaction, itemsForPrint);

toast.success(
  printedTargets.length > 0
    ? `Nota tersimpan, mencetak ke ${printedTargets.join(' & ')}...`
    : 'Nota tersimpan'
);

startTransition(() => {
  router.push('/');
});
```

- [ ] **Step 4: Rename button text "✓ Konfirmasi" → "✓ Simpan & Cetak"**

Ganti (sekitar baris 236):
```tsx
{pending ? 'Menyimpan…' : '✓ Konfirmasi'}
```
Jadi:
```tsx
{pending ? 'Menyimpan…' : '✓ Simpan & Cetak'}
```

- [ ] **Step 5: Manual smoke test**

1. `npm run dev`
2. Terminal 2: `npm run emulator:dapur`, terminal 3: `npm run emulator:minuman`
3. Scan nota dummy via desktop browser (atau via HP Android dev kalau test full intent)
4. Klik "Simpan & Cetak"
5. Expected: toast muncul, redirect ke `/`, di terminal emulator (kalau test dari HP Android + RawBT terkonfig) muncul preview bytes.

Catatan: intent URL `intent://...` cuma trigger app di Android Chrome — di desktop browser nothing happens (normal, gak ada error).

- [ ] **Step 6: Commit**

```bash
git add components/nota-review-form.tsx components/nota-item-modal.tsx
git commit -m "feat(scan): trigger auto-print after confirm + rename button"
```

---

## Task 14: Embed `<ReprintCard />` di transaction detail (+ fetch menu_category via join)

**Files:**
- Modify: `app/api/transactions/[id]/route.ts` (GET handler — tambah join)
- Modify: `app/(app)/transactions/[id]/page.tsx` (atau component file detail-nya)

**Konteks:** `transaction_items` table TIDAK simpan `menu_category` (cuma `menu_name_snapshot`). Untuk routing ke printer dapur vs minuman, perlu category. Solusi: join `menus(category)` via foreign-table select di GET endpoint. Aman karena `menus` pakai soft delete (`is_active=false`) per CLAUDE.md, FK selalu valid.

- [ ] **Step 1: Update GET handler include menu category via join**

Di `app/api/transactions/[id]/route.ts`, GET handler — ubah query items:

**Before:**
```ts
const { data: items, error: itemsError } = await supabase
  .from('transaction_items')
  .select('*')
  .eq('transaction_id', id)
  .order('sort_order');
```

**After:**
```ts
const { data: items, error: itemsError } = await supabase
  .from('transaction_items')
  .select('*, menus(category)')
  .eq('transaction_id', id)
  .order('sort_order');
```

Response shape sekarang setiap item punya `menus: { category: 'makanan' | 'nasi' | 'minuman' } | null`. Catat ini untuk consumer (TransactionDetail component).

- [ ] **Step 2: Verifikasi GET response via manual curl/browser**

```bash
npm run dev
# Di browser console (logged in):
fetch('/api/transactions/<existing-tx-id>').then(r=>r.json()).then(d=>console.log(d.items[0]))
```
Expected: object item punya field `menus: { category: ... }`.

- [ ] **Step 3: Locate transaction detail render component**

Detail page biasanya delegasi ke component `components/transaction-detail.tsx` (lihat existing struktur). Confirm via:
```bash
grep -rn "ReprintCard\|TransactionDetail" app/\(app\)/transactions/\[id\]/ components/transaction-detail.tsx
```

- [ ] **Step 4: Embed ReprintCard di detail render**

Di file detail (component atau page langsung — sesuai existing pattern), tambah import:
```tsx
import { ReprintCard } from '@/components/reprint-card';
```

Di JSX, setelah section info utama (sebelum/setelah image), insert kondisional:
```tsx
{transaction.status === 'confirmed' && (
  <ReprintCard
    transaction={{
      id: transaction.id,
      daily_seq: transaction.daily_seq ?? null,
      created_at: transaction.created_at,
      customer_name: transaction.customer_name,
      table_no: transaction.table_no,
    }}
    items={items.map((it: any) => ({
      id: it.id,
      menu_name_snapshot: it.menu_name_snapshot,
      menu_category: it.menus?.category ?? 'makanan', // fallback defensive: kategori unknown → dapur
      qty: it.qty,
      notes: it.notes,
    }))}
  />
)}
```

Note: kalau project pakai strict typing untuk items, define proper type yang include `menus: { category: string } | null` di response — sesuaikan dengan pattern existing typings di project.

- [ ] **Step 5: Manual smoke test**

Buka `/transactions/<id>` untuk transaksi confirmed. Expected: card "Cetak ulang" muncul dengan 3 tombol. Untuk tx yang cuma minuman, tombol "Cetak Dapur" disabled. Untuk pending_review tx, card tidak muncul.

- [ ] **Step 6: Commit**

```bash
git add app/api/transactions/\[id\]/route.ts app/\(app\)/transactions/\[id\]/page.tsx components/transaction-detail.tsx
git commit -m "feat(detail): embed ReprintCard, fetch menu category via join"
```

---

## Task 15: Create `app/(app)/setup/printer/page.tsx` — tutorial page

**Files:**
- Create: `app/(app)/setup/printer/page.tsx`

- [ ] **Step 1: Implement tutorial page**

Buat `app/(app)/setup/printer/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { TestPrintDialog } from '@/components/test-print-dialog';

export default function SetupPrinterPage() {
  const [activeTest, setActiveTest] = useState<'dapur' | 'minuman' | null>(null);

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-semibold">Setup Printer</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">1. Install aplikasi RawBT</h2>
        <p className="text-sm text-muted-foreground">
          RawBT adalah aplikasi gratis untuk Android yang menyambungkan web app ini ke printer thermal LAN.
        </p>
        <a
          href="https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter"
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Buka Play Store
        </a>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">2. Buat profile "Dapur"</h2>
        <ol className="list-decimal space-y-1 pl-6 text-sm">
          <li>Buka RawBT</li>
          <li>Tap menu → <strong>Settings</strong> → <strong>Printers</strong></li>
          <li>Tap <strong>+</strong> (tambah)</li>
          <li>Type: <strong>Network</strong></li>
          <li>Name: <strong>Dapur</strong> (penting: harus persis &quot;Dapur&quot;)</li>
          <li>IP: alamat printer dapur (misal 192.168.1.50)</li>
          <li>Port: <strong>9100</strong></li>
          <li>Save</li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">3. Buat profile "Minuman"</h2>
        <p className="text-sm">Ulangi langkah 2, ganti name jadi <strong>Minuman</strong> dan IP printer minuman.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">4. Tes printer</h2>
        {activeTest === null && (
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTest('dapur')}
              className="flex-1 rounded-md border px-4 py-2"
            >
              Tes Printer Dapur
            </button>
            <button
              onClick={() => setActiveTest('minuman')}
              className="flex-1 rounded-md border px-4 py-2"
            >
              Tes Printer Minuman
            </button>
          </div>
        )}
        {activeTest && (
          <TestPrintDialog
            target={activeTest}
            onClose={() => setActiveTest(null)}
          />
        )}
      </section>

      <section className="space-y-3 pt-4 border-t">
        <h2 className="text-lg font-medium">Bermasalah?</h2>
        <p className="text-sm text-muted-foreground">
          Cek halaman diagnostic untuk lihat history print event.
        </p>
        <a href="/setup/printer/debug" className="text-sm underline">
          Buka halaman diagnostic
        </a>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Manual smoke test**

Buka `/setup/printer` di dev server. Verifikasi: semua section muncul, tombol "Tes Printer Dapur" buka TestPrintDialog inline.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/setup/printer/page.tsx
git commit -m "feat(ui): add setup printer tutorial page"
```

---

## Task 16: Create `app/(app)/setup/printer/debug/page.tsx` — diagnostic page

**Files:**
- Create: `app/(app)/setup/printer/debug/page.tsx`

- [ ] **Step 1: Implement diagnostic page**

Buat `app/(app)/setup/printer/debug/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { getPrinterStatus, type PrinterStatusMap } from '@/lib/printer-status';

type PrintEvent = {
  id: string;
  tx_id: string;
  daily_seq: number | null;
  target: 'dapur' | 'minuman';
  trigger: 'auto' | 'reprint' | 'test';
  outcome: 'dispatched' | 'reported_success' | 'reported_failed';
  failure_note: string | null;
  url_scheme_variant: string | null;
  created_at: string;
};

export default function PrinterDebugPage() {
  const [status, setStatus] = useState<PrinterStatusMap | null>(null);
  const [events, setEvents] = useState<PrintEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus(getPrinterStatus());
    fetch('/api/print/log/recent?limit=30')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => setEvents(d.events))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-3xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-semibold">Printer Diagnostic</h1>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Status (localStorage)</h2>
        <pre className="rounded-md bg-muted p-3 text-xs overflow-x-auto">
{JSON.stringify(status, null, 2)}
        </pre>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium">Recent print events (server)</h2>
        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {error && <p className="text-sm text-red-600">Error: {error}</p>}
        {!loading && !error && events.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada event.</p>
        )}
        {!loading && events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Time</th>
                  <th className="text-left p-2">Target</th>
                  <th className="text-left p-2">Trigger</th>
                  <th className="text-left p-2">Outcome</th>
                  <th className="text-left p-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b">
                    <td className="p-2">{new Date(e.created_at).toLocaleString('id-ID')}</td>
                    <td className="p-2">{e.target}</td>
                    <td className="p-2">{e.trigger}</td>
                    <td className="p-2">{e.outcome}</td>
                    <td className="p-2">{e.failure_note ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2 pt-4 border-t">
        <h2 className="text-lg font-medium">User Agent</h2>
        <p className="text-xs text-muted-foreground">
          {typeof window !== 'undefined' ? window.navigator.userAgent : '(SSR)'}
        </p>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Manual smoke test**

Buka `/setup/printer/debug` di dev server. Expected: status JSON & tabel events tampil. Kalau ada event dari Task 7 smoke test, tampil di tabel.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/setup/printer/debug/page.tsx
git commit -m "feat(ui): add printer diagnostic page"
```

---

## Task 17: Modify `app/(app)/page.tsx` — embed PrinterStatusBanner

**Files:**
- Modify: `app/(app)/page.tsx`

- [ ] **Step 1: Read current home page**

Run: `cat app/\(app\)/page.tsx`
Identify: top-level render structure.

- [ ] **Step 2: Import & embed banner**

Tambah di top:
```tsx
import { PrinterStatusBanner } from '@/components/printer-status-banner';
```

Di JSX, di paling atas main content (sebelum tile/grid existing):
```tsx
<PrinterStatusBanner />
```

- [ ] **Step 3: Manual smoke test**

Buka `/` di dev server (fresh localStorage). Expected: banner merah muncul "Printer belum di-setup" dengan tombol → `/setup/printer`. Setelah test berhasil via setup page, refresh home, banner hilang.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/page.tsx
git commit -m "feat(home): embed printer status banner"
```

---

## Task 18: Update `docs/logging.md` — dokumen event `print.*`

**Files:**
- Modify: `docs/logging.md`

- [ ] **Step 1: Append section dokumen event print.***

Di akhir `docs/logging.md` (atau di section "Event types" kalau ada), tambah:

```markdown
## Print events

Endpoint `POST /api/print/log` (client-triggered) menerima payload print event dan emit wide-event. Selain itu juga di-persist ke tabel `print_events` untuk diagnostic page.

### Event fields (selain field standar request)

- `tx_id` (uuid) — transaksi terkait. Sentinel `00000000-...-0000` untuk test print.
- `daily_seq` (int \| null) — nomor antrian saat dicetak; null kalau test print.
- `target` (`dapur` \| `minuman`) — printer mana
- `trigger` (`auto` \| `reprint` \| `test`) — sumber print
- `outcome` (`dispatched` \| `reported_success` \| `reported_failed`) — status
  - `dispatched`: intent URL sukses di-fire (gak ada error JS, bukan bukti printer cetak)
  - `reported_success`: user manual lapor "Berhasil" di modal
  - `reported_failed`: user manual lapor "Gagal"
- `failure_note` (string?) — catatan user kalau gagal
- `url_scheme_variant` (string?) — variant URL scheme (mis. `rawbt-intent-v1`), berguna kalau ada migrasi format intent
- `user_agent` (string?) — UA browser HP kasir untuk diagnose compat issues

### Diagnose flow

Dev cek Vercel logs untuk pattern:
- Tidak ada `print.dispatched` → JS error di client; minta owner buka Chrome DevTools console screenshot
- `print.dispatched` tapi `reported_failed` → bridge/printer issue; cek `failure_note`, minta IP profile RawBT screenshot
- `print.dispatched` dan `reported_success` → working ✅
```

- [ ] **Step 2: Commit**

```bash
git add docs/logging.md
git commit -m "docs: document print.* event types & diagnose flow"
```

---

## Task 19: Dev self-test end-to-end (no code change)

**Files:** none — dokumentasikan hasil di commit message atau temporary scratchpad

- [ ] **Step 1: Setup HP Android dev**

1. Install RawBT dari Play Store (atau sideload APK)
2. Konfig profile:
   - Name: `Dapur` | Type: Network | IP: `<PC LAN IP>` | Port: `9100`
   - Name: `Minuman` | Type: Network | IP: `<PC LAN IP>` | Port: `9101`
3. Pastikan HP & PC di WiFi sama

- [ ] **Step 2: Jalankan printer emulator di PC**

Terminal 1: `npm run emulator:dapur`
Terminal 2: `npm run emulator:minuman`

- [ ] **Step 3: Deploy preview ke Vercel**

```bash
npx vercel deploy
```
Catat preview URL.

- [ ] **Step 4: Test full flow di HP Android dev**

1. Buka preview URL di Chrome HP
2. Login
3. Buka `/setup/printer`, tap "Tes Printer Dapur" → "Cetak Tes Sekarang"
4. Expected: terminal "dapur" PC tampil "✓ N bytes" + ASCII preview "TES PRINTER DAPUR"
5. Konfirm "✓ Berhasil"
6. Ulangi untuk minuman
7. Buka `/` → banner status harus hilang
8. Scan nota dummy (atau pakai existing pending tx), klik "Simpan & Cetak"
9. Expected: 2 nota keluar di kedua terminal emulator
10. Buka `/transactions/<id>` → ReprintCard muncul, test "Cetak Dapur" reprint
11. Buka `/setup/printer/debug` → semua event ter-log di tabel

- [ ] **Step 5: Validasi multi-profile routing**

Kalau payload dapur masuk ke emulator dapur saja, dan payload minuman masuk ke emulator minuman saja — **Plan A confirmed working**. Kalau payload tertukar atau cuma 1 yang masuk — investigate (RawBT setting profile name typo, atau URL scheme variant beda).

- [ ] **Step 6: (Optional) Render PNG preview**

Untuk verify layout lebih realistic:
```bash
# Pakai escpos-tools (PHP, install via composer) ATAU receiptline (npm)
# Contoh dengan escpos-tools:
# git clone https://github.com/receipt-print-hq/escpos-tools.git
# php /path/to/escpos-tools/bin2png.php tmp/print-emulator/dapur/print-*.bin
```
Cek PNG hasil visually — header, items, separator, cut.

- [ ] **Step 7: Catat hasil**

Bikin file scratch (jangan commit) atau tambah ke commit message Task 20 nanti — apakah:
- Multi-profile routing works? Y / N
- Layout terlihat benar? Y / N
- Yang perlu di-iterate sebelum kasih ke owner

---

## Task 20: Hand-off ke owner — guide & monitor

**Files:** none — operational task, no code change

- [ ] **Step 1: Compose WhatsApp guide untuk owner**

Susun pesan WA (Bahasa Indonesia simple) berisi:
- Install RawBT dari Play Store (link)
- Setup profile "Dapur" & "Minuman" dengan IP printer iWare asli (instruksi step + tanya owner IP)
- Buka `<prod URL>/setup/printer`, ikuti petunjuk
- Tes printer dapur & minuman → screenshot hasil
- Scan nota beneran, klik "Simpan & Cetak" → observe printer
- Buka `/setup/printer/debug` setelah test → screenshot kirim

- [ ] **Step 2: Monitor Vercel logs paralel**

Selama owner test:
```bash
npx vercel logs --follow
# atau via dashboard
```
Filter berdasarkan route `POST /api/print/log` untuk live event stream.

- [ ] **Step 3: Diagnose berdasarkan event pattern**

Sesuai §9.6 spec:
- No event `print.dispatched` → JS error / browser cache issue → minta refresh hard / DevTools console
- `dispatched` tapi `reported_failed` → bridge/printer issue → minta IP profile screenshot
- `dispatched` + `reported_success` → working ✅

- [ ] **Step 4: Iterate kalau ada masalah**

Common issues + hotfix:
- iWare reject command tertentu → trim ESC/POS subset di `lib/escpos.ts`, redeploy
- URL scheme variant tidak workable → switch ke variant lain (mis. `rawbt:base64` simple form tanpa profile param) di `lib/print-intent.ts`, simpan variant di env

- [ ] **Step 5: Final commit (kalau ada hotfix)**

```bash
git add <changed files>
git commit -m "fix(print): <specific fix based on owner feedback>"
```

---

## Final review checklist

Sebelum mark fitur complete, cek:

- [ ] Semua test passed: `npm run test`
- [ ] Lint clean: `npm run lint`
- [ ] Migration applied di prod Supabase
- [ ] Owner confirmed visual print hasil di kertas thermal asli benar (header, daily_seq, items, note, cut)
- [ ] Reprint flow works dari detail page
- [ ] Banner status responsive di home (state changes setelah test)
- [ ] Diagnostic page accessible & data populated
- [ ] `docs/tasks.md` section 🖨️ Print — mark "Print struk digital" sebagai dipisah jadi fitur lain (atau update label), karena fitur ini bukan struk untuk pelanggan — ini kitchen ticket
- [ ] Update `docs/tasks.md` add new completed item "Print nota dapur & minuman via RawBT bridge"
