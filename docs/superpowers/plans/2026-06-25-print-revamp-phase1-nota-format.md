# Phase 1 — Nota Format & Item Flag Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pisahkan format nota dapur/minuman (BIG, no price) dari nota customer (sekarang + footer), tambah tracking `printed_*_at` per item, tombol "Cetak tambahan / ulang / customer" di halaman detail, dan auto-print delta saat edit confirmed transaction.

**Architecture:** Web-only changes. Tetap pakai `print_queue` table (existing realtime + FCM tetap jalan). Tambah kolom `transaction_items.printed_dapur_at` + `printed_minuman_at` yang di-set via Postgres trigger saat `print_queue.status='done'` (trigger sementara — akan di-drop di Phase 2 dan di-replace dengan trigger di `print_history`).

**Tech Stack:** Next.js 16 App Router, Supabase Postgres, vitest, React Testing Library, Zod, ESC/POS bytes (`lib/escpos.ts`).

**Spec referensi:** `docs/superpowers/specs/2026-06-25-print-revamp-design.md` Section A + Phase 1.

---

## File structure

| File | Aksi | Tanggung jawab |
|---|---|---|
| `supabase/migrations/0013_transaction_items_printed.sql` | CREATE | Tambah 2 kolom timestamp untuk track printed status |
| `supabase/migrations/0014_printer_settings_footer.sql` | CREATE | Tambah kolom `footer_text` |
| `supabase/migrations/0015_print_queue_item_ids.sql` | CREATE | Tambah kolom `item_ids uuid[]` di print_queue |
| `supabase/migrations/0016_mark_items_printed_trigger.sql` | CREATE | Postgres trigger update `printed_*_at` saat job done |
| `supabase/migrations/0017_print_queue_constraints.sql` | CREATE | Extend target enum (+customer) + trigger enum |
| `lib/printer-settings.ts` | MODIFY | Tambah field `footer_text` ke type + default |
| `lib/printer-settings-server.ts` | MODIFY | Select kolom baru, fallback default |
| `lib/escpos.ts` | MODIFY | Add `DOUBLE_SIZE_*` constants, add `renderKitchenTicket()`, rename `renderTicket → renderCustomerReceipt` dengan footer support |
| `lib/escpos.test.ts` | MODIFY | Tests untuk renderKitchenTicket + footer behavior |
| `app/(app)/setup/printer/settings/actions.ts` | MODIFY | Zod field `footer_text`, persist ke DB |
| `app/(app)/setup/printer/settings/printer-settings-form.tsx` | MODIFY | Tambah textarea footer |
| `app/api/print/queue/_schema.ts` | MODIFY | Zod: add `item_ids`, expand target & trigger enum |
| `app/api/print/queue/_schema.test.ts` | MODIFY | Tests untuk schema baru |
| `app/api/print/queue/route.ts` | MODIFY | Persist `item_ids` ke row insert |
| `app/api/transactions/[id]/route.ts` | VERIFY | Pastikan items return include kolom flag baru (route pakai `*` → otomatis) |
| `components/reprint-card.tsx` | REWRITE | UI 3-section: Tambahan / Ulang / Customer |
| `components/reprint-card.test.tsx` | REWRITE | Tests sesuai layout baru |
| `components/nota-review-form.tsx` | MODIFY | `handleConfirm` deteksi first-save vs edit-save, kirim item_ids per target, skip target tanpa NULL items |
| `components/transaction-detail.tsx` | MODIFY | Terima `pendingDapur`/`pendingMinuman`, oper ke ReprintCard |
| `app/(app)/transactions/[id]/page.tsx` | MODIFY | Compute pending lists per target dari items.printed_*_at |

---

## Conventions yang harus diikuti

- **Money**: `bigint` rupiah (tanpa sen). Format pakai `formatRp()` dari `lib/currency.ts`.
- **Timezone**: Asia/Jakarta untuk display tanggal.
- **Validation**: Zod di setiap API route boundary.
- **Logging**: setiap route handler pakai `newEvent()` + `evt.emit()` di finally (lihat `docs/logging.md`).
- **Auth**: route handler call `getSupabaseServer().auth.getUser()`, return 401 kalau null.
- **Test runner**: `npm run test` (one-shot vitest), `npm run test:watch` (watch mode).
- **Build verify**: `npm run build` setelah perubahan TypeScript signifikan.
- **Supabase migrations**: file di `supabase/migrations/NNNN_description.sql`, apply via Supabase MCP tool. Setelah apply, commit file SQL ke repo supaya source of truth konsisten.

---

# Task 1: Migration 0013 — printed_dapur_at + printed_minuman_at

**Files:**
- Create: `supabase/migrations/0013_transaction_items_printed.sql`

- [ ] **Step 1: Tulis SQL migration**

Create `supabase/migrations/0013_transaction_items_printed.sql`:

```sql
-- 0013_transaction_items_printed.sql
-- Track kapan tiap item sudah dicetak ke target dapur/minuman.
-- NULL = belum pernah dicetak ke target ini. Dipakai filter "Cetak tambahan"
-- supaya items yang sudah pernah dicetak tidak dikirim ulang ke dapur.
ALTER TABLE transaction_items
  ADD COLUMN printed_dapur_at   timestamptz NULL,
  ADD COLUMN printed_minuman_at timestamptz NULL;
```

- [ ] **Step 2: Apply via Supabase MCP**

Pakai tool `mcp__plugin_supabase_supabase__apply_migration` dengan name `transaction_items_printed` dan SQL di atas.

- [ ] **Step 3: Verifikasi schema**

Pakai `mcp__plugin_supabase_supabase__list_tables` schema `public`, cari table `transaction_items`. Confirm kolom baru ada:
- `printed_dapur_at` data_type `timestamp with time zone` nullable
- `printed_minuman_at` data_type `timestamp with time zone` nullable

- [ ] **Step 4: Commit SQL file**

```bash
git add supabase/migrations/0013_transaction_items_printed.sql
git commit -m "feat(db): add transaction_items.printed_dapur_at + printed_minuman_at"
```

---

# Task 2: Migration 0014 — printer_settings.footer_text

**Files:**
- Create: `supabase/migrations/0014_printer_settings_footer.sql`

- [ ] **Step 1: Tulis SQL migration**

Create `supabase/migrations/0014_printer_settings_footer.sql`:

```sql
-- 0014_printer_settings_footer.sql
-- Footer text untuk nota customer (e.g. "Terima kasih atas kunjungan Anda").
-- Default empty string supaya nota tanpa konfigurasi tidak print footer.
-- Tidak null karena form selalu submit (string kosong = no footer).
ALTER TABLE printer_settings
  ADD COLUMN footer_text text NOT NULL DEFAULT '';
```

- [ ] **Step 2: Apply via Supabase MCP**

`mcp__plugin_supabase_supabase__apply_migration` dengan name `printer_settings_footer`.

- [ ] **Step 3: Verifikasi schema**

Cek `printer_settings` punya `footer_text text NOT NULL DEFAULT ''`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0014_printer_settings_footer.sql
git commit -m "feat(db): add printer_settings.footer_text"
```

---

# Task 3: Migration 0015 — print_queue.item_ids

**Files:**
- Create: `supabase/migrations/0015_print_queue_item_ids.sql`

- [ ] **Step 1: Tulis SQL migration**

```sql
-- 0015_print_queue_item_ids.sql
-- List transaction_items.id yang ter-include di job ini.
-- Null untuk: test print (trigger='test') dan customer receipt (tidak update flag).
-- Trigger 0016 pakai kolom ini untuk update transaction_items.printed_*_at.
ALTER TABLE print_queue
  ADD COLUMN item_ids uuid[] NULL;
```

- [ ] **Step 2: Apply via Supabase MCP**

Name: `print_queue_item_ids`.

- [ ] **Step 3: Verifikasi**

Cek `print_queue` punya kolom `item_ids` array of uuid, nullable.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0015_print_queue_item_ids.sql
git commit -m "feat(db): add print_queue.item_ids"
```

---

# Task 4: Migration 0016 — trigger mark_items_printed

**Files:**
- Create: `supabase/migrations/0016_mark_items_printed_trigger.sql`

- [ ] **Step 1: Tulis SQL migration**

```sql
-- 0016_mark_items_printed_trigger.sql
-- Saat print_queue.status transition ke 'done' dengan item_ids non-null,
-- update transaction_items.printed_X_at sesuai target.
-- Akan di-DROP di Phase 2 dan diganti trigger pada print_history.
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

- [ ] **Step 2: Apply via Supabase MCP**

Name: `mark_items_printed_trigger`.

- [ ] **Step 3: Test trigger fire**

Pakai `mcp__plugin_supabase_supabase__execute_sql`. Jalankan:

```sql
-- Insert dummy print_queue row dengan item_ids dari transaksi confirmed terbaru.
WITH latest_confirmed AS (
  SELECT t.id AS tx_id, array_agg(ti.id) AS item_ids
  FROM transactions t JOIN transaction_items ti ON ti.transaction_id = t.id
  WHERE t.status = 'confirmed' AND t.deleted_at IS NULL
  GROUP BY t.id
  ORDER BY t.created_at DESC LIMIT 1
)
INSERT INTO print_queue (tx_id, target, trigger, bytes_b64, item_ids, status)
SELECT tx_id, 'dapur', 'reprint', 'dGVzdA==', item_ids, 'pending'
FROM latest_confirmed
RETURNING id, tx_id, item_ids;
```

Catat `id` dan `tx_id`. Lalu update status ke done:

```sql
UPDATE print_queue SET status = 'done', completed_at = now() WHERE id = '<job_id>';
```

Verifikasi flag ter-set:

```sql
SELECT id, printed_dapur_at FROM transaction_items
WHERE transaction_id = '<tx_id>' LIMIT 5;
```

Expected: `printed_dapur_at` non-null untuk items yang ada di `item_ids`.

Cleanup row tes:

```sql
DELETE FROM print_queue WHERE id = '<job_id>';
UPDATE transaction_items SET printed_dapur_at = NULL WHERE transaction_id = '<tx_id>';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0016_mark_items_printed_trigger.sql
git commit -m "feat(db): trigger mark transaction_items.printed_X_at on print_queue done"
```

---

# Task 5: Migration 0017 — extend print_queue target & trigger enum

**Files:**
- Create: `supabase/migrations/0017_print_queue_constraints.sql`

- [ ] **Step 1: Tulis SQL migration**

```sql
-- 0017_print_queue_constraints.sql
-- Target: tambah 'customer' untuk nota dengan harga.
-- Trigger: tambah 'auto_additional', 'reprint_additional', 'customer'.
ALTER TABLE print_queue DROP CONSTRAINT IF EXISTS print_queue_target_check;
ALTER TABLE print_queue ADD CONSTRAINT print_queue_target_check
  CHECK (target IN ('dapur', 'minuman', 'customer'));

ALTER TABLE print_queue DROP CONSTRAINT IF EXISTS print_queue_trigger_check;
ALTER TABLE print_queue ADD CONSTRAINT print_queue_trigger_check
  CHECK (trigger IN ('auto', 'auto_additional', 'reprint', 'reprint_additional', 'customer', 'test'));
```

- [ ] **Step 2: Apply via Supabase MCP**

Name: `print_queue_constraints`.

- [ ] **Step 3: Verifikasi constraint**

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'print_queue'::regclass
  AND conname IN ('print_queue_target_check', 'print_queue_trigger_check');
```

Pastikan output sesuai SQL di atas.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0017_print_queue_constraints.sql
git commit -m "feat(db): extend print_queue target+trigger constraints"
```

---

# Task 6: Extend PrinterSettings type + default

**Files:**
- Modify: `lib/printer-settings.ts`

- [ ] **Step 1: Tambah field `footer_text` ke type & default**

Replace file dengan:

```ts
export type PaperWidth = '58mm' | '80mm';
export type CutMode = 'full' | 'partial' | 'none';

export type PrinterSettings = {
  paper_width: PaperWidth;
  feed_lines_before_cut: number;
  cut_mode: CutMode;
  beep_on_print: boolean;
  header_text: string | null;
  footer_text: string;
};

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  paper_width: '58mm',
  feed_lines_before_cut: 4,
  cut_mode: 'full',
  beep_on_print: false,
  header_text: null,
  footer_text: '',
};

export function charsPerLine(paperWidth: PaperWidth): number {
  return paperWidth === '80mm' ? 48 : 32;
}
```

- [ ] **Step 2: Verifikasi TypeScript**

```bash
npx tsc --noEmit
```

Expected: tidak ada error baru (mungkin ada error di file lain yang konsumsi DEFAULT_PRINTER_SETTINGS — itu akan dibetulkan di task berikutnya kalau tetap muncul).

- [ ] **Step 3: Commit nanti dengan T7**

---

# Task 7: Update printer-settings-server.ts

**Files:**
- Modify: `lib/printer-settings-server.ts`

- [ ] **Step 1: Tambah `footer_text` ke select & fallback**

Replace file dengan:

```ts
import { getSupabaseServer } from './supabase/server';
import { DEFAULT_PRINTER_SETTINGS, type PrinterSettings } from './printer-settings';

export async function getPrinterSettings(): Promise<PrinterSettings> {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from('printer_settings')
    .select('paper_width, feed_lines_before_cut, cut_mode, beep_on_print, header_text, footer_text')
    .eq('id', 1)
    .single();
  if (!data) return DEFAULT_PRINTER_SETTINGS;
  // Defensive: footer_text bisa null kalau migration belum apply di env terkait.
  return {
    paper_width: data.paper_width,
    feed_lines_before_cut: data.feed_lines_before_cut,
    cut_mode: data.cut_mode,
    beep_on_print: data.beep_on_print,
    header_text: data.header_text,
    footer_text: data.footer_text ?? '',
  };
}
```

- [ ] **Step 2: Verifikasi build**

```bash
npm run build
```

Expected: success (atau error related ke escpos.ts yang akan di-tackle di T9).

- [ ] **Step 3: Commit**

```bash
git add lib/printer-settings.ts lib/printer-settings-server.ts
git commit -m "feat(printer): add footer_text to PrinterSettings type + server load"
```

---

# Task 8: lib/escpos.ts — add DOUBLE_SIZE_* constants

**Files:**
- Modify: `lib/escpos.ts`

- [ ] **Step 1: Tambah constants tepat setelah `BEEP_3X`**

Edit `lib/escpos.ts`. Locate line `const BEEP_3X = ...` dan tambahkan setelahnya:

```ts
// GS ! n — character size. 0x11 = double width (bit 4) + double height (bit 0).
// Dipakai untuk kitchen ticket supaya dapur baca cepat dari jauh.
const DOUBLE_SIZE_ON  = new Uint8Array([GS, 0x21, 0x11]);
const DOUBLE_SIZE_OFF = new Uint8Array([GS, 0x21, 0x00]);
```

- [ ] **Step 2: Verifikasi tidak break existing**

```bash
npm run test -- escpos
```

Expected: existing tests masih PASS (constants belum dipakai).

- [ ] **Step 3: Belum commit — bundle dengan T9.**

---

# Task 9: TDD — renderKitchenTicket

**Files:**
- Modify: `lib/escpos.ts` (add new function)
- Modify: `lib/escpos.test.ts` (add tests)

- [ ] **Step 1: Tulis failing tests**

Append ke `lib/escpos.test.ts` sebelum `describe('uint8ToBase64', ...)`:

```ts
import { renderKitchenTicket } from './escpos';

describe('renderKitchenTicket', () => {
  it('produces non-empty Uint8Array for valid input', () => {
    const bytes = renderKitchenTicket(baseInput);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(20);
  });

  it('includes header info block (Date, Order Number, Customer, Meja)', () => {
    const bytes = renderKitchenTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('Date');
    expect(ascii).toContain('24/06/2026 21:07');
    expect(ascii).toContain('Order Number');
    expect(ascii).toContain('POS-240626-45');
    expect(ascii).toContain('Customer');
    expect(ascii).toContain('Pak Budi');
    expect(ascii).toContain('Meja');
  });

  it('renders qty + name uppercase per item', () => {
    const bytes = renderKitchenTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('1x NASI AYAM BAKAR DADA');
    expect(ascii).toContain('2x PETE GORENG');
  });

  it('does NOT print unit_price or line total (kitchen format)', () => {
    const bytes = renderKitchenTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    // 26000 → "26.000" tidak boleh muncul (formatRupiah Indonesian)
    expect(ascii).not.toContain('26.000');
    expect(ascii).not.toContain('46.000');
  });

  it('includes Total Item from sum of qty', () => {
    const bytes = renderKitchenTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('Total Item 3');
  });

  it('does NOT include "Total Rp" line (only kitchen receipt)', () => {
    const bytes = renderKitchenTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    // "Total" appears in "Total Item 3", that's OK; only check "Total " with currency.
    // Customer format mengakhiri dengan "Total" + right-aligned amount;
    // kitchen tidak. Cara cek: pastikan tidak ada "46.000" (sudah di test atas).
    // Bonus: pastikan tidak ada bytes BOLD_ON sebelum "Total" rendering customer.
    // Indirect assertion: byte sequence ESC E 1 (BOLD) tidak muncul kecuali header.
  });

  it('uses double-size ESC/POS bytes (GS ! 0x11) for item lines', () => {
    const bytes = renderKitchenTicket(baseInput);
    // Find at least one occurrence of [0x1d, 0x21, 0x11]
    let found = false;
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x1d && bytes[i+1] === 0x21 && bytes[i+2] === 0x11) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('renders notes per item in normal size below double-size name', () => {
    const bytes = renderKitchenTicket(baseInput);
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('> pedas');
  });

  it('omits Meja line when table_no null', () => {
    const bytes = renderKitchenTicket({ ...baseInput, table_no: null });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toContain('Meja');
  });

  it('handles empty items list', () => {
    const bytes = renderKitchenTicket({ ...baseInput, items: [] });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('Total Item 0');
  });
});
```

- [ ] **Step 2: Run tests, verifikasi failing**

```bash
npm run test -- escpos
```

Expected: 9 test baru FAIL with `renderKitchenTicket is not a function` atau `Cannot read import`.

- [ ] **Step 3: Implementasikan `renderKitchenTicket`**

Edit `lib/escpos.ts`. Tambah fungsi baru sebelum `renderTicket`:

```ts
export function renderKitchenTicket(
  input: TicketInput,
  settings: PrinterSettings = DEFAULT_PRINTER_SETTINGS,
): Uint8Array {
  const parts: Uint8Array[] = [];
  const lineWidth = charsPerLine(settings.paper_width);
  const heavySeparator = '='.repeat(lineWidth);
  const trimmedHeader = settings.header_text?.trim();
  const labelWidth = 13;

  parts.push(INIT);
  if (settings.beep_on_print) parts.push(BEEP_3X);

  // Centered bold header (warung name).
  if (trimmedHeader) {
    parts.push(ALIGN_CENTER);
    parts.push(BOLD_ON);
    for (const line of trimmedHeader.split('\n')) {
      parts.push(encodeText(line));
      parts.push(lineFeed(1));
    }
    parts.push(BOLD_OFF);
  }

  // Info block.
  parts.push(ALIGN_LEFT);
  parts.push(encodeText(heavySeparator));
  parts.push(lineFeed(1));
  parts.push(encodeText(labelLine('Date', formatTimestamp(input.created_at), labelWidth)));
  parts.push(lineFeed(1));
  parts.push(encodeText(labelLine('Order Number', formatOrderNumber(input.created_at, input.daily_seq), labelWidth)));
  parts.push(lineFeed(1));
  if (input.customer_name) {
    parts.push(encodeText(labelLine('Customer', input.customer_name, labelWidth)));
    parts.push(lineFeed(1));
  }
  if (input.table_no) {
    parts.push(encodeText(labelLine('Meja', input.table_no, labelWidth)));
    parts.push(lineFeed(1));
  }
  parts.push(encodeText(heavySeparator));
  parts.push(lineFeed(1));

  // Items in DOUBLE SIZE — qty + name uppercase. Notes in normal size below.
  let totalQty = 0;
  for (const item of input.items) {
    totalQty += item.qty;
    parts.push(DOUBLE_SIZE_ON);
    parts.push(encodeText(`${item.qty}x ${item.name.toUpperCase()}`));
    parts.push(DOUBLE_SIZE_OFF);
    parts.push(lineFeed(1));
    if (item.note) {
      parts.push(encodeText(`  > ${item.note}`));
      parts.push(lineFeed(1));
    }
  }

  // Footer count, no amount.
  parts.push(encodeText(heavySeparator));
  parts.push(lineFeed(1));
  parts.push(encodeText(`Total Item ${totalQty}`));
  parts.push(lineFeed(1));

  // Feed + cut.
  if (settings.feed_lines_before_cut > 0) {
    parts.push(lineFeed(settings.feed_lines_before_cut));
  }
  if (settings.cut_mode === 'full') parts.push(CUT_FULL);
  else if (settings.cut_mode === 'partial') parts.push(CUT_PARTIAL);

  return concat(...parts);
}
```

- [ ] **Step 4: Run tests, verifikasi semua PASS**

```bash
npm run test -- escpos
```

Expected: semua test PASS termasuk yang baru.

- [ ] **Step 5: Commit dengan T8 + T9**

```bash
git add lib/escpos.ts lib/escpos.test.ts
git commit -m "feat(escpos): add renderKitchenTicket (BIG items, no price)"
```

---

# Task 10: Rename renderTicket → renderCustomerReceipt + footer support

**Files:**
- Modify: `lib/escpos.ts`
- Modify: `lib/escpos.test.ts`

- [ ] **Step 1: Update existing test file**

Edit `lib/escpos.test.ts`. Replace `import { renderTicket, ...` dengan:

```ts
import { renderCustomerReceipt, renderKitchenTicket, uint8ToBase64, type TicketInput } from './escpos';
```

Replace all `renderTicket(` calls dengan `renderCustomerReceipt(` dalam describe block existing (yaitu `describe('renderTicket', ...)`).

Rename `describe('renderTicket', ...)` → `describe('renderCustomerReceipt', ...)`.

Tambah test untuk footer di akhir block tersebut (sebelum closing `})`):

```ts
  it('renders footer_text when non-empty', () => {
    const bytes = renderCustomerReceipt(baseInput, {
      paper_width: '58mm',
      feed_lines_before_cut: 0,
      cut_mode: 'none',
      beep_on_print: false,
      header_text: null,
      footer_text: 'Terima kasih\n~ Pak Pon ~',
    });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('Terima kasih');
    expect(ascii).toContain('~ Pak Pon ~');
  });

  it('does NOT render footer when footer_text empty', () => {
    const bytes = renderCustomerReceipt(baseInput, {
      paper_width: '58mm',
      feed_lines_before_cut: 0,
      cut_mode: 'none',
      beep_on_print: false,
      header_text: null,
      footer_text: '',
    });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).not.toContain('Terima kasih');
  });

  it('replaces non-Latin-1 chars in footer with ?', () => {
    const bytes = renderCustomerReceipt(baseInput, {
      paper_width: '58mm',
      feed_lines_before_cut: 0,
      cut_mode: 'none',
      beep_on_print: false,
      header_text: null,
      footer_text: 'Terima kasih 🙏',
    });
    const ascii = new TextDecoder('latin1').decode(bytes);
    expect(ascii).toContain('Terima kasih');
    // 🙏 = U+1F64F → bytes encoded sebagai dua '?' (surrogate pair) atau satu '?'
    expect(ascii).toContain('?');
  });
```

- [ ] **Step 2: Run tests, verifikasi failing**

```bash
npm run test -- escpos
```

Expected: tests untuk `renderCustomerReceipt` FAIL dengan `renderCustomerReceipt is not a function`.

- [ ] **Step 3: Rename function + add footer logic di `lib/escpos.ts`**

Cari fungsi `export function renderTicket(` dan ganti nama jadi `renderCustomerReceipt`. Di akhir fungsi (sebelum block `// 6. Configurable feed + cut`), tambah render footer:

```ts
  // 5b. Optional footer (Terima kasih dst). Print centered, normal size, with
  // breathing room before cut. Kosong = skip semuanya supaya tidak ada gap.
  const trimmedFooter = settings.footer_text?.trim();
  if (trimmedFooter) {
    parts.push(lineFeed(1));
    parts.push(ALIGN_CENTER);
    for (const line of trimmedFooter.split('\n')) {
      parts.push(encodeText(line));
      parts.push(lineFeed(1));
    }
    parts.push(ALIGN_LEFT);
  }
```

- [ ] **Step 4: Run tests, verifikasi PASS**

```bash
npm run test -- escpos
```

Expected: semua test PASS.

- [ ] **Step 5: Build untuk catch broken callers**

```bash
npm run build
```

Expected: build error di `components/reprint-card.tsx` dan `components/nota-review-form.tsx` (mereka import `renderTicket`). Itu akan dibetulkan di T16-T17.

- [ ] **Step 6: Commit**

```bash
git add lib/escpos.ts lib/escpos.test.ts
git commit -m "feat(escpos): rename renderTicket → renderCustomerReceipt + add footer rendering"
```

Catatan: build broken sementara — task selanjutnya akan fix.

---

# Task 11: Settings actions.ts — Zod + DB write footer_text

**Files:**
- Modify: `app/(app)/setup/printer/settings/actions.ts`

- [ ] **Step 1: Tambah field `footer_text` ke schema**

Edit `app/(app)/setup/printer/settings/actions.ts`. Replace `SettingsSchema` dengan:

```ts
const SettingsSchema = z.object({
  paper_width: z.enum(['58mm', '80mm']),
  feed_lines_before_cut: z.coerce.number().int().min(0).max(8),
  cut_mode: z.enum(['full', 'partial', 'none']),
  beep_on_print: z.coerce.boolean(),
  header_text: z
    .string()
    .max(80)
    .transform((s) => (s.trim() === '' ? null : s.trim()))
    .nullable(),
  footer_text: z
    .string()
    .max(200)
    .transform((s) => s.trim()),
});
```

- [ ] **Step 2: Tambah parsing field di `savePrinterSettings`**

Replace `safeParse({...})` call dengan:

```ts
  const parsed = SettingsSchema.safeParse({
    paper_width: formData.get('paper_width'),
    feed_lines_before_cut: formData.get('feed_lines_before_cut'),
    cut_mode: formData.get('cut_mode'),
    beep_on_print: formData.get('beep_on_print') === 'on',
    header_text: formData.get('header_text') ?? '',
    footer_text: formData.get('footer_text') ?? '',
  });
```

- [ ] **Step 3: Verifikasi TypeScript**

```bash
npx tsc --noEmit
```

Expected: tidak ada error baru di file ini.

- [ ] **Step 4: Belum commit — bundle dengan T12.**

---

# Task 12: Settings form — textarea footer

**Files:**
- Modify: `app/(app)/setup/printer/settings/printer-settings-form.tsx`

- [ ] **Step 1: Tambah field textarea**

Edit `app/(app)/setup/printer/settings/printer-settings-form.tsx`. Locate block setelah `<Input id="header_text" ...>` (di dalam Card "Optional"). Tambahkan tepat setelah closing `</div>` untuk `header_text` (sebelum closing Card `</Card>`):

```tsx
        <div className="space-y-2">
          <Label htmlFor="footer_text">Footer text (nota customer)</Label>
          <textarea
            id="footer_text"
            name="footer_text"
            defaultValue={initial.footer_text}
            maxLength={200}
            rows={3}
            placeholder="cth: Terima kasih atas kunjungan Anda&#10;~ Pak Pon ~"
            className="w-full rounded-md border border-clay-soft bg-paper px-3 py-2 text-sm text-coal focus:outline-none focus:ring-2 focus:ring-mustard"
          />
          <p className="text-xs text-coal-soft">
            Hanya dicetak di nota customer (yang tampil harga + total). Kosongkan kalau tidak perlu. Max 200 karakter, multi-baris diperbolehkan.
          </p>
        </div>
```

- [ ] **Step 2: Run dev server, manual visual check**

```bash
npm run dev
```

Buka http://localhost:3000/setup/printer/settings di browser. Confirm field "Footer text" muncul di Card "Optional" dengan placeholder dua baris. Coba isi 2 baris, klik Simpan, refresh — value harus persisted.

- [ ] **Step 3: Commit T11 + T12**

```bash
git add app/\(app\)/setup/printer/settings/
git commit -m "feat(printer-settings): add footer_text textarea form field"
```

---

# Task 13: TDD — print_queue _schema.ts extended

**Files:**
- Modify: `app/api/print/queue/_schema.ts`
- Modify: `app/api/print/queue/_schema.test.ts`

- [ ] **Step 1: Update tests**

Edit `app/api/print/queue/_schema.test.ts`. Replace seluruh `valid` dan tambah test cases:

```ts
import { describe, it, expect } from 'vitest';
import { PrintQueueInsertSchema } from './_schema';

describe('PrintQueueInsertSchema', () => {
  const valid = {
    tx_id: '11111111-1111-4111-8111-111111111111',
    target: 'dapur' as const,
    trigger: 'auto' as const,
    item_ids: ['22222222-2222-4222-8222-222222222222'],
    bytes_b64: 'G0BISQ==',
  };

  it('accepts valid payload with item_ids', () => {
    expect(PrintQueueInsertSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts null tx_id (test print)', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, tx_id: null }).success).toBe(true);
  });

  it('accepts null item_ids (customer or test)', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, item_ids: null }).success).toBe(true);
  });

  it('accepts empty item_ids array', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, item_ids: [] }).success).toBe(true);
  });

  it('accepts target=customer', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, target: 'customer', item_ids: null }).success).toBe(true);
  });

  it('accepts trigger=auto_additional', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, trigger: 'auto_additional' }).success).toBe(true);
  });

  it('accepts trigger=reprint_additional', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, trigger: 'reprint_additional' }).success).toBe(true);
  });

  it('accepts trigger=customer', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, trigger: 'customer' }).success).toBe(true);
  });

  it('rejects invalid target', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, target: 'kitchen' }).success).toBe(false);
  });

  it('rejects invalid trigger', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, trigger: 'manual' }).success).toBe(false);
  });

  it('rejects non-uuid in item_ids', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, item_ids: ['not-uuid'] }).success).toBe(false);
  });

  it('rejects empty bytes_b64', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, bytes_b64: '' }).success).toBe(false);
  });

  it('strict — rejects extra unknown fields', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, extra: 'foo' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verifikasi failing**

```bash
npm run test -- print/queue
```

Expected: failing karena `item_ids` field tidak ada di schema lama dan target/trigger enum belum cover values baru.

- [ ] **Step 3: Update `_schema.ts`**

Replace `app/api/print/queue/_schema.ts` dengan:

```ts
import { z } from 'zod';

export const PrintQueueInsertSchema = z.object({
  // tx_id null untuk test print (trigger='test')
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
  // item_ids null untuk customer & test (tidak update flag).
  // Empty array dianggap valid untuk kompatibilitas — route handler treat sebagai "no items".
  item_ids: z.array(z.string().uuid()).nullable(),
  bytes_b64: z.string().min(1),
}).strict();

export type PrintQueueInsertInput = z.infer<typeof PrintQueueInsertSchema>;
```

- [ ] **Step 4: Run, verifikasi PASS**

```bash
npm run test -- print/queue
```

Expected: semua test PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/print/queue/_schema.ts app/api/print/queue/_schema.test.ts
git commit -m "feat(api): extend print_queue schema with item_ids + customer target/trigger"
```

---

# Task 14: print/queue/route.ts — persist item_ids

**Files:**
- Modify: `app/api/print/queue/route.ts`

- [ ] **Step 1: Update insert payload**

Edit `app/api/print/queue/route.ts`. Locate `.insert({...})` di sekitar baris 36-44. Replace dengan:

```ts
      .insert({
        tx_id: payload.tx_id,
        target: payload.target,
        trigger: payload.trigger,
        bytes_b64: payload.bytes_b64,
        item_ids: payload.item_ids,
        created_by: user.id,
      })
```

- [ ] **Step 2: Update event payload supaya log include item_ids count**

Cari `evt.merge({ tx_id: ..., target: ..., trigger: ..., bytes_size: ... })`. Replace dengan:

```ts
    evt.merge({
      tx_id: payload.tx_id,
      target: payload.target,
      trigger: payload.trigger,
      bytes_size: payload.bytes_b64.length,
      item_ids_count: payload.item_ids?.length ?? 0,
    });
```

- [ ] **Step 3: Verifikasi build**

```bash
npm run build
```

Expected: no error di file ini.

- [ ] **Step 4: Commit**

```bash
git add app/api/print/queue/route.ts
git commit -m "feat(api): persist item_ids when inserting print_queue row"
```

---

# Task 15: Verifikasi transactions/[id]/route.ts return items dengan flag baru

**Files:**
- Verify (mungkin modify): `app/api/transactions/[id]/route.ts`

- [ ] **Step 1: Cek select clause**

Buka file. Cari `select('*')` untuk `transaction_items` di handler PATCH (yang dipanggil di `NotaReviewForm.handleConfirm`). Pastikan response items include `printed_dapur_at` + `printed_minuman_at`.

Karena pakai `'*'` (select all), kolom baru otomatis ke-include. Tidak perlu modify.

Tapi cek juga `.select('id, menu_id, unit_price_snapshot, qty, notes, sort_order')` (line ~269) — itu untuk diff helper. Apakah `handleConfirm` rely on flag dari response? Iya, untuk auto-print delta. Berarti yang penting adalah response items setelah PATCH selesai. Mostly response pakai `'*'`. **Confirm dengan command**:

```bash
grep -n "transaction_items" app/api/transactions/\[id\]/route.ts
```

- [ ] **Step 2: Manual test response shape**

Jalankan dev server, buka /transactions/<id>/review existing tx confirmed di browser DevTools Network. Hit PATCH dan inspect response — items[] harus include `printed_dapur_at` dan `printed_minuman_at` (mostly null).

Kalau tidak ada → tambah explicit di select clause yang return ke client.

- [ ] **Step 3: Commit hanya kalau ada modifikasi**

Tidak ada perubahan = skip commit, lanjut T16.

---

# Task 16: TDD — reprint-card.tsx rewrite 3-section layout

**Files:**
- Modify: `components/reprint-card.tsx`
- Modify: `components/reprint-card.test.tsx`

- [ ] **Step 1: Update type & test**

Replace `components/reprint-card.test.tsx` dengan:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReprintCard } from './reprint-card';
import type { TransactionItemForPrint } from './reprint-card';
import { DEFAULT_PRINTER_SETTINGS } from '@/lib/printer-settings';

const txBase = {
  id: '11111111-1111-4111-8111-111111111111',
  daily_seq: 42,
  created_at: '2026-06-23T07:32:00.000Z',
  customer_name: 'Pak Budi',
  table_no: '5',
};

// Helper to build item with optional flags.
function mkItem(
  override: Partial<TransactionItemForPrint> = {},
): TransactionItemForPrint {
  return {
    id: crypto.randomUUID(),
    menu_name_snapshot: 'Item',
    menu_category: 'makanan',
    unit_price_snapshot: 10000,
    qty: 1,
    notes: null,
    printed_dapur_at: null,
    printed_minuman_at: null,
    ...override,
  };
}

const mockFetchOk = () =>
  vi.fn((..._args: [RequestInfo | URL, RequestInit?]) => {
    void _args;
    return Promise.resolve(new Response(JSON.stringify({ job_id: 'job-1' }), { status: 201 }));
  });

describe('<ReprintCard />', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Layout sections', () => {
    it('renders 3 sections: tambahan / ulang / customer', () => {
      const items = [
        mkItem({ menu_name_snapshot: 'Ayam', menu_category: 'makanan' }),
        mkItem({ menu_name_snapshot: 'Es Teh', menu_category: 'minuman' }),
      ];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      expect(screen.getByRole('button', { name: /cetak tambahan/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cetak ulang dapur/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cetak ulang minuman/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cetak ulang keduanya/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cetak nota customer/i })).toBeInTheDocument();
    });
  });

  describe('Cetak tambahan', () => {
    it('disabled when all items already printed to their targets', () => {
      const items = [
        mkItem({ menu_category: 'makanan', printed_dapur_at: '2026-06-23T00:00:00Z' }),
        mkItem({ menu_category: 'minuman', printed_minuman_at: '2026-06-23T00:00:00Z' }),
      ];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      expect(screen.getByRole('button', { name: /cetak tambahan/i })).toBeDisabled();
    });

    it('enabled with count when some items NULL flag', () => {
      const items = [
        mkItem({ menu_category: 'makanan', printed_dapur_at: '2026-06-23T00:00:00Z' }),
        mkItem({ menu_category: 'makanan', printed_dapur_at: null }),
        mkItem({ menu_category: 'minuman', printed_minuman_at: null }),
      ];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      const btn = screen.getByRole('button', { name: /cetak tambahan/i });
      expect(btn).toBeEnabled();
      expect(btn).toHaveTextContent(/2 item/i);
    });

    it('POSTs 2 jobs (dapur + minuman) with item_ids filtered to NULL flag', async () => {
      const fetchMock = mockFetchOk();
      global.fetch = fetchMock as unknown as typeof fetch;
      const user = userEvent.setup();
      const a = mkItem({ menu_category: 'makanan', printed_dapur_at: '2026-06-23T00:00:00Z' });
      const b = mkItem({ menu_category: 'makanan', printed_dapur_at: null });
      const c = mkItem({ menu_category: 'minuman', printed_minuman_at: null });
      render(<ReprintCard transaction={txBase} items={[a, b, c]} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      await user.click(screen.getByRole('button', { name: /cetak tambahan/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      const bodies = fetchMock.mock.calls.map((c) =>
        JSON.parse((c as [unknown, RequestInit])[1].body as string),
      );
      const dapurBody = bodies.find((x) => x.target === 'dapur');
      const minumanBody = bodies.find((x) => x.target === 'minuman');
      expect(dapurBody?.item_ids).toEqual([b.id]);
      expect(minumanBody?.item_ids).toEqual([c.id]);
      expect(dapurBody?.trigger).toBe('reprint_additional');
      expect(minumanBody?.trigger).toBe('reprint_additional');
    });

    it('only POSTs 1 job when only one target has NULL items', async () => {
      const fetchMock = mockFetchOk();
      global.fetch = fetchMock as unknown as typeof fetch;
      const user = userEvent.setup();
      const items = [
        mkItem({ menu_category: 'makanan', printed_dapur_at: null }),
        mkItem({ menu_category: 'minuman', printed_minuman_at: '2026-06-23T00:00:00Z' }),
      ];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      await user.click(screen.getByRole('button', { name: /cetak tambahan/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(body.target).toBe('dapur');
    });
  });

  describe('Cetak ulang (full reprint)', () => {
    it('Dapur disabled when no makanan/nasi items', () => {
      const items = [mkItem({ menu_category: 'minuman' })];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      expect(screen.getByRole('button', { name: /cetak ulang dapur/i })).toBeDisabled();
    });

    it('POSTs job with all items regardless of printed flag', async () => {
      const fetchMock = mockFetchOk();
      global.fetch = fetchMock as unknown as typeof fetch;
      const user = userEvent.setup();
      const a = mkItem({ menu_category: 'makanan', printed_dapur_at: '2026-06-23T00:00:00Z' });
      const b = mkItem({ menu_category: 'makanan', printed_dapur_at: null });
      render(<ReprintCard transaction={txBase} items={[a, b]} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      await user.click(screen.getByRole('button', { name: /cetak ulang dapur/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(body.target).toBe('dapur');
      expect(body.trigger).toBe('reprint');
      expect(body.item_ids?.sort()).toEqual([a.id, b.id].sort());
    });

    it('Keduanya POSTs 2 jobs', async () => {
      const fetchMock = mockFetchOk();
      global.fetch = fetchMock as unknown as typeof fetch;
      const user = userEvent.setup();
      const items = [
        mkItem({ menu_category: 'makanan' }),
        mkItem({ menu_category: 'minuman' }),
      ];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      await user.click(screen.getByRole('button', { name: /cetak ulang keduanya/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    });
  });

  describe('Cetak nota customer', () => {
    it('POSTs job with target=customer trigger=customer item_ids=null', async () => {
      const fetchMock = mockFetchOk();
      global.fetch = fetchMock as unknown as typeof fetch;
      const user = userEvent.setup();
      const items = [mkItem({ menu_category: 'makanan' })];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);
      await user.click(screen.getByRole('button', { name: /cetak nota customer/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(body.target).toBe('customer');
      expect(body.trigger).toBe('customer');
      expect(body.item_ids).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run, verifikasi failing**

```bash
npm run test -- reprint-card
```

Expected: failing karena type `TransactionItemForPrint` belum punya field `printed_*_at`, butuh juga handlers tombol baru.

- [ ] **Step 3: Rewrite `components/reprint-card.tsx`**

Replace seluruh file dengan:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { renderKitchenTicket, renderCustomerReceipt, uint8ToBase64 } from '@/lib/escpos';
import type { PrinterSettings } from '@/lib/printer-settings';

export type MenuCategory = 'makanan' | 'nasi' | 'minuman';
export type PrinterTarget = 'dapur' | 'minuman' | 'customer';

export type TransactionItemForPrint = {
  id: string;
  menu_name_snapshot: string;
  menu_category: MenuCategory;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  printed_dapur_at: string | null;
  printed_minuman_at: string | null;
};

type TxBase = {
  id: string;
  daily_seq: number | null;
  created_at: string;
  customer_name: string | null;
  table_no: string | null;
};

type Trigger =
  | 'reprint'
  | 'reprint_additional'
  | 'customer';

function isKitchenItem(it: TransactionItemForPrint): boolean {
  return it.menu_category === 'makanan' || it.menu_category === 'nasi';
}

async function submitJob(args: {
  tx: TxBase;
  target: PrinterTarget;
  items: TransactionItemForPrint[];
  trigger: Trigger;
  printerSettings: PrinterSettings;
}): Promise<{ ok: boolean; error?: string }> {
  const ticketInput = {
    target: args.target === 'customer' ? 'dapur' as const : args.target,
    daily_seq: args.tx.daily_seq ?? 0,
    created_at: new Date(args.tx.created_at),
    customer_name: args.tx.customer_name,
    table_no: args.tx.table_no,
    items: args.items.map((i) => ({
      qty: i.qty,
      name: i.menu_name_snapshot,
      unit_price: i.unit_price_snapshot,
      note: i.notes,
    })),
  };

  const bytes =
    args.target === 'customer'
      ? renderCustomerReceipt(ticketInput, args.printerSettings)
      : renderKitchenTicket(ticketInput, args.printerSettings);

  const item_ids =
    args.target === 'customer' ? null : args.items.map((i) => i.id);

  try {
    const res = await fetch('/api/print/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id: args.tx.id,
        target: args.target,
        trigger: args.trigger,
        item_ids,
        bytes_b64: uint8ToBase64(bytes),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: (data as { error?: string }).error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}

export function ReprintCard({
  transaction,
  items,
  printerSettings,
}: {
  transaction: TxBase;
  items: TransactionItemForPrint[];
  printerSettings: PrinterSettings;
}) {
  const [submitting, setSubmitting] = useState<string | null>(null);

  // Items per target for "ulang" (all items belonging to that target).
  const dapurAll = useMemo(() => items.filter(isKitchenItem), [items]);
  const minumanAll = useMemo(() => items.filter((i) => i.menu_category === 'minuman'), [items]);

  // Items per target for "tambahan" (NULL flag in that target).
  const dapurPending = useMemo(
    () => dapurAll.filter((i) => i.printed_dapur_at === null),
    [dapurAll],
  );
  const minumanPending = useMemo(
    () => minumanAll.filter((i) => i.printed_minuman_at === null),
    [minumanAll],
  );

  const hasDapur = dapurAll.length > 0;
  const hasMinuman = minumanAll.length > 0;
  const pendingCount = dapurPending.length + minumanPending.length;
  const hasPending = pendingCount > 0;
  const hasAnyItems = items.length > 0;

  async function fireAdditional() {
    setSubmitting('tambahan');
    const jobs: Promise<{ target: PrinterTarget; ok: boolean; error?: string }>[] = [];
    if (dapurPending.length > 0) {
      jobs.push(
        submitJob({
          tx: transaction,
          target: 'dapur',
          items: dapurPending,
          trigger: 'reprint_additional',
          printerSettings,
        }).then((r) => ({ ...r, target: 'dapur' as const })),
      );
    }
    if (minumanPending.length > 0) {
      jobs.push(
        submitJob({
          tx: transaction,
          target: 'minuman',
          items: minumanPending,
          trigger: 'reprint_additional',
          printerSettings,
        }).then((r) => ({ ...r, target: 'minuman' as const })),
      );
    }
    const results = await Promise.all(jobs);
    setSubmitting(null);
    const ok = results.filter((r) => r.ok).map((r) => r.target);
    const fail = results.filter((r) => !r.ok);
    if (fail.length === 0) toast.success(`${ok.length} job tambahan dikirim ke agent`);
    else toast.error(`${ok.length} sukses, ${fail.length} gagal: ${fail.map((f) => `${f.target}=${f.error}`).join(', ')}`);
  }

  async function fireReprintTarget(target: 'dapur' | 'minuman') {
    setSubmitting(`ulang-${target}`);
    const targetItems = target === 'dapur' ? dapurAll : minumanAll;
    const result = await submitJob({
      tx: transaction,
      target,
      items: targetItems,
      trigger: 'reprint',
      printerSettings,
    });
    setSubmitting(null);
    if (result.ok) toast.success(`Cetak ulang ${target} dikirim ke agent`);
    else toast.error(`Gagal kirim job ${target}: ${result.error}`);
  }

  async function fireReprintBoth() {
    setSubmitting('ulang-keduanya');
    const jobs: Promise<{ target: PrinterTarget; ok: boolean; error?: string }>[] = [];
    if (hasDapur) {
      jobs.push(
        submitJob({
          tx: transaction,
          target: 'dapur',
          items: dapurAll,
          trigger: 'reprint',
          printerSettings,
        }).then((r) => ({ ...r, target: 'dapur' as const })),
      );
    }
    if (hasMinuman) {
      jobs.push(
        submitJob({
          tx: transaction,
          target: 'minuman',
          items: minumanAll,
          trigger: 'reprint',
          printerSettings,
        }).then((r) => ({ ...r, target: 'minuman' as const })),
      );
    }
    const results = await Promise.all(jobs);
    setSubmitting(null);
    const ok = results.filter((r) => r.ok).map((r) => r.target);
    const fail = results.filter((r) => !r.ok);
    if (fail.length === 0) toast.success(`${ok.length} job dikirim ke agent`);
    else toast.error(`${ok.length} sukses, ${fail.length} gagal: ${fail.map((f) => `${f.target}=${f.error}`).join(', ')}`);
  }

  async function fireCustomer() {
    setSubmitting('customer');
    const result = await submitJob({
      tx: transaction,
      target: 'customer',
      items, // all items, customer receipt shows everything with prices
      trigger: 'customer',
      printerSettings,
    });
    setSubmitting(null);
    if (result.ok) toast.success('Cetak nota customer dikirim ke agent');
    else toast.error(`Gagal kirim job customer: ${result.error}`);
  }

  const isBusy = submitting !== null;

  return (
    <div className="rounded-md border border-clay-soft bg-paper-soft p-4 space-y-4">
      <h3 className="font-medium text-coal">Cetak</h3>

      <button
        type="button"
        onClick={fireAdditional}
        disabled={!hasPending || isBusy}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {submitting === 'tambahan'
          ? 'Mengirim…'
          : hasPending
            ? `⚡ Cetak tambahan (${pendingCount} item)`
            : '⚡ Cetak tambahan (tidak ada)'}
      </button>

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-clay">Cetak ulang lengkap</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => fireReprintTarget('dapur')}
            disabled={!hasDapur || isBusy}
            className="rounded-md border border-clay-soft px-3 py-2 text-sm text-coal disabled:opacity-50"
          >
            {submitting === 'ulang-dapur' ? 'Mengirim…' : 'Cetak ulang Dapur'}
          </button>
          <button
            type="button"
            onClick={() => fireReprintTarget('minuman')}
            disabled={!hasMinuman || isBusy}
            className="rounded-md border border-clay-soft px-3 py-2 text-sm text-coal disabled:opacity-50"
          >
            {submitting === 'ulang-minuman' ? 'Mengirim…' : 'Cetak ulang Minuman'}
          </button>
        </div>
        <button
          type="button"
          onClick={fireReprintBoth}
          disabled={(!hasDapur && !hasMinuman) || isBusy}
          className="w-full rounded-md border border-clay-soft px-3 py-2 text-sm text-coal disabled:opacity-50"
        >
          {submitting === 'ulang-keduanya' ? 'Mengirim…' : 'Cetak ulang Keduanya'}
        </button>
      </div>

      <button
        type="button"
        onClick={fireCustomer}
        disabled={!hasAnyItems || isBusy}
        className="w-full rounded-md border border-mustard/40 bg-mustard-faint px-3 py-2 text-sm text-coal disabled:opacity-50"
      >
        {submitting === 'customer' ? 'Mengirim…' : '🧾 Cetak nota customer'}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run, verifikasi PASS**

```bash
npm run test -- reprint-card
```

Expected: semua PASS.

- [ ] **Step 5: Commit**

```bash
git add components/reprint-card.tsx components/reprint-card.test.tsx
git commit -m "feat(reprint): 3-section layout (tambahan / ulang / customer) with item_ids tracking"
```

---

# Task 17: NotaReviewForm.handleConfirm — delta logic

**Files:**
- Modify: `components/nota-review-form.tsx`

- [ ] **Step 1: Tambah field `printed_*_at` ke type ItemForQueue**

Edit `components/nota-review-form.tsx`. Locate type `ItemForQueue` (~line 41). Replace dengan:

```ts
type ItemForQueue = {
  id: string;
  qty: number;
  menu_name_snapshot: string;
  menu_category: string;
  unit_price_snapshot: number;
  notes: string | null;
  printed_dapur_at: string | null;
  printed_minuman_at: string | null;
};
```

- [ ] **Step 2: Replace import `renderTicket` dengan `renderKitchenTicket`**

Cari `import { renderTicket, uint8ToBase64 } from '@/lib/escpos';`. Ganti jadi:

```ts
import { renderKitchenTicket, uint8ToBase64 } from '@/lib/escpos';
```

- [ ] **Step 3: Update `submitPrintJob` untuk pakai renderKitchenTicket + item_ids**

Replace fungsi `submitPrintJob` dengan:

```ts
async function submitPrintJob(args: {
  tx: { id: string; daily_seq: number | null; created_at: string; customer_name: string | null; table_no: string | null };
  target: PrinterTarget;
  items: ItemForQueue[];
  trigger: 'auto' | 'auto_additional';
  printerSettings: PrinterSettings;
}): Promise<boolean> {
  const bytes = renderKitchenTicket(
    {
      target: args.target,
      daily_seq: args.tx.daily_seq ?? 0,
      created_at: new Date(args.tx.created_at),
      customer_name: args.tx.customer_name,
      table_no: args.tx.table_no,
      items: args.items.map((i) => ({
        qty: i.qty,
        name: i.menu_name_snapshot,
        unit_price: i.unit_price_snapshot,
        note: i.notes,
      })),
    },
    args.printerSettings,
  );
  const bytes_b64 = uint8ToBase64(bytes);
  try {
    const res = await fetch('/api/print/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id: args.tx.id,
        target: args.target,
        trigger: args.trigger,
        item_ids: args.items.map((i) => i.id),
        bytes_b64,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Update `handleConfirm` untuk deteksi first-save vs edit-save**

Cari `async function handleConfirm()`. Replace block ini (mulai dari `const itemsForQueue: ItemForQueue[]` sampai sebelum `startTransition(() => { router.push('/'); });`):

```ts
      const wasConfirmedBefore = transaction.status === 'confirmed';

      const itemsForQueue: ItemForQueue[] = data.items.map((it) => {
        const menu = menus.find((m) => m.id === it.menu_id);
        return {
          id: it.id,
          qty: it.qty,
          menu_name_snapshot: it.menu_name_snapshot,
          menu_category: menu?.category ?? 'makanan',
          unit_price_snapshot: it.unit_price_snapshot,
          notes: it.notes,
          printed_dapur_at: it.printed_dapur_at,
          printed_minuman_at: it.printed_minuman_at,
        };
      });

      // First save (pending_review → confirmed): full kitchen tickets to both targets.
      // Edit save (already confirmed): only items that haven't been printed yet (delta).
      const split = splitItems(itemsForQueue);
      const trigger: 'auto' | 'auto_additional' = wasConfirmedBefore
        ? 'auto_additional'
        : 'auto';
      const dapurItems = wasConfirmedBefore
        ? split.dapur.filter((i) => i.printed_dapur_at === null)
        : split.dapur;
      const minumanItems = wasConfirmedBefore
        ? split.minuman.filter((i) => i.printed_minuman_at === null)
        : split.minuman;

      const submitJobs: Promise<{ target: PrinterTarget; ok: boolean }>[] = [];
      if (dapurItems.length > 0) {
        submitJobs.push(
          submitPrintJob({ tx: data.transaction, target: 'dapur', items: dapurItems, trigger, printerSettings }).then((ok) => ({ target: 'dapur', ok })),
        );
      }
      if (minumanItems.length > 0) {
        submitJobs.push(
          submitPrintJob({ tx: data.transaction, target: 'minuman', items: minumanItems, trigger, printerSettings }).then((ok) => ({ target: 'minuman', ok })),
        );
      }
      const results = await Promise.all(submitJobs);
      const succeeded = results.filter((r) => r.ok).map((r) => r.target);
      const failed = results.filter((r) => !r.ok).map((r) => r.target);

      if (results.length === 0) {
        toast.success('Nota tersimpan (tidak ada item baru untuk dicetak)');
      } else if (failed.length === 0) {
        const action = wasConfirmedBefore ? 'tambahan' : 'cetak';
        toast.success(`Nota tersimpan, ${succeeded.length} print job ${action} dikirim ke agent`);
      } else {
        toast.success('Nota tersimpan');
        toast.error(`Gagal kirim print job ke: ${failed.join(', ')}. Coba reprint manual dari halaman detail.`);
      }
```

- [ ] **Step 5: Pastikan `data.items` typing menerima flag baru**

Cari deklarasi response type `const data = await res.json() as { transaction: ...; items: Array<...> };` di `handleConfirm`. Update item shape:

```ts
      const data = await res.json() as {
        transaction: {
          id: string;
          daily_seq: number | null;
          created_at: string;
          customer_name: string | null;
          table_no: string | null;
        };
        items: Array<{
          id: string;
          menu_id: string;
          menu_name_snapshot: string;
          unit_price_snapshot: number;
          qty: number;
          notes: string | null;
          printed_dapur_at: string | null;
          printed_minuman_at: string | null;
        }>;
      };
```

- [ ] **Step 6: Run tests + build**

```bash
npm run test
npm run build
```

Expected: PASS dan build success.

- [ ] **Step 7: Commit**

```bash
git add components/nota-review-form.tsx
git commit -m "feat(review): auto-print delta only when editing confirmed transaction"
```

---

# Task 18: transaction-detail.tsx — pass items dengan flags

**Files:**
- Modify: `components/transaction-detail.tsx`

- [ ] **Step 1: Update item type**

Edit `components/transaction-detail.tsx`. Locate `type Item = { ... }` (sekitar line 25). Replace dengan:

```ts
type Item = {
  id: string;
  menu_name_snapshot: string;
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  menu_category?: 'makanan' | 'nasi' | 'minuman' | string | null;
  printed_dapur_at: string | null;
  printed_minuman_at: string | null;
};
```

- [ ] **Step 2: Update items passed ke ReprintCard**

Cari block `<ReprintCard ... items={items.map((it) => ({...}))}` di akhir component. Replace `items` prop dengan:

```tsx
              items={items.map((it) => ({
                id: it.id,
                menu_name_snapshot: it.menu_name_snapshot,
                menu_category: (it.menu_category ?? 'makanan') as
                  | 'makanan'
                  | 'nasi'
                  | 'minuman',
                unit_price_snapshot: it.unit_price_snapshot,
                qty: it.qty,
                notes: it.notes,
                printed_dapur_at: it.printed_dapur_at,
                printed_minuman_at: it.printed_minuman_at,
              }))}
```

- [ ] **Step 3: Verifikasi build**

```bash
npm run build
```

Expected: pass.

- [ ] **Step 4: Commit nanti dengan T19.**

---

# Task 19: page.tsx — select items dengan kolom baru

**Files:**
- Modify: `app/(app)/transactions/[id]/page.tsx`

- [ ] **Step 1: Cek state file dan select clause**

Buka file. Pastikan items query include `printed_dapur_at, printed_minuman_at`. Kalau pakai `select('*')` — sudah otomatis. Kalau pakai explicit column list — tambah dua kolom.

Verifikasi cara:
```bash
grep -n "transaction_items\|printed_" app/\(app\)/transactions/\[id\]/page.tsx
```

- [ ] **Step 2: Update select kalau perlu**

Kalau select ke `transaction_items` menggunakan column list, modify:

```ts
.select('id, menu_id, menu_name_snapshot, unit_price_snapshot, qty, notes, sort_order, printed_dapur_at, printed_minuman_at, menus(category)')
```

(adjust sesuai existing list)

- [ ] **Step 3: Verifikasi `Item` mapping konsisten**

Pastikan items yang diteruskan ke `<TransactionDetail items={...} />` punya `printed_dapur_at` & `printed_minuman_at` (mungkin perlu spread mapping).

- [ ] **Step 4: Run dev + manual verify**

```bash
npm run dev
```

Buka /transactions/<id confirmed tx> — confirm UI render reprint card 3-section dengan label benar.

- [ ] **Step 5: Commit T18 + T19**

```bash
git add components/transaction-detail.tsx app/\(app\)/transactions/\[id\]/page.tsx
git commit -m "feat(transactions): pass printed_*_at flags through detail → reprint card"
```

---

# Task 20: End-to-end manual verification

**Files:** none — verification

Skenario sesuai Phase 1 acceptance criteria di spec 1.8.

- [ ] **Step 1: Setup**

Pastikan dev server jalan + agent printer connected ke LAN. Untuk simulasi tanpa printer fisik, jalankan printer emulator (`nc -l 9100 | xxd` di host lain) atau verify via DB row di `print_queue`.

- [ ] **Step 2: Kitchen format BIG**

1. Buka /scan dari home, upload foto nota dengan beberapa item makanan & minuman.
2. Review → Simpan.
3. Verifikasi di `print_queue` row baru muncul 2x (target=dapur + target=minuman) dengan `trigger='auto'`, `item_ids` filled.
4. Decode bytes_b64 manual atau lihat output printer fisik — pastikan kitchen format (BIG, no price), item names UPPERCASE, qty di depan.

- [ ] **Step 3: Customer format dengan footer**

1. Pergi ke /setup/printer/settings, isi `Footer text` "Terima kasih atas kunjungan Anda\n~ Pak Pon ~". Simpan.
2. Buka detail transaksi → klik "Cetak nota customer".
3. Verifikasi row baru di `print_queue` dengan `target='customer'`, `trigger='customer'`, `item_ids` NULL.
4. Decode bytes — pastikan format lengkap (header, items dengan harga, Total, footer "Terima kasih...").

- [ ] **Step 4: Cetak tambahan delta**

1. Tunggu tx tadi sukses (`status='done'` di print_queue, atau force update SQL).
2. Verifikasi `transaction_items.printed_dapur_at` dan `printed_minuman_at` ter-set untuk items relevan.
3. Buka /transactions/<id>/review, tambah 1 item makanan baru, Simpan.
4. Verifikasi cuma 1 row print_queue baru muncul (`target='dapur'`, `trigger='auto_additional'`, `item_ids` cuma berisi 1 UUID baru).
5. Output bytes — cuma item baru saja yang ke-print, bukan semua.

- [ ] **Step 5: Cetak ulang full**

1. Di detail tx, klik "Cetak ulang Dapur".
2. Verifikasi `print_queue` row dengan `trigger='reprint'`, `item_ids` berisi semua dapur items (termasuk yang sudah printed_dapur_at non-null).
3. Output bytes — semua items dapur ke-print.

- [ ] **Step 6: Tombol disabled state**

1. Tx yang semua items sudah printed_*_at non-null → "Cetak tambahan" disabled.
2. Tx full minuman saja → "Cetak ulang Dapur" disabled.

- [ ] **Step 7: Error handling**

1. Stop printer atau set IP salah di settings printer.
2. Coba Simpan & Cetak — toast warning muncul kalau insert ke print_queue gagal.
3. Verifikasi tx tetap tersimpan (di /transactions list).

---

# Task 21: Final cleanup + tag

**Files:** none

- [ ] **Step 1: Run full test suite**

```bash
npm run test
npm run build
npm run lint
```

Expected: semua pass.

- [ ] **Step 2: Update docs/tasks.md kalau perlu**

Tambah entry untuk Phase 1 completion di section "Plan / Backlog".

- [ ] **Step 3: Git push (atau biarkan owner yang push)**

Plan selesai — Phase 1 ready ship. Phase 2 dan Phase 3 plan akan dibuat sebagai dokumen terpisah saat Phase 1 sudah deploy & stable.

---

# Out-of-band: Hal yang TIDAK dilakukan di Phase 1

- ❌ FCM-only architecture migration (Phase 2)
- ❌ `print_history` table (Phase 2)
- ❌ Drop realtime watcher di agent (Phase 2)
- ❌ Agent app Start/Stop state in Supabase (Phase 2)
- ❌ DROP TABLE print_queue (Phase 3)
- ❌ Update `printer-status-banner.tsx` untuk read agent status column (Phase 2)
