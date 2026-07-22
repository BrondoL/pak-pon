# Retensi Foto Nota 7 Hari — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cron `cleanup` harian menghapus foto nota (`scan_image_path` → bucket `notas`) untuk transaksi >7 hari **tanpa** menghapus transaksinya, supaya Storage Supabase free tier tidak penuh.

**Architecture:** Perluas `/api/cron/cleanup` (sudah jalan harian 02:00 WIB) dengan satu pass batch baru. Tandai foto yang sudah dibuang lewat kolom baru `transactions.scan_image_purged_at`, dipakai juga untuk membedakan transaksi POS (tak pernah ada foto) vs OCR yang fotonya sudah dihapus di badge riwayat. Logika keputusan diekstrak ke helper murni di `lib/transactions.ts` (pola sama seperti `buildPaidUpdate` di `lib/monitor.ts`); route cron tidak ditest (konsisten konvensi repo — cron route lain juga tanpa test).

**Tech Stack:** Next.js 16 (App Router, RSC), Supabase (Postgres + Storage), Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-23-scan-image-retention-design.md`

---

## File Structure

| File | Aksi | Tanggung jawab |
|------|------|----------------|
| `supabase/migrations/0037_scan_image_retention.sql` | Create | Kolom `scan_image_purged_at` + index parsial |
| `lib/transactions.ts` | Modify | 2 helper murni: `mapTransactionSource`, `buildScanImagePurge` |
| `lib/transactions.test.ts` | Modify | Test kedua helper |
| `app/api/cron/cleanup/route.ts` | Modify | Pass-3: purge foto batch |
| `app/(app)/transactions/page.tsx` | Modify | Badge pakai `mapTransactionSource` + select kolom baru |
| `app/(app)/transactions/[id]/page.tsx` | Modify | Hitung `scanPurged`, teruskan ke komponen |
| `components/transaction-detail.tsx` | Modify | Prop `scanPurged` + note "foto dihapus" |
| `app/(app)/transactions/[id]/review/page.tsx` | Modify | Hitung `scanPurged`, teruskan ke komponen |
| `components/nota-review-form.tsx` | Modify | Prop `scanPurged` + note "foto dihapus" |
| `CLAUDE.md` | Modify | Dok cleanup + ganti caveat proxy POS |

---

## Task 1: Migrasi DB — kolom penanda + index

**Files:**
- Create: `supabase/migrations/0037_scan_image_retention.sql`

- [ ] **Step 1: Tulis file migrasi**

Buat `supabase/migrations/0037_scan_image_retention.sql`:

```sql
-- 0037_scan_image_retention.sql
-- Retensi foto nota 7 hari: cron cleanup menghapus foto (scan_image_path → bucket
-- notas) untuk transaksi >7 hari TANPA menghapus transaksinya. Kolom ini menandai
-- foto yang sudah dibuang, sekaligus membedakan transaksi POS (scan_image_path NULL
-- sejak awal) vs OCR yang fotonya sudah di-purge (purged_at terisi) di badge riwayat.
-- NULL = foto belum pernah di-purge oleh cron.

ALTER TABLE transactions ADD COLUMN scan_image_purged_at timestamptz;

-- Index parsial: pass purge di cron hanya menyentuh baris yang masih punya foto.
-- Begitu scan_image_path di-NULL-kan, baris keluar dari index (idempoten + murah).
CREATE INDEX IF NOT EXISTS idx_transactions_photo_purgeable
  ON transactions (created_at)
  WHERE scan_image_path IS NOT NULL;
```

- [ ] **Step 2: Terapkan migrasi ke project Supabase**

Terapkan SQL di Step 1 ke project `nqptpijfrccjuytrslwc` (pak-pon) — via tooling migrasi Supabase yang biasa dipakai (Supabase MCP `apply_migration` dengan nama `scan_image_retention`, atau `supabase db push`). Migrasi WAJIB diterapkan sebelum cron pass-3 (Task 3) dijalankan, karena update menulis ke kolom baru.

- [ ] **Step 3: Verifikasi kolom ada**

Run (via Supabase SQL / MCP execute_sql):
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'transactions' AND column_name = 'scan_image_purged_at';
```
Expected: 1 baris `scan_image_purged_at`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0037_scan_image_retention.sql
git commit -m "feat(db): kolom scan_image_purged_at + index untuk retensi foto nota"
```

---

## Task 2: Helper murni `mapTransactionSource` + `buildScanImagePurge`

**Files:**
- Modify: `lib/transactions.ts`
- Test: `lib/transactions.test.ts`

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `lib/transactions.test.ts`. Pertama, tambahkan import helper baru ke baris import yang sudah ada di atas file:

```ts
import { buildItemInsertRows, computeReplaceItems, mapTransactionSource, buildScanImagePurge, type ExistingItem, type ItemRow, type RequestedItem, type MenuRef } from './transactions';
```

Lalu tambah blok test di akhir file:

```ts
describe('mapTransactionSource', () => {
  it('POS ketika path dan purged_at dua-duanya null', () => {
    expect(mapTransactionSource(null, null)).toBe('pos');
  });

  it('OCR ketika foto masih ada', () => {
    expect(mapTransactionSource('notas/2026/abc.jpg', null)).toBe('ocr');
  });

  it('OCR ketika foto sudah di-purge (path null tapi purged_at terisi)', () => {
    expect(mapTransactionSource(null, '2026-07-23T19:00:00Z')).toBe('ocr');
  });
});

describe('buildScanImagePurge', () => {
  it('mengosongkan path dan menyetel purged_at ke waktu yang diberikan', () => {
    expect(buildScanImagePurge('2026-07-23T19:00:00Z')).toEqual({
      scan_image_path: null,
      scan_image_purged_at: '2026-07-23T19:00:00Z',
    });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npm run test -- lib/transactions.test.ts`
Expected: FAIL — `mapTransactionSource is not a function` / `buildScanImagePurge is not a function`.

- [ ] **Step 3: Implementasi helper**

Tambahkan di akhir `lib/transactions.ts`:

```ts
/**
 * Sumber transaksi untuk badge riwayat.
 * POS = tidak pernah punya foto (scan_image_path NULL sejak insert /api/pos).
 * OCR = hasil scan; termasuk yang fotonya sudah di-purge cron retensi 7 hari
 * (scan_image_path di-NULL-kan tapi scan_image_purged_at terisi).
 */
export function mapTransactionSource(
  scanImagePath: string | null,
  scanImagePurgedAt: string | null,
): 'pos' | 'ocr' {
  return scanImagePath === null && scanImagePurgedAt === null ? 'pos' : 'ocr';
}

/**
 * Payload update saat cron membuang foto nota: kosongkan path + stempel waktu purge.
 * Path NULL bikin baris keluar dari index idx_transactions_photo_purgeable → idempoten.
 */
export function buildScanImagePurge(nowIso: string): {
  scan_image_path: null;
  scan_image_purged_at: string;
} {
  return { scan_image_path: null, scan_image_purged_at: nowIso };
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm run test -- lib/transactions.test.ts`
Expected: PASS (semua test lama + 4 test baru).

- [ ] **Step 5: Commit**

```bash
git add lib/transactions.ts lib/transactions.test.ts
git commit -m "feat(transactions): helper mapTransactionSource + buildScanImagePurge"
```

---

## Task 3: Cron `cleanup` — pass-3 purge foto

**Files:**
- Modify: `app/api/cron/cleanup/route.ts`

Tidak ada test route (konsisten: `cleanup` & `print-sweep` tidak punya route test; logika sudah dites via helper Task 2).

- [ ] **Step 1: Import helper**

Di `app/api/cron/cleanup/route.ts`, tambahkan import di dekat import atas:

```ts
import { buildScanImagePurge } from '@/lib/transactions';
```

- [ ] **Step 2: Tambah pass-3 sebelum `tagStatus(evt, 200)`**

Di `app/api/cron/cleanup/route.ts`, setelah blok cleanup `print_history` (setelah baris yang menyetel `evt.set('print_history_deleted', ...)`) dan **sebelum** `tagStatus(evt, 200);`, sisipkan:

```ts
    // Pass-3: purge foto nota transaksi >7 hari TANPA hapus transaksinya.
    // Bucket sama (notas), cutoff sama (7 hari). Batch loop cegah PostgREST 1000-row
    // cap. Idempoten: begitu scan_image_path di-NULL-kan, baris tidak match lagi.
    const nowIso = new Date().toISOString();
    let photosPurged = 0;
    for (;;) {
      const { data: photoBatch, error: photoSelectError } = await supabase
        .from('transactions')
        .select('id, scan_image_path')
        .not('scan_image_path', 'is', null)
        .lt('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(CHUNK);

      if (photoSelectError) {
        evt.warn(`photo_purge_select error: ${photoSelectError.message}`);
        break;
      }
      if (!photoBatch || photoBatch.length === 0) break;

      const photoIds = photoBatch.map((t) => t.id);
      const photoPaths = photoBatch
        .map((t) => t.scan_image_path)
        .filter((p): p is string => !!p);

      if (photoPaths.length > 0) {
        const { error: photoStorageError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove(photoPaths);
        if (photoStorageError) {
          evt.warn(`photo_purge_storage_partial: ${photoStorageError.message}`);
        }
      }

      // Tetap update DB walau storage.remove partial-fail: hindari retry foto sama
      // tiap hari. purged_at menandai foto sudah dibuang (badge riwayat pakai ini).
      const { error: photoUpdateError } = await supabase
        .from('transactions')
        .update(buildScanImagePurge(nowIso))
        .in('id', photoIds);
      if (photoUpdateError) {
        evt.warn(`photo_purge_update error: ${photoUpdateError.message}`);
        break;
      }

      photosPurged += photoIds.length;
      if (photoBatch.length < CHUNK) break;
    }
    evt.set('photos_purged_count', photosPurged);
```

- [ ] **Step 3: Verifikasi lint & build**

Run: `npm run lint`
Expected: no errors di `app/api/cron/cleanup/route.ts`.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/cleanup/route.ts
git commit -m "feat(cron): cleanup purge foto nota transaksi >7 hari (tanpa hapus tx)"
```

---

## Task 4: Badge riwayat pakai `mapTransactionSource`

**Files:**
- Modify: `app/(app)/transactions/page.tsx`

- [ ] **Step 1: Import helper**

Tambahkan import di `app/(app)/transactions/page.tsx` (dekat import atas):

```ts
import { mapTransactionSource } from '@/lib/transactions';
```

- [ ] **Step 2: Tambah kolom ke select**

Ubah string select (baris ~82) supaya menyertakan `scan_image_purged_at`:

```ts
    .select(
      'id, created_at, status, customer_name, table_no, handwritten_total, is_takeaway, scan_image_path, scan_image_purged_at, transaction_items(qty, unit_price_snapshot)',
      { count: 'exact' }
    )
```

- [ ] **Step 3: Ganti proxy inline dengan helper**

Ganti blok (baris ~110-113):

```ts
      // scan_image_path === null reliably means POS (created via POST /api/pos).
      // OCR/scan flow always uploads image first. Retention cron for cleaning
      // old scan images (backlog) not yet shipped — when it lands, revisit.
      source: tx.scan_image_path === null ? 'pos' as const : 'ocr' as const,
```

menjadi:

```ts
      // POS = tak pernah ada foto; OCR termasuk yang fotonya sudah di-purge cron
      // retensi 7 hari (scan_image_path NULL tapi scan_image_purged_at terisi).
      source: mapTransactionSource(
        tx.scan_image_path,
        (tx as { scan_image_purged_at?: string | null }).scan_image_purged_at ?? null,
      ),
```

- [ ] **Step 4: Verifikasi lint & build**

Run: `npm run lint`
Expected: no errors. Run: `npm run build` — pastikan halaman transaksi tetap tercompile.

- [ ] **Step 5: Commit**

```bash
git add app/(app)/transactions/page.tsx
git commit -m "fix(transactions): badge POS/OCR pakai scan_image_purged_at (bukan proxy path)"
```

---

## Task 5: Note "foto dihapus" di halaman detail

**Files:**
- Modify: `app/(app)/transactions/[id]/page.tsx`
- Modify: `components/transaction-detail.tsx`

- [ ] **Step 1: Ambil kolom baru + hitung `scanPurged` di page**

Di `app/(app)/transactions/[id]/page.tsx`, tambahkan `scan_image_purged_at` ke select (baris ~21):

```ts
    .select('id, status, handwritten_total, customer_name, table_no, is_takeaway, created_at, scan_image_path, scan_image_purged_at, daily_seq, paid_at')
```

Lalu setelah blok pembuatan `scanUrl` (setelah baris `scanUrl = signed?.signedUrl ?? null;` dan penutup `}`), tambahkan:

```ts
  const scanPurged = !tx.scan_image_path && !!tx.scan_image_purged_at;
```

- [ ] **Step 2: Teruskan prop ke komponen**

Di JSX `<TransactionDetail ... />` (setelah `scanUrl={scanUrl}`), tambahkan:

```tsx
      scanPurged={scanPurged}
```

- [ ] **Step 3: Tambah prop + render note di `TransactionDetail`**

Di `components/transaction-detail.tsx`, tambahkan `scanPurged` ke destructuring props dan tipe-nya:

```tsx
export function TransactionDetail({
  transaction,
  items,
  scanUrl,
  scanPurged,
  printerSettings,
}: {
  transaction: Transaction;
  items: Item[];
  scanUrl: string | null;
  scanPurged: boolean;
  printerSettings: PrinterSettings;
}) {
```

Ubah kelas grid (baris ~209) supaya tetap 2 kolom ketika ada note:

```tsx
      <div className={scanUrl || scanPurged ? 'grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]' : ''}>
```

Lalu tepat setelah blok `{scanUrl && ( ... )}` (setelah penutupnya, sebelum `<div className="space-y-6">`), tambahkan:

```tsx
        {!scanUrl && scanPurged && (
          <div className="lg:sticky lg:top-4 lg:self-start">
            <Card variant="paper" className="px-4 py-6 text-center text-sm text-coal/60">
              Foto nota sudah dihapus (retensi 7 hari)
            </Card>
          </div>
        )}
```

- [ ] **Step 4: Verifikasi lint & build**

Run: `npm run lint` lalu `npm run build`
Expected: no errors; halaman detail tercompile.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/transactions/[id]/page.tsx" components/transaction-detail.tsx
git commit -m "feat(transactions): note foto nota dihapus di halaman detail"
```

---

## Task 6: Note "foto dihapus" di halaman review

**Files:**
- Modify: `app/(app)/transactions/[id]/review/page.tsx`
- Modify: `components/nota-review-form.tsx`

- [ ] **Step 1: Ambil kolom baru + hitung `scanPurged` di page**

Di `app/(app)/transactions/[id]/review/page.tsx`, tambahkan `scan_image_purged_at` ke select transaksi (baris ~22):

```ts
    .select('id, status, handwritten_total, customer_name, table_no, is_takeaway, created_at, scan_image_path, scan_image_purged_at')
```

Setelah blok pembuatan `scanUrl` (setelah baris `scanUrl = signed?.signedUrl ?? null;` dan penutup `}`), tambahkan:

```ts
  const scanPurged = !tx.scan_image_path && !!tx.scan_image_purged_at;
```

- [ ] **Step 2: Teruskan prop ke komponen**

Di JSX `<NotaReviewForm ... />` (setelah `scanUrl={scanUrl}`), tambahkan:

```tsx
      scanPurged={scanPurged}
```

- [ ] **Step 3: Tambah prop + render note di `NotaReviewForm`**

Di `components/nota-review-form.tsx`, tambahkan `scanPurged` ke destructuring props + tipe-nya:

```tsx
export function NotaReviewForm({
  transaction,
  initialItems,
  menus,
  scanUrl,
  scanPurged,
  printerSettings,
}: {
  transaction: Transaction;
  initialItems: Omit<NotaItem, '_localId'>[];
  menus: MenuOption[];
  scanUrl: string | null;
  scanPurged: boolean;
  printerSettings: PrinterSettings;
}) {
```

Lalu tepat setelah blok `{scanUrl && ( ... )}` (baris ~397-407, setelah penutupnya), tambahkan:

```tsx
        {!scanUrl && scanPurged && (
          <div className="lg:sticky lg:top-4 lg:self-start">
            <Card variant="paper" className="px-4 py-6 text-center text-sm text-coal/60">
              Foto nota sudah dihapus (retensi 7 hari)
            </Card>
          </div>
        )}
```

- [ ] **Step 4: Verifikasi lint & build**

Run: `npm run lint` lalu `npm run build`
Expected: no errors; halaman review tercompile.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/transactions/[id]/review/page.tsx" components/nota-review-form.tsx
git commit -m "feat(transactions): note foto nota dihapus di halaman review"
```

---

## Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update deskripsi cron cleanup**

Di `CLAUDE.md`, di bagian Print system baris `- **Cleanup**: cron 02:00 WIB hapus \`print_history >7 hari\`.`, ganti jadi:

```markdown
- **Cleanup**: cron 02:00 WIB (`/api/cron/cleanup`) — (1) hard-delete transaksi soft-deleted >7 hari + fotonya, (2) hapus `print_history >7 hari`, (3) purge foto nota transaksi >7 hari yang TIDAK dihapus (`scan_image_path`→null, `scan_image_purged_at` diisi) biar Storage free tier ga penuh. Transaksinya tetap utuh. Print-sweep (*/5 min) di-cron eksternal (VPS crontab owner), bukan `vercel.json`.
```

- [ ] **Step 2: Ganti caveat proxy POS di bagian POS**

Di `CLAUDE.md` bagian POS, baris `- **History indicator**: transaction list badge kecil "POS" di baris yg \`scan_image_path === null\` (proxy: reliable sampai cron retention foto shipped).`, ganti jadi:

```markdown
- **History indicator**: transaction list badge kecil "POS" via `mapTransactionSource()` (`lib/transactions.ts`) — POS = `scan_image_path` NULL **dan** `scan_image_purged_at` NULL. OCR yang fotonya sudah di-purge cron retensi (`scan_image_purged_at` terisi) tetap dianggap OCR, bukan POS.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: cleanup purge foto nota + badge POS pakai scan_image_purged_at"
```

---

## Verifikasi akhir (setelah semua task)

- [ ] `npm run test` — semua lulus.
- [ ] `npm run lint` — bersih.
- [ ] `npm run build` — sukses.
- [ ] (Opsional, hati-hati — destruktif) Trigger `/api/cron/cleanup` sekali dengan header `Authorization: Bearer $CRON_SECRET` di lingkungan yang benar, lalu cek: transaksi >7 hari kini `scan_image_path IS NULL AND scan_image_purged_at IS NOT NULL`, dan halaman detail-nya menampilkan note "Foto nota sudah dihapus". **Ingat: run pertama menghapus foto SEMUA transaksi >7 hari, permanen.**
