# Bungkus Masuk Monitor + Nota Saat Ditandai Lunas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monitor menampilkan pesanan bungkus dengan badge; tombol Lunas menawarkan "Lunas saja" atau "Lunas + nota"; cetak nota otomatis saat simpan dicabut.

**Architecture:** Filter `is_takeaway` dilepas dari satu tempat (`fetchUnpaidRows`) yang dipakai bersama SSR dan polling. `MonitorBoard` memegang seluruh alur baru: badge, dialog tiga tombol, dan urutan tandai-lunas-dulu-baru-cetak. Nota dirender lewat `dispatchCustomerReceiptJob` yang sudah ada, memakai data dari `GET /api/transactions/[id]` karena kartu monitor tidak membawa daftar item.

**Tech Stack:** Next.js 16, React 19 client components, Vitest (jsdom, globals) + `@testing-library/react` + `user-event`.

**Spec:** `docs/superpowers/specs/2026-08-08-monitor-takeaway-and-receipt-on-paid-design.md`

## Global Constraints

- Money = `bigint` rupiah tanpa sen. Display selalu lewat `formatRp()` dari `lib/currency.ts`.
- **Tidak ada migrasi database**, tidak ada perubahan route API.
- UI: cek `components/ui/` dulu. Dilarang `window.confirm`/`alert`/`prompt`. Feedback lewat `toast` dari `sonner`.
- Design tokens dari `app/globals.css @theme` (`coal`, `clay`, `paper`, `cream`, `gold`, `gold-faint`, `gold-dark`, `mustard`, …) — jangan hardcode hex.
- ⚠️ `variant="secondary"` = warna yang sama dengan `Card variant="paper"` + `border-transparent` → tak terlihat di atas card. Pakai `outline`.
- ⚠️ `AlertDialogAction` di fork base-ui ini **bukan** `Close`. Yang menutup dialog Lunas hari ini adalah hilangnya baris dari daftar secara optimistic, yang meng-unmount dialognya. Pertahankan mekanisme itu; jangan menambah penutupan manual.
- ⚠️ Jangan tambahkan `key` pada `<MonitorAddItemModal>` dan jangan unmount dari efek polling — draft item hidup di state internalnya (lihat komentar yang sudah ada di `monitor-board.tsx`).
- **Repo ini PUNYA harness test komponen**: `@testing-library/react` + `user-event` + `jest-dom` + jsdom, di-wire lewat `vitest.setup.ts`. Contoh terdekat: `components/reprint-card.test.tsx`. Perilaku UI di plan ini **ditest**, bukan diserahkan ke verifikasi manual.
- Teks UI & komentar: Bahasa Indonesia informal.
- Perintah: `npm run test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- Baseline sebelum mulai: **256 test lulus di 21 file.** Harus tetap hijau.
- Knowledge graph di `graphify-out/` — pakai `graphify query "<pertanyaan>"` sebelum eksplorasi luas.
- **Jangan pernah menjalankan `git reset`, `git stash`, atau `git checkout --` pada working tree.** Ada perubahan milik manusia yang belum di-commit di repo ini; perintah-perintah itu pernah menghapusnya di sesi sebelumnya.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `lib/monitor.ts` (modify) | `MonitorRow`/`MonitorRawRow`/`mapMonitorRow` membawa `is_takeaway` |
| `lib/monitor.test.ts` (modify) | test untuk itu |
| `lib/monitor-server.ts` (modify) | hapus filter `is_takeaway`, ambil kolomnya |
| `components/monitor-board.tsx` (modify) | badge, teks, dialog 3 tombol, alur cetak, penjaga ketuk ganda |
| `components/monitor-board.test.tsx` (create) | test perilaku dialog + cetak |
| `app/(app)/monitor/page.tsx` (modify) | teks judul |
| `components/pos/pos-client.tsx` (modify) | cabut cetak-otomatis |
| `components/nota-review-form.tsx` (modify) | cabut cetak-otomatis |

**Tidak diubah:** `lib/print-dispatch.ts`, `components/reprint-card.tsx`, `components/monitor-add-item-modal.tsx`, semua route API, semua migrasi.

---

## Task 1: `is_takeaway` sampai ke kartu monitor

**Files:**
- Modify: `lib/monitor.ts`
- Modify: `lib/monitor-server.ts`
- Test: `lib/monitor.test.ts`

**Interfaces:**
- Produces — dipakai Task 2 & 3:
  ```ts
  export type MonitorRow = {
    id: string; created_at: string;
    customer_name: string | null; table_no: string | null;
    is_takeaway: boolean;
    total: number; item_count: number;
  };
  ```

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `lib/monitor.test.ts`. Sesuaikan baris import di atas file kalau perlu (`MonitorRawRow` mungkin belum diimpor).

```ts
describe('mapMonitorRow — is_takeaway', () => {
  const base = {
    id: 'tx-1',
    created_at: '2026-08-08T05:00:00.000Z',
    customer_name: 'Budi',
    table_no: '5',
    transaction_items: [{ qty: 2, unit_price_snapshot: 10000 }],
  };

  it('carries is_takeaway true through unchanged', () => {
    const row = mapMonitorRow({ ...base, is_takeaway: true } as MonitorRawRow);
    expect(row.is_takeaway).toBe(true);
  });

  it('carries is_takeaway false through unchanged', () => {
    const row = mapMonitorRow({ ...base, is_takeaway: false } as MonitorRawRow);
    expect(row.is_takeaway).toBe(false);
  });

  it('still computes total and item_count alongside the flag', () => {
    const row = mapMonitorRow({ ...base, is_takeaway: true } as MonitorRawRow);
    expect(row.total).toBe(20000);
    expect(row.item_count).toBe(1);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm run test -- lib/monitor.test.ts`
Expected: FAIL — `is_takeaway` tidak ada di tipe / `undefined` di hasil.

- [ ] **Step 3: Implementasi**

Di `lib/monitor.ts`, tambahkan `is_takeaway: boolean;` ke **`MonitorRawRow`** (setelah `table_no`) dan ke **`MonitorRow`** (setelah `table_no`), lalu teruskan di `mapMonitorRow`:

```ts
export function mapMonitorRow(raw: MonitorRawRow): MonitorRow {
  const items = raw.transaction_items ?? [];
  return {
    id: raw.id,
    created_at: raw.created_at,
    customer_name: raw.customer_name,
    table_no: raw.table_no,
    is_takeaway: raw.is_takeaway,
    total: computeItemsTotal(items),
    item_count: items.length,
  };
}
```

Di `lib/monitor-server.ts`, ubah query di `fetchUnpaidRows`: tambahkan `is_takeaway` ke `select()` dan **hapus baris `.eq('is_takeaway', false)`**. Perbarui juga komentar JSDoc di atasnya — sekarang berbunyi "confirmed + dine-in + paid_at NULL"; ganti jadi menyebut dine-in **dan** bungkus, dengan alasan singkat (kasir menandai lunas bungkus dari papan yang sama).

```ts
  const { data, error } = await supabase
    .from('transactions')
    .select('id, created_at, customer_name, table_no, is_takeaway, transaction_items(qty, unit_price_snapshot)')
    .eq('status', 'confirmed')
    .is('paid_at', null)
    .is('deleted_at', null)
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at', { ascending: true });
```

- [ ] **Step 4: Jalankan test, pastikan LULUS**

Run: `npm run test -- lib/monitor.test.ts`
Expected: PASS.

- [ ] **Step 5: Verifikasi penuh**

Run: `npm run test && npm run lint && npx tsc --noEmit`
Expected: 259 test lulus, lint & tsc bersih.

`tsc` mungkin mengeluh di `components/monitor-board.tsx` karena `MonitorRow` sekarang punya field wajib baru — kalau muncul di file selain yang task ini sentuh, laporkan dan **jangan** perbaiki di sini; Task 2 yang mengurusnya.

- [ ] **Step 6: Commit**

```bash
git add lib/monitor.ts lib/monitor-server.ts lib/monitor.test.ts
git commit -m "feat(monitor): bungkus ikut tampil di papan, bawa flag is_takeaway"
```

---

## Task 2: Badge bungkus + teks halaman

**Files:**
- Modify: `components/monitor-board.tsx`
- Modify: `app/(app)/monitor/page.tsx`

**Interfaces:**
- Consumes: `MonitorRow.is_takeaway` dari Task 1.
- Produces: tidak ada.

Task ini murni tampilan. Dialog dan alur cetak dikerjakan Task 3 — jangan disentuh di sini.

- [ ] **Step 1: Badge di kartu**

Di `components/monitor-board.tsx`, blok judul kartu sekarang berbunyi:

```tsx
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-display text-2xl leading-none text-coal">
                    {row.table_no ? `Meja ${row.table_no}` : 'Tanpa meja'}
                  </span>
                  <span className="shrink-0 text-xs text-clay">{formatTimeWIB(row.created_at)}</span>
                </div>
```

Ganti dengan:

```tsx
                <div className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-display text-2xl leading-none text-coal">
                      {row.table_no ? `Meja ${row.table_no}` : 'Tanpa meja'}
                    </span>
                    {row.is_takeaway && (
                      <span className="shrink-0 rounded-full border border-gold/40 bg-gold-faint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold-dark">
                        Bungkus
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-clay">{formatTimeWIB(row.created_at)}</span>
                </div>
```

- [ ] **Step 2: Teks yang menyebut "meja"**

Papan sekarang memuat bungkus juga, jadi kata "meja" di teks umum jadi salah. Ganti empat tempat di `components/monitor-board.tsx`:

1. Ringkasan jumlah — `'Tidak ada meja belum bayar'` → `'Tidak ada pesanan belum bayar'`
2. Pada baris hitungan, `</span> meja belum bayar` → `</span> pesanan belum bayar`
3. Kondisi kosong — `Semua meja sudah bayar 🎉` → `Semua pesanan sudah bayar 🎉`, dan kalimat di bawahnya `Belum ada tagihan meja yang tertunda hari ini.` → `Belum ada pesanan yang belum dibayar hari ini.`
4. Hasil pencarian kosong — `Tidak ada meja cocok dengan “…”` → `Tidak ada pesanan cocok dengan “…”`

Placeholder input pencarian (`Cari meja atau nama…`) dan `aria-label`-nya **tetap** — mencari bungkus lewat nama pelanggan tetap masuk akal, dan mengubahnya akan memutus test yang mungkin menargetkannya.

- [ ] **Step 3: Judul halaman**

Di `app/(app)/monitor/page.tsx`:

```tsx
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Pesanan <span className="italic">belum bayar</span>
        </h1>
        <p className="mt-2 text-sm text-coal-soft">
          Dine-in dan bungkus. Diperbarui otomatis tiap 15 detik. Tandai lunas saat pesanan sudah dibayar.
        </p>
```

Eyebrow "Monitor" di atasnya tidak berubah.

- [ ] **Step 4: Verifikasi**

Run: `npm run test && npm run lint && npx tsc --noEmit && npm run build`
Expected: semua bersih/hijau.

- [ ] **Step 5: Commit**

```bash
git add components/monitor-board.tsx "app/(app)/monitor/page.tsx"
git commit -m "feat(monitor): badge bungkus di kartu + teks papan ga lagi bilang meja"
```

---

## Task 3: Dialog Lunas dua pilihan + cetak nota

**Files:**
- Modify: `components/monitor-board.tsx`
- Test: `components/monitor-board.test.tsx` (baru)

**Interfaces:**
- Consumes: `MonitorRow.is_takeaway`; `dispatchCustomerReceiptJob` dari `lib/print-dispatch.ts`; `printerSettings` yang sudah jadi prop `MonitorBoard`.
- Produces: tidak ada.

**Kontrak `GET /api/transactions/[id]`** (sudah ada, tidak diubah): `{ transaction, items, scan_url }`. `transaction` dari `select('*')` jadi memuat `daily_seq`, `created_at`, `customer_name`, `table_no`, `is_takeaway`. `items` dari `select('*, menus(category)')` jadi memuat `applied_chips`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `components/monitor-board.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MonitorBoard } from './monitor-board';
import type { MonitorRow } from '@/lib/monitor';
import { DEFAULT_PRINTER_SETTINGS } from '@/lib/printer-settings';

function mkRow(override: Partial<MonitorRow> = {}): MonitorRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    created_at: '2026-08-08T05:00:00.000Z',
    customer_name: 'Budi',
    table_no: '5',
    is_takeaway: false,
    total: 84000,
    item_count: 4,
    ...override,
  };
}

const txDetail = {
  transaction: {
    id: '11111111-1111-4111-8111-111111111111',
    daily_seq: 7,
    created_at: '2026-08-08T05:00:00.000Z',
    customer_name: 'Budi',
    table_no: '5',
    is_takeaway: true,
  },
  items: [
    {
      id: 'item-1', qty: 2, menu_name_snapshot: 'Ayam goreng',
      unit_price_snapshot: 23000, notes: null,
      applied_chips: [{ label: 'Dada', price_delta: 0 }],
    },
  ],
  scan_url: null,
};

/** Router fetch mock: cocokkan berdasarkan URL + method. */
function mockFetch(handlers: {
  patchOk?: boolean;
  detailOk?: boolean;
  printStatus?: number;
}) {
  const { patchOk = true, detailOk = true, printStatus = 201 } = handlers;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/monitor') {
      return Promise.resolve(new Response(JSON.stringify({ rows: [] }), { status: 200 }));
    }
    if (url === '/api/print/send') {
      return Promise.resolve(new Response(JSON.stringify({}), { status: printStatus }));
    }
    if (url.startsWith('/api/transactions/') && init?.method === 'PATCH') {
      return Promise.resolve(new Response(JSON.stringify({}), { status: patchOk ? 200 : 500 }));
    }
    if (url.startsWith('/api/transactions/')) {
      return Promise.resolve(
        new Response(JSON.stringify(txDetail), { status: detailOk ? 200 : 500 }),
      );
    }
    return Promise.resolve(new Response('{}', { status: 200 }));
  });
}

describe('<MonitorBoard /> — lunas & nota', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the BUNGKUS badge only on takeaway rows', () => {
    vi.stubGlobal('fetch', mockFetch({}));
    render(
      <MonitorBoard
        initialRows={[mkRow({ id: 'a', is_takeaway: true }), mkRow({ id: 'b', table_no: '9', is_takeaway: false })]}
        menus={[]}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
      />,
    );
    expect(screen.getAllByText(/bungkus/i)).toHaveLength(1);
  });

  it('"Lunas saja" marks paid without printing anything', async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow()]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas saja/i }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calls).toContain('/api/transactions/11111111-1111-4111-8111-111111111111');
    });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain('/api/print/send');
  });

  it('"Lunas + nota" marks paid, fetches the transaction, then prints', async () => {
    const fetchMock = mockFetch({});
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow({ is_takeaway: true })]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas \+ nota/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/api/print/send');
    });
    const printCall = fetchMock.mock.calls.find((c) => String(c[0]) === '/api/print/send')!;
    const body = JSON.parse((printCall[1] as RequestInit).body as string);
    expect(body.target).toBe('customer');
    expect(body.trigger).toBe('customer');
    expect(body.item_ids).toBeNull();
  });

  it('does not print when marking paid fails', async () => {
    const fetchMock = mockFetch({ patchOk: false });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow({ is_takeaway: true })]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas \+ nota/i }));

    await waitFor(() => {
      expect(screen.getByText(/meja 5/i)).toBeInTheDocument(); // baris balik muncul
    });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain('/api/print/send');
  });

  it('keeps the row removed and does not throw when the detail fetch fails after a successful mark', async () => {
    const fetchMock = mockFetch({ detailOk: false });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow({ is_takeaway: true })]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas \+ nota/i }));

    await waitFor(() => {
      expect(screen.queryByText(/meja 5/i)).not.toBeInTheDocument();
    });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).not.toContain('/api/print/send');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm run test -- components/monitor-board.test.tsx`
Expected: FAIL — tombol "Lunas saja" / "Lunas + nota" belum ada (dialog masih satu tombol "Ya, lunas").

- [ ] **Step 3: Impor + penjaga ketuk ganda**

Di `components/monitor-board.tsx`:

1. Tambahkan `useRef` ke impor React yang sudah ada.
2. Tambahkan impor: `import { dispatchCustomerReceiptJob } from '@/lib/print-dispatch';`
3. Di dalam komponen, setelah state `query`:

```tsx
  // Ketuk ganda cepat pada "Lunas + nota" sebelum React re-render akan
  // menjalankan alurnya dua kali → dua nota untuk satu pesanan. PATCH-nya
  // idempoten, tapi kertasnya kebuang dan pelanggan bingung.
  const inFlight = useRef<Set<string>>(new Set());
```

- [ ] **Step 4: Ganti `markPaid`**

Ganti seluruh fungsi `markPaid` dengan:

```tsx
  function labelFor(row: MonitorRow): string {
    if (row.table_no) return `Meja ${row.table_no}`;
    if (row.customer_name) return row.customer_name;
    return 'Transaksi';
  }

  async function markPaid(row: MonitorRow, opts: { printReceipt: boolean }) {
    if (inFlight.current.has(row.id)) return;
    inFlight.current.add(row.id);

    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== row.id)); // optimistic
    try {
      const res = await fetch(`/api/transactions/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paid: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`${labelFor(row)} ditandai lunas`);
    } catch {
      setRows(prev); // rollback
      toast.error('Gagal menandai lunas, coba lagi');
      inFlight.current.delete(row.id);
      return; // JANGAN cetak kalau penandaan lunas gagal
    }

    if (!opts.printReceipt) {
      inFlight.current.delete(row.id);
      return;
    }

    // Nota butuh daftar item lengkap, yang tidak dibawa kartu monitor.
    // Transaksi sudah tercatat lunas di titik ini — kegagalan apa pun di
    // bawah cuma soal kertas, jangan rollback status.
    try {
      const res = await fetch(`/api/transactions/${row.id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        transaction: {
          id: string; daily_seq: number | null; created_at: string;
          customer_name: string | null; table_no: string | null; is_takeaway: boolean;
        };
        items: Array<{
          id: string; qty: number; menu_name_snapshot: string;
          unit_price_snapshot: number; notes: string | null;
          applied_chips: Array<{ label: string; price_delta: number }> | null;
        }>;
      };

      const result = await dispatchCustomerReceiptJob({
        tx: data.transaction,
        items: data.items.map((i) => ({
          id: i.id,
          qty: i.qty,
          menu_name_snapshot: i.menu_name_snapshot,
          unit_price_snapshot: i.unit_price_snapshot,
          notes: i.notes,
          applied_chips: i.applied_chips ?? [],
        })),
        printerSettings,
      });

      if (result.ok) {
        toast.success('Nota customer dikirim ke agent');
      } else if (result.offline) {
        toast.warning(
          'Agent printer offline. Nyalakan agent lalu cetak manual dari detail transaksi.',
          { duration: 10000 },
        );
      } else {
        toast.error('Gagal kirim nota customer. Cetak manual dari detail transaksi.');
      }
    } catch {
      toast.error('Sudah ditandai lunas, tapi gagal ambil data nota. Cetak manual dari detail transaksi.');
    } finally {
      inFlight.current.delete(row.id);
    }
  }
```

- [ ] **Step 5: Dialog tiga tombol**

Ganti blok `<AlertDialogFooter>` di dalam kartu:

```tsx
                    <AlertDialogFooter>
                      <AlertDialogCancel>Batal</AlertDialogCancel>
                      <AlertDialogAction onClick={() => markPaid(row)}>Ya, lunas</AlertDialogAction>
                    </AlertDialogFooter>
```

dengan:

```tsx
                    <AlertDialogFooter>
                      <AlertDialogCancel>Batal</AlertDialogCancel>
                      {/* Tombol yang disorot ikut jenis pesanan: pelanggan bungkus
                          hampir selalu bawa notanya, pelanggan dine-in jarang minta.
                          Keduanya tetap tersedia di dua-duanya — ini arahan, bukan
                          pembatasan. */}
                      <AlertDialogAction
                        variant={row.is_takeaway ? 'outline' : 'default'}
                        onClick={() => markPaid(row, { printReceipt: false })}
                      >
                        Lunas saja
                      </AlertDialogAction>
                      <AlertDialogAction
                        variant={row.is_takeaway ? 'default' : 'outline'}
                        onClick={() => markPaid(row, { printReceipt: true })}
                      >
                        Lunas + nota
                      </AlertDialogAction>
                    </AlertDialogFooter>
```

Kalau `AlertDialogAction` tidak menerima prop `variant`, **berhenti dan laporkan** — jangan memalsukannya dengan `className` berisi warna hardcode. Periksa dulu tanda tangannya di `components/ui/alert-dialog.tsx`; kalau ia meneruskan prop ke `Button`, `variant` akan jalan.

Perbarui juga kalimat deskripsi dialog supaya tidak selalu bilang "Meja": pakai `labelFor(row)` untuk judulnya.

- [ ] **Step 6: Jalankan test, pastikan LULUS**

Run: `npm run test -- components/monitor-board.test.tsx`
Expected: PASS, 5 test.

Kalau ada test yang gagal karena pemilih (`getByRole`) tidak cocok dengan markup akhir, **sesuaikan pemilihnya, jangan melemahkan assertion-nya** — yang diperiksa (tidak mencetak saat "Lunas saja", tidak mencetak saat PATCH gagal, `item_ids: null`) harus tetap utuh.

- [ ] **Step 7: Verifikasi penuh**

Run: `npm run test && npm run lint && npx tsc --noEmit && npm run build`
Expected: 264 test lulus, lint/tsc bersih, build sukses.

- [ ] **Step 8: Commit**

```bash
git add components/monitor-board.tsx components/monitor-board.test.tsx
git commit -m "feat(monitor): Lunas saja / Lunas + nota, cetak nota customer dari papan"
```

---

## Task 4: Cabut cetak-otomatis saat simpan

**Files:**
- Modify: `components/pos/pos-client.tsx`
- Modify: `components/nota-review-form.tsx`

**Interfaces:**
- Consumes: tidak ada.
- Produces: tidak ada.

Nota customer sekarang keluar dari tombol Lunas di monitor. Kalau blok ini dibiarkan, satu pesanan bungkus mengeluarkan **dua** nota.

- [ ] **Step 1: `/pos`**

Di `components/pos/pos-client.tsx`, hapus blok ini seluruhnya (termasuk komentarnya):

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

Lalu bersihkan yang jadi tidak terpakai:
- Buang `dispatchCustomerReceiptJob` dari impor `@/lib/print-dispatch`.
- `DispatchTarget` kemungkinan tidak lagi dibutuhkan pada tipe `jobs` — kalau `tsc`/lint menandainya tidak terpakai, kembalikan ke `PrintTarget` dan sesuaikan impornya. Kalau masih terpakai, biarkan.
- `cartWithIds` masih dipakai `splitItemsByPrintTarget` — **jangan** dihapus.

Konstruksi job dapur/minuman dan seluruh cabang toast **tidak berubah**.

- [ ] **Step 2: Halaman review**

Di `components/nota-review-form.tsx`, hapus blok ini seluruhnya (termasuk komentarnya):

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

Lalu bersihkan impor `dispatchCustomerReceiptJob`. `DispatchTarget` di tipe `submitJobs` boleh kembali ke `PrintTarget` kalau sudah tidak ada target `'customer'` — ikuti apa kata `tsc`.

⚠️ `wasConfirmedBefore` **masih dipakai** di `buildJob` dan di pemilihan kata toast — jangan ikut dihapus. `itemsForQueue` juga masih dipakai `splitItems`.

- [ ] **Step 3: Verifikasi**

Run: `npm run test && npm run lint && npx tsc --noEmit && npm run build`
Expected: semua bersih/hijau, jumlah test tidak berubah dari Task 3.

Lalu jalankan `grep -rn "dispatchCustomerReceiptJob" components/ lib/` dan konfirmasi pemanggilnya sekarang tinggal dua: `components/monitor-board.tsx` dan `components/reprint-card.tsx` (plus definisinya di `lib/print-dispatch.ts` dan testnya).

- [ ] **Step 4: Commit**

```bash
git add components/pos/pos-client.tsx components/nota-review-form.tsx
git commit -m "refactor(print): cabut cetak nota otomatis saat simpan, pindah ke tombol Lunas"
```

---

## Task 5: Dokumentasi

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-07-takeaway-auto-customer-receipt-design.md`
- Modify: `docs/tasks.md`

⚠️ Ini bukan formalitas. `CLAUDE.md` adalah rujukan yang dibaca lebih dulu di sesi berikutnya. Kalau masih menyatakan "nota tercetak saat pertama kali confirmed", pekerjaan berikutnya akan membatalkan perubahan ini tanpa sengaja.

- [ ] **Step 1: Tulis ulang bullet di `CLAUDE.md`**

Di bagian `## Print system`, ganti **seluruh** bullet yang sekarang diawali `**Nota customer otomatis untuk bungkus (2026-08-07)**` dengan:

```markdown
- **Nota customer dicetak saat ditandai lunas (2026-08-08)**: saat simpan (`/pos` maupun review) **cuma tiket dapur/minuman** yang keluar — untuk semua jenis pesanan. Nota customer keluar dari tombol Lunas di `/monitor`, yang punya dua aksi: "Lunas saja" dan "Lunas + nota". Alurnya: `PATCH {paid:true}` dulu → kalau gagal berhenti (ga cetak) → `GET /api/transactions/[id]` buat ambil item lengkap (kartu monitor ga bawa item) → `dispatchCustomerReceiptJob`. Tombol yang disorot ikut jenis pesanan (bungkus → "Lunas + nota", dine-in → "Lunas saja"), tapi keduanya selalu tersedia. Penjaga ketuk ganda pakai `useRef<Set<string>>` — tanpa itu dua ketukan cepat bikin dua nota. `dispatchCustomerReceiptJob` **selalu** kirim `item_ids: null`; trigger `mark_items_printed_history` cuma nyala kalau item_ids terisi, jadi kalau diisi, item ketandai sudah tercetak ke dapur & tombol "Cetak tambahan" mati padahal dapur belum nerima. Tanpa migrasi. Spec `docs/superpowers/specs/2026-08-08-monitor-takeaway-and-receipt-on-paid-design.md`.
```

- [ ] **Step 2: Perbarui bagian Monitor di `CLAUDE.md`**

Di bagian `## Monitor meja belum bayar`, bullet **Filter monitor** sekarang menyebut `is_takeaway=false`. Ganti klausa itu supaya menyatakan bungkus **ikut** tampil sejak 2026-08-08, dengan badge BUNGKUS di kartu, dan alasannya (kasir butuh papan buat menandai lunas pesanan bungkus juga). Jangan mengubah bagian lain dari bullet itu.

- [ ] **Step 3: Tandai spec lama sebagai digantikan**

Di `docs/superpowers/specs/2026-08-07-takeaway-auto-customer-receipt-design.md`, ganti baris Status jadi:

```
**Status:** Sebagian digantikan 2026-08-08 — aturan "cetak saat pertama kali confirmed" dicabut, diganti "cetak saat ditandai lunas" di `docs/superpowers/specs/2026-08-08-monitor-takeaway-and-receipt-on-paid-design.md`. Helper `dispatchCustomerReceiptJob` dan perbaikan `applied_chips` di kartu cetak ulang tetap berlaku.
```

- [ ] **Step 4: `docs/tasks.md`**

Baca file itu dulu dan ikuti format entri terakhir. Tambahkan entri untuk plan ini, status **implemented, menunggu verifikasi manual dengan printer sungguhan**. Sebutkan bahwa perilaku dialognya sudah ditutup test komponen, jadi yang tersisa untuk manusia adalah kertas yang benar-benar keluar dari printer.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/tasks.md docs/superpowers/specs/2026-08-07-takeaway-auto-customer-receipt-design.md docs/superpowers/plans/2026-08-08-monitor-takeaway-and-receipt-on-paid.md docs/superpowers/specs/2026-08-08-monitor-takeaway-and-receipt-on-paid-design.md
git commit -m "docs: catat bungkus di monitor + nota saat ditandai lunas"
```

---

## Verifikasi manual (butuh printer sungguhan)

Perilaku dialog sudah ditutup test komponen di Task 3. Yang tersisa hanya hal yang tidak bisa dibuktikan tanpa kertas.

1. `/pos` → pesanan **bungkus** → Simpan. Keluar **hanya** tiket dapur. Tidak ada nota customer.
2. Kartunya muncul di `/monitor` dengan badge **BUNGKUS**.
3. Tekan Lunas → **Lunas + nota** → nota customer keluar, kartu hilang dari papan.
4. Pesanan dine-in → Lunas → **Lunas saja** → kartu hilang, **tidak ada** kertas keluar.
5. Matikan agent printer, ulangi langkah 3 → kartu tetap hilang, muncul peringatan kuning.
6. Tombol **+ Item** di kartu bungkus berfungsi sama seperti di kartu dine-in.
7. Nota di langkah 3 isinya sama dengan hasil tombol "🧾 Cetak nota customer" di halaman detail.
8. Di HP ~390px, tiga tombol di dialog Lunas menumpuk vertikal dan semuanya terbaca.

## Catatan implementasi

**Task 3 adalah yang paling rawan.** Ia mengubah `markPaid`, satu-satunya jalur yang menandai transaksi lunas. Urutannya sengaja: tandai dulu, cetak belakangan, dan kegagalan cetak **tidak pernah** me-rollback status. Kebalikannya lebih buruk — nota sudah di tangan pelanggan tapi transaksi masih tercatat belum bayar, dan kartunya kembali muncul di papan.

**Jangan menyentuh mekanisme penutupan dialog.** `AlertDialogAction` di fork ini bukan `Close`; yang menutup dialog adalah hilangnya baris secara optimistic yang meng-unmount seluruh kartu. Menambahkan state `open` manual akan bentrok dengan itu.
