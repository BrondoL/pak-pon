# Nota Customer Otomatis untuk Pesanan Bungkus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transaksi bungkus mencetak nota customer otomatis bersamaan dengan tiket dapur, saat pertama kali jadi `confirmed`.

**Architecture:** Helper baru `dispatchCustomerReceiptJob()` di `lib/print-dispatch.ts`, bersebelahan dengan `dispatchKitchenPrintJob` yang sudah ada. Keduanya dirapikan supaya berbagi dua fungsi privat (`buildTicketInput`, `postPrintJob`) alih-alih menyalin blok render + fetch. Tiga konsumen memakainya: `/pos`, halaman review, dan tombol cetak ulang di halaman detail — yang jalur customer lokalnya dihapus supaya hanya ada satu jalur nota customer di seluruh aplikasi.

**Tech Stack:** Next.js 16, React 19 client components, Vitest (jsdom, globals aktif), ESC/POS via `lib/escpos.ts`.

**Spec:** `docs/superpowers/specs/2026-08-07-takeaway-auto-customer-receipt-design.md`

## Global Constraints

- Money = `bigint` rupiah tanpa sen. Display selalu lewat `formatRp()` dari `lib/currency.ts`.
- **Tidak ada migrasi database.** `print_history.trigger` dan `.target` sudah mengizinkan `'customer'` sejak migrasi 0018. Jangan menambah nilai enum baru.
- **`item_ids: null` untuk job customer — wajib.** Trigger Postgres `mark_items_printed_history` (migrasi 0016) hanya menyala saat `item_ids` non-null. Kalau job customer mengirim daftar id, item-itemnya ditandai sudah tercetak ke dapur dan tombol "Cetak tambahan" mati padahal dapur belum menerima apa pun.
- UI: cek `components/ui/` dulu. Dilarang `window.confirm`/`alert`/`prompt`. Feedback lewat `toast` dari `sonner`.
- Design tokens dari `app/globals.css @theme` — jangan hardcode hex.
- ⚠️ `variant="secondary"` = warna yang sama dengan `Card variant="paper"` + `border-transparent` → tombolnya tak terlihat di atas card. Pakai `outline` di konteks itu.
- Teks UI & komentar: Bahasa Indonesia informal.
- Next.js 16 — konsultasi `node_modules/next/dist/docs/01-app/` kalau ragu konvensi.
- Perintah: `npm run test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- Baseline sebelum mulai: **250 test lulus di 21 file.** Harus tetap hijau.
- Repo punya knowledge graph di `graphify-out/` — pakai `graphify query "<pertanyaan>"` sebelum eksplorasi luas.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `lib/print-dispatch.ts` (modify) | + `dispatchCustomerReceiptJob`, + `DispatchTarget`, ekstrak `buildTicketInput` & `postPrintJob` |
| `lib/print-dispatch.test.ts` (modify) | + test job customer (terutama `item_ids: null`) |
| `components/pos/pos-client.tsx` (modify) | Kirim job customer kalau bungkus |
| `components/nota-review-form.tsx` (modify) | Kirim job customer kalau bungkus + baru pertama confirmed |
| `components/reprint-card.tsx` (modify) | `fireCustomer` pakai helper bersama; jalur customer lokal dihapus; `applied_chips` ikut ke tiket dapur |
| `components/transaction-detail.tsx` (modify) | Teruskan `applied_chips` |
| `app/(app)/transactions/[id]/page.tsx` (modify) | Ambil `applied_chips` |

**Tidak diubah:** `lib/escpos.ts`, semua route API, semua migrasi.

---

## Task 1: Helper `dispatchCustomerReceiptJob`

**Files:**
- Modify: `lib/print-dispatch.ts`
- Test: `lib/print-dispatch.test.ts`

**Interfaces:**
- Consumes: `renderCustomerReceipt`, `renderKitchenTicket`, `uint8ToBase64` dari `./escpos`; `PrinterSettings` dari `./printer-settings`.
- Produces — dipakai Task 2 dan 3:
  ```ts
  export type DispatchTarget = PrintTarget | 'customer';   // 'dapur' | 'minuman' | 'customer'
  export async function dispatchCustomerReceiptJob(args: {
    tx: PrintJobTx;
    items: PrintJobItem[];
    printerSettings: PrinterSettings;
  }): Promise<{ ok: boolean; offline: boolean }>;
  ```

- [ ] **Step 1: Tulis test yang gagal**

Ganti isi `lib/print-dispatch.test.ts` — pertahankan blok `splitItemsByPrintTarget` yang sudah ada persis seperti sekarang, lalu tambahkan di bawahnya. Baris import di atas file jadi:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { splitItemsByPrintTarget, dispatchCustomerReceiptJob } from './print-dispatch';
import { DEFAULT_PRINTER_SETTINGS } from './printer-settings';
```

Lalu di akhir file:

```ts
const tx = {
  id: 'tx-1',
  daily_seq: 7,
  created_at: '2026-08-07T05:00:00.000Z',
  customer_name: 'Budi',
  table_no: '5',
  is_takeaway: true,
};

const items = [
  {
    id: 'item-1',
    qty: 2,
    menu_name_snapshot: 'Ayam goreng',
    unit_price_snapshot: 23000,
    notes: null,
    applied_chips: [{ label: 'Jumbo', price_delta: 3000 }],
  },
];

/** Ambil body JSON dari panggilan fetch ke-`callIndex`. */
function bodyOf(mock: ReturnType<typeof vi.fn>, callIndex = 0) {
  return JSON.parse(mock.mock.calls[callIndex][1].body as string);
}

describe('dispatchCustomerReceiptJob', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to the print endpoint with the customer target and trigger', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await dispatchCustomerReceiptJob({
      tx, items, printerSettings: DEFAULT_PRINTER_SETTINGS,
    });

    expect(result).toEqual({ ok: true, offline: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/print/send');
    const body = bodyOf(fetchMock);
    expect(body.tx_id).toBe('tx-1');
    expect(body.target).toBe('customer');
    expect(body.trigger).toBe('customer');
  });

  it('sends item_ids as null so the DB trigger does not mark items kitchen-printed', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await dispatchCustomerReceiptJob({ tx, items, printerSettings: DEFAULT_PRINTER_SETTINGS });

    expect(bodyOf(fetchMock).item_ids).toBeNull();
  });

  it('sends a non-empty rendered payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await dispatchCustomerReceiptJob({ tx, items, printerSettings: DEFAULT_PRINTER_SETTINGS });

    expect(bodyOf(fetchMock).bytes_b64.length).toBeGreaterThan(0);
  });

  it('reports offline on HTTP 503', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await dispatchCustomerReceiptJob({ tx, items, printerSettings: DEFAULT_PRINTER_SETTINGS });
    expect(result).toEqual({ ok: false, offline: true });
  });

  it('reports a plain failure on HTTP 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const result = await dispatchCustomerReceiptJob({ tx, items, printerSettings: DEFAULT_PRINTER_SETTINGS });
    expect(result).toEqual({ ok: false, offline: false });
  });

  it('swallows a network throw instead of rejecting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const result = await dispatchCustomerReceiptJob({ tx, items, printerSettings: DEFAULT_PRINTER_SETTINGS });
    expect(result).toEqual({ ok: false, offline: false });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm run test -- lib/print-dispatch.test.ts`
Expected: FAIL — `dispatchCustomerReceiptJob is not a function`.

- [ ] **Step 3: Rapikan bagian bersama, lalu implementasi**

Di `lib/print-dispatch.ts`:

1. Ubah baris impor pertama jadi:

```ts
import { renderKitchenTicket, renderCustomerReceipt, uint8ToBase64 } from './escpos';
```

2. Tambahkan tipe target gabungan tepat di bawah `export type PrintTrigger = …`:

```ts
/** Target yang bisa muncul di hasil dispatch — termasuk nota customer. */
export type DispatchTarget = PrintTarget | 'customer';
```

3. Sisipkan dua fungsi privat tepat di atas `dispatchKitchenPrintJob`:

```ts
/** Bentuk input tiket yang dipakai renderer dapur maupun customer. */
function buildTicketInput(tx: PrintJobTx, items: PrintJobItem[]) {
  return {
    daily_seq: tx.daily_seq ?? 0,
    created_at: new Date(tx.created_at),
    customer_name: tx.customer_name,
    table_no: tx.table_no,
    is_takeaway: tx.is_takeaway,
    items: items.map((i) => ({
      qty: i.qty,
      name: i.menu_name_snapshot,
      unit_price: i.unit_price_snapshot,
      note: i.notes,
      applied_chips: i.applied_chips,
    })),
  };
}

/**
 * Kirim byte hasil render ke `/api/print/send`. Ga pernah melempar — kegagalan
 * jaringan dikembalikan sebagai `{ ok: false }` supaya pemanggil bisa lanjut
 * menangani job lain di Promise.all yang sama.
 */
async function postPrintJob(args: {
  tx_id: string;
  target: DispatchTarget;
  trigger: string;
  item_ids: string[] | null;
  bytes: Uint8Array;
}): Promise<{ ok: boolean; offline: boolean }> {
  try {
    const res = await fetch('/api/print/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id: args.tx_id,
        target: args.target,
        trigger: args.trigger,
        item_ids: args.item_ids,
        bytes_b64: uint8ToBase64(args.bytes),
      }),
    });
    if (res.ok) return { ok: true, offline: false };
    return { ok: false, offline: res.status === 503 };
  } catch {
    return { ok: false, offline: false };
  }
}
```

4. Ganti **badan** `dispatchKitchenPrintJob` (dari `const bytes = …` sampai penutup fungsi) dengan:

```ts
  const bytes = renderKitchenTicket(buildTicketInput(args.tx, args.items), args.printerSettings);
  return postPrintJob({
    tx_id: args.tx.id,
    target: args.target,
    trigger: args.trigger,
    item_ids: args.items.map((i) => i.id),
    bytes,
  });
}
```

Tanda tangan dan komentar JSDoc di atasnya tidak berubah. Ini refactor murni — perilakunya harus persis sama.

5. Tambahkan fungsi baru di akhir file:

```ts
/**
 * Render nota customer (format lengkap dengan harga + footer) dan kirim ke
 * `/api/print/send`. Dipakai cetak otomatis pesanan bungkus (`pos-client`,
 * `nota-review-form`) dan tombol cetak ulang manual (`reprint-card`) — satu
 * jalur, supaya nota otomatis dan nota cetak ulang ga pernah beda isi.
 *
 * `item_ids` SELALU null. Trigger Postgres `mark_items_printed_history` cuma
 * nyala kalau item_ids terisi; kalau job customer ikut mengirim daftar id,
 * itemnya ketandai sudah tercetak ke dapur dan tombol "Cetak tambahan" mati
 * padahal dapur belum nerima apa-apa. Jangan diisi.
 */
export async function dispatchCustomerReceiptJob(args: {
  tx: PrintJobTx;
  items: PrintJobItem[];
  printerSettings: PrinterSettings;
}): Promise<{ ok: boolean; offline: boolean }> {
  const bytes = renderCustomerReceipt(buildTicketInput(args.tx, args.items), args.printerSettings);
  return postPrintJob({
    tx_id: args.tx.id,
    target: 'customer',
    trigger: 'customer',
    item_ids: null,
    bytes,
  });
}
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npm run test -- lib/print-dispatch.test.ts`
Expected: PASS (4 test lama + 6 baru = 10).

- [ ] **Step 5: Verifikasi seluruh suite & tipe**

Run: `npm run test && npm run lint && npx tsc --noEmit`
Expected: 256 test lulus di 21 file, lint & tsc bersih.

- [ ] **Step 6: Commit**

```bash
git add lib/print-dispatch.ts lib/print-dispatch.test.ts
git commit -m "feat(print): helper dispatchCustomerReceiptJob + rapikan bagian bersama"
```

---

## Task 2: Cetak otomatis di `/pos` dan halaman review

**Files:**
- Modify: `components/pos/pos-client.tsx`
- Modify: `components/nota-review-form.tsx`

**Interfaces:**
- Consumes: `dispatchCustomerReceiptJob`, `DispatchTarget` dari Task 1.
- Produces: tidak ada.

**Aturan yang diimplementasikan:** nota customer dikirim hanya saat transaksi **bungkus** pertama kali jadi `confirmed`. Di `/pos` setiap simpan selalu membuat transaksi confirmed baru, jadi syaratnya cukup `is_takeaway`. Di halaman review syaratnya `is_takeaway` **dan** `wasConfirmedBefore === false`.

- [ ] **Step 1: `/pos` — tambah job customer**

Di `components/pos/pos-client.tsx`:

1. Ubah impor print-dispatch jadi:

```tsx
import {
  dispatchKitchenPrintJob, dispatchCustomerReceiptJob, splitItemsByPrintTarget,
  type DispatchTarget,
} from '@/lib/print-dispatch';
```

(`PrintTarget` tidak lagi diimpor kalau sudah tidak dipakai di file ini — hapus dari daftar impor kalau `tsc`/lint menandainya.)

2. Ganti deklarasi `jobs` (sekarang berbunyi `const jobs: Promise<{ target: PrintTarget; ok: boolean; offline: boolean }>[] = [];`) dengan:

```tsx
      const jobs: Promise<{ target: DispatchTarget; ok: boolean; offline: boolean }>[] = [];
```

3. Tepat **setelah** blok `if (split.minuman.length > 0) { … }` dan **sebelum** `const results = await Promise.all(jobs);`, sisipkan:

```tsx
      // Pesanan bungkus dibawa pergi — notanya harus ikut keluar bareng tiket
      // dapur, tanpa kasir perlu buka detail transaksi dulu. Pakai SELURUH
      // cart, bukan hasil split per printer.
      if (data.transaction.is_takeaway) {
        jobs.push(
          dispatchCustomerReceiptJob({ tx: data.transaction, items: cartWithIds, printerSettings })
            .then((r) => ({ ...r, target: 'customer' as const })),
        );
      }
```

Cabang toast di bawahnya tidak diubah — `failed.map((f) => f.target).join(', ')` sudah otomatis menyebut `customer` kalau job itu yang gagal.

- [ ] **Step 2: Halaman review — tambah job customer**

Di `components/nota-review-form.tsx`:

1. Ubah impor print-dispatch supaya menyertakan `dispatchCustomerReceiptJob` dan `DispatchTarget` (pertahankan yang sudah ada di baris itu).

2. Ganti deklarasi `submitJobs` (sekarang `const submitJobs: Promise<{ target: PrintTarget; ok: boolean; offline: boolean; trigger: string }>[] = [];`) dengan:

```tsx
      const submitJobs: Promise<{ target: DispatchTarget; ok: boolean; offline: boolean; trigger: string }>[] = [];
```

3. Tepat **setelah** blok `if (minumanJob) { … }` dan **sebelum** `const results = await Promise.all(submitJobs);`, sisipkan:

```tsx
      // Bungkus + baru pertama kali confirmed → nota customer ikut tercetak.
      // Sengaja pakai itemsForQueue utuh, BUKAN hasil buildJob: buildJob
      // menyaring per printed_*_at untuk delta dapur, sedangkan nota customer
      // harus selalu berisi seluruh isi transaksi.
      if (!wasConfirmedBefore && data.transaction.is_takeaway) {
        submitJobs.push(
          dispatchCustomerReceiptJob({ tx: data.transaction, items: itemsForQueue, printerSettings })
            .then((r) => ({ ...r, target: 'customer' as const, trigger: 'customer' })),
        );
      }
```

Blok toast di bawahnya tidak diubah. `reprintCount` hanya menghitung `trigger === 'reprint'`, jadi job customer tidak mengubah pemilihan kata `action`.

- [ ] **Step 3: Verifikasi**

Run: `npm run test && npm run lint && npx tsc --noEmit && npm run build`
Expected: 256 test lulus, lint/tsc bersih, build sukses.

- [ ] **Step 4: Commit**

```bash
git add components/pos/pos-client.tsx components/nota-review-form.tsx
git commit -m "feat(print): nota customer otomatis untuk pesanan bungkus"
```

---

## Task 3: Satukan jalur nota customer di kartu cetak ulang

**Files:**
- Modify: `app/(app)/transactions/[id]/page.tsx`
- Modify: `components/transaction-detail.tsx`
- Modify: `components/reprint-card.tsx`

**Interfaces:**
- Consumes: `dispatchCustomerReceiptJob` dari Task 1.
- Produces: tidak ada.

**Dua cacat lama yang ikut beres di sini.** `reprint-card.tsx` menyusun tiketnya sendiri (baris ~47-64) dan **tidak menyertakan `applied_chips`**:

1. **Tiket dapur cetak ulang kehilangan label chip.** Mencetak ulang tiket Ayam goreng menghilangkan keterangan "Dada"/"Paha" — dapur bisa memasak bagian yang salah. Ini yang paling berdampak.
2. **Nota customer cetak ulang kehilangan baris chip berbayar.** Totalnya tetap benar (harga chip sudah menyatu di `unit_price_snapshot`), hanya keterangannya hilang. Dampaknya nol pada data sekarang karena semua chip produksi ber-`price_delta = 0`, dan `renderCustomerReceipt` memang hanya menampilkan chip dengan delta > 0.

Keduanya sembuh begitu `applied_chips` dirangkai sampai ke sini.

- [ ] **Step 1: Ambil `applied_chips` di query halaman detail**

Di `app/(app)/transactions/[id]/page.tsx` baris 29, tambahkan `applied_chips` ke `select()` item:

```ts
    .select('id, menu_name_snapshot, unit_price_snapshot, qty, notes, applied_chips, sort_order, printed_dapur_at, printed_minuman_at, menus(category)')
```

Tidak ada perubahan lain di file ini.

- [ ] **Step 2: Teruskan lewat `transaction-detail.tsx`**

1. Tambahkan field ke tipe `Item` (sekarang di baris 25-34), tepat setelah `notes`:

```ts
  applied_chips?: Array<{ label: string; price_delta: number }> | null;
```

Opsional + nullable karena baris lama bisa saja `null` di kolom jsonb-nya.

2. Di pemetaan `items` yang diteruskan ke `<ReprintCard>` (sekarang baris 310-322), tambahkan setelah `notes: it.notes,`:

```tsx
                applied_chips: it.applied_chips ?? [],
```

- [ ] **Step 3: Pakai helper bersama di `reprint-card.tsx`**

1. Ubah blok impor di atas file:

```tsx
import { renderKitchenTicket, uint8ToBase64 } from '@/lib/escpos';
import { dispatchCustomerReceiptJob } from '@/lib/print-dispatch';
```

(`renderCustomerReceipt` tidak lagi dipakai di file ini.)

2. Tambahkan field ke `TransactionItemForPrint`, setelah `notes`:

```ts
  applied_chips: Array<{ label: string; price_delta: number }>;
```

3. Sempitkan kedua tipe target/trigger — job customer tidak lagi lewat `submitJob`, jadi `'customer'` tidak boleh lagi muncul di sini:

```ts
export type PrinterTarget = 'dapur' | 'minuman';

type Trigger = 'reprint' | 'reprint_additional';
```

4. Ganti `submitJob` seluruhnya dengan versi khusus dapur/minuman (perhatikan `applied_chips` yang sekarang ikut):

```tsx
async function submitJob(args: {
  tx: TxBase;
  target: PrinterTarget;
  items: TransactionItemForPrint[];
  trigger: Trigger;
  printerSettings: PrinterSettings;
}): Promise<{ ok: boolean; error?: string }> {
  const bytes = renderKitchenTicket(
    {
      daily_seq: args.tx.daily_seq ?? 0,
      created_at: new Date(args.tx.created_at),
      customer_name: args.tx.customer_name,
      table_no: args.tx.table_no,
      is_takeaway: args.tx.is_takeaway,
      items: args.items.map((i) => ({
        qty: i.qty,
        name: i.menu_name_snapshot,
        unit_price: i.unit_price_snapshot,
        note: i.notes,
        applied_chips: i.applied_chips,
      })),
    },
    args.printerSettings,
  );

  try {
    const res = await fetch('/api/print/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id: args.tx.id,
        target: args.target,
        trigger: args.trigger,
        item_ids: args.items.map((i) => i.id),
        bytes_b64: uint8ToBase64(bytes),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = (data as { error?: string }).error ?? `HTTP ${res.status}`;
      // 503 = agent_offline: special handling supaya UX bisa show toast tertentu.
      const isOffline = res.status === 503 && err === 'agent_offline';
      return { ok: false, error: isOffline ? 'agent_offline' : err };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
  }
}
```

5. Ganti `fireCustomer` dengan versi yang memakai helper bersama:

```tsx
  async function fireCustomer() {
    setSubmitting('customer');
    // Lewat helper bersama supaya nota cetak ulang identik dengan nota otomatis
    // yang keluar untuk pesanan bungkus. item_ids null diurus di dalam helper.
    const result = await dispatchCustomerReceiptJob({
      tx: transaction,
      items, // seluruh item — nota customer menampilkan semuanya beserta harga
      printerSettings,
    });
    setSubmitting(null);
    if (result.ok) toast.success('Cetak nota customer dikirim ke agent');
    else if (result.offline) {
      toast.warning('Agent printer offline', { description: 'Nyalakan agent di Android dulu, lalu coba lagi.', duration: 8000 });
    } else {
      toast.error('Gagal kirim job customer');
    }
  }
```

Catatan: `dispatchCustomerReceiptJob` mengembalikan `{ ok, offline }`, bukan `{ ok, error }`, jadi pesan errornya tidak lagi memuat detail HTTP. Itu disengaja — untuk kasir detail itu tidak berguna, dan wide-event log di `/api/print/send` tetap merekamnya.

6. `TxBase` sudah punya semua field yang dibutuhkan `PrintJobTx` (`id`, `daily_seq`, `created_at`, `customer_name`, `table_no`, `is_takeaway`) — tidak perlu diubah. Kalau `tsc` protes, laporkan; jangan menambahkan `as`.

- [ ] **Step 4: Verifikasi**

Run: `npm run test && npm run lint && npx tsc --noEmit && npm run build`
Expected: 256 test lulus, lint/tsc bersih, build sukses.

Lalu jalankan `grep -n "renderCustomerReceipt" -r components/` dan konfirmasi hasilnya kosong — satu-satunya pemanggil sekarang `lib/print-dispatch.ts`.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/transactions/[id]/page.tsx" components/transaction-detail.tsx components/reprint-card.tsx
git commit -m "fix(print): satukan jalur nota customer, kirim applied_chips saat cetak ulang"
```

---

## Task 4: Dokumentasi

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/tasks.md`
- Modify: `docs/superpowers/specs/2026-08-07-takeaway-auto-customer-receipt-design.md`

- [ ] **Step 1: `CLAUDE.md`**

Di bagian `## Print system (Phase 1+2+3 shipped 2026-06-25, primary agent + pending state 2026-06-26)`, tambahkan bullet setelah bullet **Format**:

```markdown
- **Nota customer otomatis untuk bungkus (2026-08-07)**: transaksi `is_takeaway=true` mencetak nota customer otomatis **saat pertama kali jadi `confirmed`** (simpan `/pos`, atau konfirmasi nota OCR di review saat `wasConfirmedBefore=false`), barengan tiket dapur di `Promise.all` yang sama. Edit setelah confirmed **tidak** mencetak ulang, begitu juga toggle bungkus belakangan — kasir pakai tombol manual di detail transaksi. Semua jalur nota customer (otomatis + tombol cetak ulang) lewat `dispatchCustomerReceiptJob` di `lib/print-dispatch.ts`, yang **selalu** kirim `item_ids: null` — trigger `mark_items_printed_history` cuma nyala kalau item_ids terisi, jadi kalau diisi, item ketandai sudah tercetak ke dapur & tombol "Cetak tambahan" mati padahal dapur belum nerima. Tanpa migrasi: `trigger`/`target` sudah izinkan `'customer'` sejak migrasi 0018. Spec `docs/superpowers/specs/2026-08-07-takeaway-auto-customer-receipt-design.md`.
```

- [ ] **Step 2: `docs/tasks.md`**

Baca file itu dulu dan ikuti format entri terakhir. Tambahkan entri untuk plan ini dengan status **implemented, menunggu verifikasi manual** — bukan selesai/terverifikasi. Perubahan perilakunya (kapan nota tercetak) tidak punya test otomatis dan hanya bisa dibuktikan dengan printer sungguhan.

- [ ] **Step 3: Status spec**

Ganti baris `**Status:** Approved (brainstorm), pending implementation plan` di file spec menjadi:

```
**Status:** Implemented 2026-08-07, pending manual browser verification — plan: `docs/superpowers/plans/2026-08-07-takeaway-auto-customer-receipt.md`
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/tasks.md docs/superpowers/specs/2026-08-07-takeaway-auto-customer-receipt-design.md docs/superpowers/plans/2026-08-07-takeaway-auto-customer-receipt.md
git commit -m "docs: catat nota customer otomatis untuk pesanan bungkus"
```

---

## Verifikasi manual (butuh manusia + printer)

Aturan "kapan tercetak" hidup di dalam komponen React dan repo ini tidak punya harness test komponen, jadi hanya bisa dibuktikan di sini. Butuh agent printer primary online.

1. `/pos`: pesanan **bungkus** → Simpan. Keluar tiket dapur **dan** nota customer, tanpa menyentuh tombol apa pun.
2. `/pos`: pesanan **dine-in** → Simpan. Hanya tiket dapur. Nota customer **tidak** keluar.
3. Review nota OCR **bungkus** → Simpan & Cetak. Tiket dapur + nota customer, nota berisi seluruh item.
4. Edit transaksi bungkus yang sudah confirmed, tambah 1 item → Simpan. **Hanya** tiket dapur tambahan. Nota customer tidak ikut (sesuai aturan).
5. Lanjut dari langkah 4: tekan "🧾 Cetak nota customer" di halaman detail → nota keluar dengan total baru yang benar.
6. **Paling penting:** setelah langkah 1, buka detail transaksinya dan pastikan tombol "⚡ Cetak tambahan" berperilaku normal — bukti `item_ids: null` bekerja dan job customer tidak ikut menandai item sebagai sudah tercetak ke dapur.
7. Matikan agent printer, ulangi langkah 1 → transaksi tetap tersimpan, toast menyebut target yang gagal.
8. Cetak ulang tiket **dapur** untuk transaksi berisi Ayam goreng dari halaman detail → label bagian ("Dada"/"Paha") sekarang **muncul** di tiket. Sebelum perubahan ini hilang.
9. Cetak ulang nota customer untuk transaksi yang sama → isinya identik dengan nota otomatis di langkah 1.

## Catatan implementasi

**Task 3 menyentuh kode cetak yang selama ini jalan.** Tombol "Cetak ulang Dapur", "Cetak ulang Minuman", "Cetak ulang Keduanya", dan "Cetak tambahan" semuanya lewat `submitJob` yang ditulis ulang di sana. Perilakunya harus persis sama kecuali tambahan `applied_chips`; kalau ragu suatu baris masih diperlukan, pertahankan dan laporkan sebagai concern.

**Jangan menambah nilai enum `trigger`.** Nota customer otomatis dan manual sama-sama `trigger='customer'` dan sengaja tidak dibedakan di `print_history` — memisahkannya butuh migrasi CHECK constraint dan tidak sepadan untuk tabel yang dibersihkan cron tiap 7 hari.
