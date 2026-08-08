# Utang Test + Rapikan Kode dari Branch Monitor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menutup empat celah test dan tiga pembersihan kode yang tercatat sebagai utang saat branch monitor di-merge, plus satu migrasi index.

**Architecture:** Tidak ada fitur baru dan tidak ada perubahan perilaku yang dilihat kasir, kecuali satu: `/pos` berhenti memalsukan id saat server mengembalikan baris lebih sedikit dari cart, dan menggantinya dengan peringatan. Sisanya test, refactor setara, konfigurasi lint, dan satu migrasi index.

**Tech Stack:** Next.js 16, React 19, Vitest (jsdom, globals) + `@testing-library/react` + `user-event`, Supabase/Postgres.

**Sumber:** daftar utang di `docs/tasks.md` bagian `### 🧪 Testing` dan `### 🧹 Rapikan kode`, yang berasal dari review akhir empat fitur di branch `feat/monitor-add-item`.

## Global Constraints

- Money = `bigint` rupiah tanpa sen. Display selalu lewat `formatRp()` dari `lib/currency.ts`.
- UI dari `components/ui/`; dilarang `window.confirm`/`alert`/`prompt`; feedback lewat `toast` dari `sonner`.
- Design tokens dari `app/globals.css @theme` — jangan hardcode hex.
- Teks UI & komentar: Bahasa Indonesia informal.
- **Jangan menyentuh `markPaid` di `components/monitor-board.tsx`.** Fungsi itu baru saja lolos review opus dan memegang dua invarian: tandai-lunas-sebelum-cetak, dan gagal-tandai-tidak-mencetak-apa-pun. Task 1 hanya menambah test untuknya.
- **Jangan mengubah urutan `saved = true` di atas `await res.json()`** di `components/monitor-add-item-modal.tsx`. Itu yang mencegah tagihan meja tergandakan.
- Baseline sebelum mulai: **265 test lulus di 22 file.** Harus tetap hijau.
- Perintah: `npm run test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- Knowledge graph di `graphify-out/` — pakai `graphify query "<pertanyaan>"` sebelum eksplorasi luas.
- **Jangan pernah menjalankan `git reset`, `git stash`, atau `git checkout --` pada working tree.** Ada perubahan milik manusia yang belum di-commit di repo ini; perintah-perintah itu pernah menghapusnya. Pakai `git show <rev>:<path>` untuk melihat versi lama.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `components/monitor-board.test.tsx` (modify) | + test pelepasan guard, + dua test cabang hasil cetak |
| `components/pos/pos-client.test.tsx` (create) | Test: simpan bungkus tidak mencetak nota customer |
| `components/reprint-card.test.tsx` (modify) | + test label chip ikut di tiket dapur cetak ulang |
| `components/pos/pos-client.tsx` (modify) | Berhenti memalsukan id print |
| `lib/transactions.ts` (modify) | Pakai `sumChipPriceDeltas` di dua tempat |
| `eslint.config.mjs` (modify) | `ignoreRestSiblings` |
| `supabase/migrations/0038_monitor_unpaid_index_include_takeaway.sql` (create) | Bangun ulang index tanpa klausa bungkus |
| `docs/tasks.md` (modify) | Centang utang yang sudah lunas |

**Tidak diubah:** `components/monitor-board.tsx`, `components/monitor-add-item-modal.tsx`, `lib/print-dispatch.ts`, `lib/menu-chips.ts`, semua route API.

---

## Task 1: Test pelepasan guard + cabang hasil cetak

**Files:**
- Modify: `components/monitor-board.test.tsx`

**Konteks:** file ini sudah punya helper `mockFetch({ patchOk, detailOk, printStatus })` (baris ~42-66) dan enam test. Parameter `printStatus` **sudah ada tapi tidak pernah dipakai** — Task ini yang memakainya.

- [ ] **Step 1: Test pelepasan guard**

Yang belum dijaga bukan guard `inFlight` menyala, tapi guard itu **dilepas**. Di jalur PATCH gagal, barisnya kembali muncul di papan; kalau id-nya bocor di set, tombol Lunas kartu itu mati permanen sampai halaman di-reload — kasir menekan tombol yang tidak melakukan apa-apa di tengah jam ramai.

Test `does not print when marking paid fails` (baris ~203) sudah sampai persis di state itu. Tambahkan test baru **setelahnya**, yang meneruskan ceritanya:

```tsx
  it('releases the in-flight guard after a failed mark, so a retry works', async () => {
    let patchShouldFail = true;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/monitor') {
        return Promise.resolve(new Response(JSON.stringify({ rows: [] }), { status: 200 }));
      }
      if (url.startsWith('/api/transactions/') && init?.method === 'PATCH') {
        const status = patchShouldFail ? 500 : 200;
        patchShouldFail = false; // percobaan berikutnya sukses
        return Promise.resolve(new Response(JSON.stringify({}), { status }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow()]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    // Percobaan pertama gagal → baris balik muncul.
    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas saja/i }));
    await waitFor(() => {
      expect(screen.getByText(/meja 5/i)).toBeInTheDocument();
    });

    // Percobaan kedua harus benar-benar mengirim PATCH lagi. Kalau id-nya
    // masih nyangkut di inFlight, klik ini tidak melakukan apa-apa dan
    // jumlah PATCH tetap 1.
    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas saja/i }));

    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(
        (c) => (c[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCalls).toHaveLength(2);
    });
  });
```

- [ ] **Step 2: Dua test cabang hasil cetak**

`monitor-board.tsx` memilih tiga toast berbeda tergantung hasil dispatch. Hanya jalur sukses yang tertutup. Tambahkan:

```tsx
  it('warns about an offline printer agent after a successful mark', async () => {
    const fetchMock = mockFetch({ printStatus: 503 });
    vi.stubGlobal('fetch', fetchMock);
    const warnSpy = vi.spyOn(toast, 'warning');
    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow({ is_takeaway: true })]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas \+ nota/i }));

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/agent printer offline/i),
        expect.anything(),
      );
    });
    // Transaksinya tetap lunas — kartunya tidak balik muncul.
    expect(screen.queryByText(/meja 5/i)).not.toBeInTheDocument();
  });

  it('reports a plain print failure without rolling back the paid mark', async () => {
    const fetchMock = mockFetch({ printStatus: 500 });
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(toast, 'error');
    const user = userEvent.setup();
    render(
      <MonitorBoard initialRows={[mkRow({ is_takeaway: true })]} menus={[]} printerSettings={DEFAULT_PRINTER_SETTINGS} />,
    );

    await user.click(screen.getByRole('button', { name: /^lunas$/i }));
    await user.click(await screen.findByRole('button', { name: /lunas \+ nota/i }));

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/gagal kirim nota customer/i));
    });
    expect(screen.queryByText(/meja 5/i)).not.toBeInTheDocument();
  });
```

Kalau pesan toast di `monitor-board.tsx` ternyata berbeda dari regex di atas, **sesuaikan regexnya ke pesan yang sebenarnya** — jangan mengubah `monitor-board.tsx`.

- [ ] **Step 3: Verifikasi**

Run: `npm run test -- components/monitor-board.test.tsx`
Expected: 9 test lulus (6 lama + 3 baru).

Lalu buktikan test guard-nya tidak palsu: komentari sementara baris `inFlight.current.delete(row.id);` di cabang PATCH gagal di `components/monitor-board.tsx`, jalankan lagi, pastikan test baru **GAGAL**, lalu **kembalikan dengan Edit** (bukan git). Laporkan output kedua kondisi itu.

Run: `npm run test && npm run lint && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add components/monitor-board.test.tsx
git commit -m "test(monitor): pelepasan guard setelah gagal + dua cabang hasil cetak"
```

---

## Task 2: Test — simpan bungkus tidak mencetak nota customer

**Files:**
- Create: `components/pos/pos-client.test.tsx`

**Kenapa ini yang paling berharga:** kelas bug ini sudah **dua kali** muncul di repo — nota customer dipasang di momen simpan, lalu dicabut lagi saat ternyata momen yang benar adalah saat ditandai lunas. Sekarang tidak ada satu pun test yang menjaganya.

**Hambatan teknis yang harus diurus:** `PosClient` memakai `useRouter` dan `useTransition` dari Next. Di jsdom tanpa provider, `useRouter()` melempar. Jadi `next/navigation` harus di-mock.

- [ ] **Step 1: Tulis test**

Buat `components/pos/pos-client.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PosClient } from './pos-client';
import type { MenuOption } from '@/components/nota-item-modal';
import { DEFAULT_PRINTER_SETTINGS } from '@/lib/printer-settings';

// PosClient pakai useRouter; jsdom ga punya router provider.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

const menus: MenuOption[] = [
  { id: 'menu-nasi', name: 'Nasi Putih', category: 'nasi', price: 5000, chips: [] },
];

function mockFetch() {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/pos') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            transaction: {
              id: 'tx-1', daily_seq: 3, created_at: '2026-08-08T05:00:00.000Z',
              customer_name: null, table_no: null, is_takeaway: true,
            },
            items: [{ id: 'item-1' }],
          }),
          { status: 201 },
        ),
      );
    }
    return Promise.resolve(new Response('{}', { status: 201 }));
  });
}

describe('<PosClient /> — cetak saat simpan', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT print a customer receipt when saving a takeaway order', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<PosClient menus={menus} printerSettings={DEFAULT_PRINTER_SETTINGS} />);

    await user.click(screen.getByRole('button', { name: /nasi putih/i }));
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: /simpan & cetak/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/api/pos');
    });

    // Tiket dapur boleh keluar; nota customer TIDAK.
    const printBodies = fetchMock.mock.calls
      .filter((c) => String(c[0]) === '/api/print/send')
      .map((c) => JSON.parse((c[1] as RequestInit).body as string));
    expect(printBodies.some((b) => b.target === 'customer')).toBe(false);
    expect(printBodies.some((b) => b.target === 'dapur')).toBe(true);
  });
});
```

Catatan pemilih: tombol simpan berlabel `✓ Simpan & Cetak {total}`, jadi regex `/simpan & cetak/i` cocok. Switch bungkus punya `id="pos-takeaway"`; kalau `getByRole('switch')` tidak cocok dengan fork base-ui, pakai `getByLabelText(/dibungkus/i)`. **Sesuaikan pemilihnya, jangan melemahkan assertionnya.**

- [ ] **Step 2: Jalankan, pastikan LULUS**

Run: `npm run test -- components/pos/pos-client.test.tsx`

Lalu buktikan tidak palsu: tambahkan sementara di `pos-client.tsx` sebuah dispatch nota customer saat `is_takeaway` (bisa disalin dari riwayat commit 895b83d lewat `git show 895b83d:components/pos/pos-client.tsx`), jalankan lagi, pastikan test **GAGAL**, lalu **kembalikan dengan Edit** (bukan git). Laporkan kedua output.

- [ ] **Step 3: Verifikasi & commit**

Run: `npm run test && npm run lint && npx tsc --noEmit && npm run build`

```bash
git add components/pos/pos-client.test.tsx
git commit -m "test(pos): simpan bungkus ga boleh mencetak nota customer"
```

---

## Task 3: Test — label chip ikut di tiket dapur cetak ulang

**Files:**
- Modify: `components/reprint-card.test.tsx`

**Kenapa:** sebelum 2026-08-08, `reprint-card` menyusun tiket tanpa `applied_chips`, sehingga mencetak ulang tiket Ayam goreng menghilangkan keterangan "Dada"/"Paha" — dapur bisa memasak bagian yang salah. Sudah diperbaiki, tapi tidak ada test yang menguncinya.

File ini sudah punya `mkItem()` yang menerima override dan mock fetch yang mengembalikan 201.

- [ ] **Step 1: Tambah test**

Sisipkan di dalam blok `describe('Cetak ulang (full reprint)')` yang sudah ada:

```tsx
    it('carries chip labels into the kitchen ticket bytes', async () => {
      const fetchMock = mockFetchOk();
      vi.stubGlobal('fetch', fetchMock);
      const items = [
        mkItem({
          menu_name_snapshot: 'Ayam goreng',
          menu_category: 'makanan',
          applied_chips: [{ label: 'Dada', price_delta: 0 }],
        }),
      ];
      render(<ReprintCard transaction={txBase} items={items} printerSettings={DEFAULT_PRINTER_SETTINGS} />);

      await userEvent.click(screen.getByRole('button', { name: /cetak ulang dapur/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
      // bytes_b64 = ESC/POS. Label chip harus muncul sebagai teks di dalamnya.
      const decoded = atob(body.bytes_b64);
      expect(decoded).toContain('Dada');
    });
```

Kalau `vi.stubGlobal` bukan pola yang dipakai file ini (ia mungkin memakai `global.fetch = ...`), **ikuti pola file itu**, jangan memaksakan pola baru.

- [ ] **Step 2: Buktikan tidak palsu**

Jalankan test. Lalu hapus sementara `applied_chips: i.applied_chips,` dari pemetaan item di `submitJob` (`components/reprint-card.tsx`), pastikan test **GAGAL**, kembalikan dengan **Edit**. Laporkan kedua output.

- [ ] **Step 3: Verifikasi & commit**

Run: `npm run test && npm run lint && npx tsc --noEmit`

```bash
git add components/reprint-card.test.tsx
git commit -m "test(print): kunci label chip di tiket dapur cetak ulang"
```

---

## Task 4: `/pos` berhenti memalsukan id print

**Files:**
- Modify: `components/pos/pos-client.tsx`

**Masalah:** baris ~115 berbunyi `id: data.items[idx]?.id ?? crypto.randomUUID()`. Kalau server mengembalikan baris lebih sedikit dari cart, id palsu masuk ke `item_ids`. Trigger `mark_items_printed_history` mencocokkan `id = ANY(item_ids)`, jadi id palsu tidak cocok apa pun — item itu tercetak di kertas tapi tercatat **permanen** sebagai belum tercetak, dan bisa tercetak ulang lagi nanti sebagai `auto_additional`.

Pola yang sama sudah dibereskan di `monitor-add-item-modal.tsx`; ini situs terakhirnya.

- [ ] **Step 1: Ganti fallback dengan pemasangan sejauh yang dikembalikan server**

Ganti blok pembentukan `cartWithIds` dengan:

```tsx
      // Jangan fabrikasi id kalau response lebih pendek dari cart — id palsu
      // tidak match trigger DB (`id = ANY(item_ids)`), jadi itemnya tercetak
      // di kertas tapi tercatat permanen belum tercetak. Pasangkan positional
      // hanya sepanjang baris yang benar-benar dikembalikan server.
      const pairCount = Math.min(data.items.length, cart.length);
      const cartWithIds: Array<DraftRow & { id: string }> = cart
        .slice(0, pairCount)
        .map((it, idx) => ({ ...it, id: data.items[idx].id }));
      if (data.items.length !== cart.length) {
        toast.warning(
          'Jumlah item yang tersimpan tidak sesuai dengan yang dikirim. Cek detail transaksi.',
          { duration: 10000 },
        );
      }
```

Perilaku lain di `handleSave` tidak berubah.

- [ ] **Step 2: Verifikasi**

Run: `npm run test && npm run lint && npx tsc --noEmit && npm run build`
Expected: semua hijau. Test dari Task 2 harus tetap lulus — ia mengirim 1 item dan server mengembalikan 1, jadi `pairCount` = 1.

- [ ] **Step 3: Commit**

```bash
git add components/pos/pos-client.tsx
git commit -m "fix(pos): berhenti memalsukan id print kalau response lebih pendek dari cart"
```

---

## Task 5: Pakai `sumChipPriceDeltas` di dua tempat

**Files:**
- Modify: `lib/transactions.ts`

`lib/menu-chips.ts:82` sudah mengekspor:

```ts
export function sumChipPriceDeltas(chips: AppliedChip[]): number {
  return chips.reduce((sum, c) => sum + c.price_delta, 0);
}
```

Dua tempat di `lib/transactions.ts` menghitung ulang hal yang sama secara manual:
- baris ~116, di dalam `computeReplaceItems`: `const chipDeltaSum = applied_chips.reduce((s, c) => s + c.price_delta, 0);`
- baris ~159, di dalam `buildAppendItemRows`: `const chipDeltaSum = req.applied_chips.reduce((s, c) => s + c.price_delta, 0);`

**Harus disentuh berdua sekaligus** — memperbaiki satu saja justru membuat file itu makin tidak konsisten.

- [ ] **Step 1: Ganti kedua tempat**

Perluas impor di baris pertama `lib/transactions.ts`:

```ts
import { sumChipPriceDeltas, type AppliedChip } from './menu-chips';
```

Lalu ganti kedua baris `reduce` di atas dengan `sumChipPriceDeltas(applied_chips)` dan `sumChipPriceDeltas(req.applied_chips)` masing-masing. Tidak ada perubahan lain.

- [ ] **Step 2: Verifikasi — ini refactor setara, testnya harus lulus tanpa disentuh**

Run: `npm run test -- lib/transactions.test.ts`
Expected: seluruh test lulus **tanpa satu pun test diubah**. `lib/transactions.test.ts` sudah menguji harga dengan chip di kedua fungsi; kalau ada yang gagal, perubahannya tidak setara — laporkan, jangan sesuaikan testnya.

Run: `npm run test && npm run lint && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add lib/transactions.ts
git commit -m "refactor(transactions): pakai sumChipPriceDeltas di dua tempat"
```

---

## Task 6: Migrasi 0038 — bangun ulang index monitor

**Files:**
- Create: `supabase/migrations/0038_monitor_unpaid_index_include_takeaway.sql`

**Masalah:** `supabase/migrations/0036_transactions_paid_at.sql` membuat

```sql
CREATE INDEX idx_transactions_unpaid ON transactions (created_at)
  WHERE status = 'confirmed' AND is_takeaway = false AND paid_at IS NULL AND deleted_at IS NULL;
```

Sejak monitor menampilkan bungkus, `fetchUnpaidRows` tidak lagi mengirim `is_takeaway = false`. Predikat query tidak lagi mengimplikasikan predikat index, jadi Postgres **tidak bisa memakai index ini sama sekali** untuk query monitor. Bukan masalah kecepatan di volume sekarang — query dilayani `idx_transactions_created_at` — tapi index-nya jadi beban mati yang tetap ditulis tiap insert.

- [ ] **Step 1: Tulis migrasi**

Buat `supabase/migrations/0038_monitor_unpaid_index_include_takeaway.sql`:

```sql
-- Monitor menampilkan pesanan bungkus sejak 2026-08-08, jadi fetchUnpaidRows
-- berhenti mengirim `is_takeaway = false`. Predikat index lama masih memuat
-- klausa itu, sehingga predikat query tidak lagi mengimplikasikannya dan
-- Postgres tidak bisa memakai index ini untuk query monitor.
--
-- Bangun ulang tanpa klausa bungkus supaya cocok lagi. Kolom yang di-index
-- tetap created_at: query monitor selalu memfilter rentang satu hari bisnis
-- lalu mengurutkan naik, jadi range scan di index parsial ini mendarat
-- langsung di irisan hari ini.

DROP INDEX IF EXISTS idx_transactions_unpaid;

CREATE INDEX idx_transactions_unpaid ON transactions (created_at)
  WHERE status = 'confirmed' AND paid_at IS NULL AND deleted_at IS NULL;
```

- [ ] **Step 2: JANGAN menerapkannya ke database**

Tulis file-nya saja. Penerapan ke Supabase adalah keputusan manusia dan akan dilakukan terpisah setelah review. Jangan memakai tool MCP Supabase apa pun, jangan `apply_migration`, jangan `execute_sql`.

- [ ] **Step 3: Verifikasi**

Run: `npm run test && npm run lint && npx tsc --noEmit`
Expected: hijau (migrasi tidak memengaruhi apa pun di sisi aplikasi).

Konfirmasi juga penomorannya belum terpakai: `ls supabase/migrations/ | tail -3` harus menunjukkan `0037` sebagai yang tertinggi sebelum file baru Anda.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0038_monitor_unpaid_index_include_takeaway.sql
git commit -m "migrate: bangun ulang idx_transactions_unpaid tanpa klausa bungkus"
```

---

## Task 7: Konfigurasi lint + centang utang

**Files:**
- Modify: `eslint.config.mjs`
- Modify: `docs/tasks.md`

- [ ] **Step 1: `ignoreRestSiblings`**

`components/add-items-modal.tsx` memakai `rows.map(({ _localId, ...rest }) => rest)` untuk membuang identitas internal modal sebelum menyerahkan draft ke parent. Itu idiom yang benar — variabelnya terhapus saat kompilasi, nol ongkos runtime — tapi `no-unused-vars` menandainya. Obatnya di konfigurasi, bukan mengubah bentuk destructuring-nya.

Di `eslint.config.mjs`, tambahkan blok override setelah `globalIgnores([...])`:

```js
  {
    rules: {
      // Rest-destructuring adalah cara idiomatik membuang field (lihat
      // components/add-items-modal.tsx). Variabelnya terhapus saat kompilasi;
      // memaksa bentuk lain cuma bikin kodenya lebih jelek.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { ignoreRestSiblings: true, argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
```

- [ ] **Step 2: Verifikasi peringatannya hilang**

Run: `npm run lint`
Expected: peringatan `_localId` di `components/add-items-modal.tsx` hilang. **Peringatan lama di `app/api/.../route.ts` boleh tetap ada** — itu di luar lingkup task ini; laporkan saja statusnya.

Kalau nama rule-nya ternyata `no-unused-vars` (bukan yang berprefiks `@typescript-eslint/`), sesuaikan — periksa keluaran lint sebelum perubahan untuk melihat rule mana yang sebenarnya menyala.

- [ ] **Step 3: Centang utang di `docs/tasks.md`**

Di bagian `### 🧪 Testing` dan `### 🧹 Rapikan kode`, ubah `- [ ]` jadi `- [x]` untuk item yang plan ini selesaikan:

- Test retry setelah gagal tandai lunas → selesai (Task 1)
- Test simpan bungkus tidak mencetak nota → selesai (Task 2)
- Test label chip di tiket dapur cetak ulang → selesai (Task 3)
- Test cabang printer offline / gagal kirim → selesai (Task 1)
- `pos-client.tsx` memalsukan UUID → selesai (Task 4)
- `sumChipPriceDeltas` → selesai (Task 5)
- Peringatan lint `_localId` → selesai (Task 7)
- Rebuild `idx_transactions_unpaid` → **jangan dicentang penuh**; ubah jadi `- [x]` dengan catatan bahwa migrasinya sudah ditulis (`0038`) tapi **belum diterapkan ke database produksi**, dan itu menunggu keputusan manusia.

Item **Component test harness untuk `MonitorAddItemModal.handleConfirm`** yang ada di bagian Testing **tetap `- [ ]`** — plan ini tidak menyentuhnya.

- [ ] **Step 4: Verifikasi & commit**

Run: `npm run test && npm run lint && npx tsc --noEmit && npm run build`

```bash
git add eslint.config.mjs docs/tasks.md
git commit -m "chore: ignoreRestSiblings di eslint + centang utang yang lunas"
```

---

## Verifikasi manual (kecil)

Hampir semuanya tertutup test otomatis. Yang tersisa satu, karena Task 4 mengubah perilaku:

1. `/pos`: buat pesanan biasa → Simpan. Harus tersimpan dan tiket dapur keluar seperti biasa, tanpa peringatan kuning apa pun. (Peringatan itu hanya muncul kalau server mengembalikan item lebih sedikit dari cart, yang seharusnya tidak pernah terjadi.)

Migrasi 0038 **tidak diterapkan** oleh plan ini. Menerapkannya adalah langkah terpisah setelah review.

## Catatan implementasi

**Task 1, 2, dan 3 masing-masing meminta pembuktian bahwa testnya tidak palsu** — matikan sementara kode yang dijaga, pastikan test gagal, lalu kembalikan **dengan Edit, bukan git**. Test yang lulus karena alasan yang salah lebih buruk daripada tidak ada test, dan tiga test di plan ini semuanya berbentuk "pastikan sesuatu TIDAK terjadi", yang paling mudah lulus secara palsu.

**Jangan menyentuh `markPaid`.** Task 1 hanya menambah test untuknya. Fungsi itu memegang invarian yang mencegah nota tercetak untuk transaksi yang gagal ditandai lunas.
