# Umpan Balik Tap di Kartu Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kartu menu menyala sesaat setelah item benar-benar masuk daftar, supaya kasir di HP tahu tap-nya berhasil tanpa perlu scroll ke keranjang.

**Architecture:** `PosMenuPicker` (dipakai bersama `/pos` dan `AddItemsModal`) menerima nilai balik `boolean` dari `onMenuTap` — `true` berarti baris mendarat, `false` berarti parent membuka modal konfigurasi. Saat `true`, picker menempelkan kelas `.tap-flash` ke kartu itu selama 400ms. Kilatan dipasang sebagai kelas yang di-toggle React, bukan `@keyframes`, karena aturan `prefers-reduced-motion` di `globals.css` menghapus animasi apa pun.

**Tech Stack:** Next.js 16, React, Tailwind v4 (`@theme` di `app/globals.css`), Vitest + Testing Library + `@testing-library/user-event`, jsdom.

**Spec:** `docs/superpowers/specs/2026-08-08-tap-feedback-menu-picker-design.md`

## Global Constraints

- Styling lewat token di `app/globals.css` `@theme` — jangan hardcode warna. Kilatan memakai `var(--color-mustard-faint)`.
- Kilatan **tidak boleh** memakai `@keyframes`: `app/globals.css:169-172` memasang `animation-duration: 0.01ms !important` untuk `prefers-reduced-motion`, yang akan menghapusnya total. Umpan balik ini fungsional, bukan hiasan.
- Kilatan menandakan **hasil**, bukan sentuhan: menu ber-`mutex_group` (produksi: cuma Ayam goreng — Dada/Paha) tidak menyala, karena tap-nya membuka modal dan batal berarti tidak ada baris yang masuk.
- Durasi tahan kilatan: **400ms**. Pudarnya diurus `transition-colors duration-500` milik kartu.
- Tanpa migrasi, tanpa dependensi baru, tanpa perubahan API.
- Test dijalankan dengan `npm run test`; lint dengan `npm run lint`.

## File Structure

| Berkas | Tanggung jawab | Status |
|---|---|---|
| `app/globals.css` | kelas `.tap-flash` (warna + matikan transition saat nyala) | Modify |
| `components/pos/pos-menu-picker.tsx` | tipe `onMenuTap` → `boolean`, state `flashId` + timer, kelas kondisional | Modify |
| `components/pos/pos-client.tsx` | `return false` / `return true` di `onMenuTap` | Modify |
| `components/add-items-modal.tsx` | idem di `handleMenuTap` | Modify |
| `components/pos/pos-menu-picker.test.tsx` | test unit perilaku kilatan | Create |
| `components/pos/pos-client.test.tsx` | test kontrak nilai balik di parent POS | Modify |
| `components/monitor-add-item-modal.test.tsx` | test kontrak nilai balik lewat `AddItemsModal` | Modify |

---

### Task 1: Kilatan di picker + kontrak boolean

Mengubah tipe `onMenuTap` memutus TypeScript di kedua parent (mengembalikan `undefined` di posisi `boolean`). Karena itu picker, CSS, dan kedua parent berubah dalam satu task — kalau dipisah, repo tidak bisa dibuild di antara commit.

**Files:**
- Create: `components/pos/pos-menu-picker.test.tsx`
- Modify: `app/globals.css` (sisipkan setelah blok `.ring-focus`, sebelum `@media (prefers-reduced-motion: reduce)`)
- Modify: `components/pos/pos-menu-picker.tsx`
- Modify: `components/pos/pos-client.tsx:174-184`
- Modify: `components/add-items-modal.tsx:55-62`

**Interfaces:**
- Produces: `PosMenuPicker` dengan prop `onMenuTap: (menu: MenuOption) => boolean`. Kelas CSS `tap-flash` menempel di elemen `<button>` kartu menu saat menyala. Konstanta internal `FLASH_MS = 400`.
- Consumes: `MenuOption` dari `@/components/nota-item-modal`; `needsChipConfig`, `addOrIncrementDraft` dari `@/lib/cart-draft` (sudah ada, tidak berubah).

- [ ] **Step 1: Tulis test yang gagal**

Buat `components/pos/pos-menu-picker.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PosMenuPicker } from './pos-menu-picker';
import type { MenuOption } from '@/components/nota-item-modal';

// Semua kategori "makanan" — tab aktif default picker "makanan", jadi tidak
// perlu ganti tab dulu sebelum menekan kartu.
const menus: MenuOption[] = [
  { id: 'menu-tempe', name: 'Tempe Goreng', category: 'makanan', price: 8000, chips: [] },
  { id: 'menu-tahu', name: 'Tahu Goreng', category: 'makanan', price: 7000, chips: [] },
];

// userEvent punya timer internal; tanpa `advanceTimers` dia menggantung
// selamanya begitu vi.useFakeTimers() aktif.
function setup(onMenuTap: (m: MenuOption) => boolean) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<PosMenuPicker menus={menus} onMenuTap={onMenuTap} />);
  return user;
}

const card = (name: RegExp) => screen.getByRole('button', { name });

describe('<PosMenuPicker /> — kilatan setelah item mendarat', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('menyalakan kartu saat onMenuTap melaporkan baris mendarat', async () => {
    const user = setup(() => true);
    await user.click(card(/tempe goreng/i));
    expect(card(/tempe goreng/i)).toHaveClass('tap-flash');
  });

  it('memadamkan kartu setelah 400ms', async () => {
    const user = setup(() => true);
    await user.click(card(/tempe goreng/i));
    await act(async () => { vi.advanceTimersByTime(400); });
    expect(card(/tempe goreng/i)).not.toHaveClass('tap-flash');
  });

  it('tidak menyalakan kartu saat onMenuTap melaporkan modal yang terbuka', async () => {
    const user = setup(() => false);
    await user.click(card(/tempe goreng/i));
    expect(card(/tempe goreng/i)).not.toHaveClass('tap-flash');
  });

  it('tap kedua me-reset timer, bukan padam di jadwal tap pertama', async () => {
    const user = setup(() => true);
    await user.click(card(/tempe goreng/i));
    await act(async () => { vi.advanceTimersByTime(300); });
    await user.click(card(/tempe goreng/i));
    // 300ms setelah tap kedua = 600ms setelah tap pertama. Kalau timernya tidak
    // di-reset, jadwal tap pertama (400ms) sudah memadamkannya di sini.
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(card(/tempe goreng/i)).toHaveClass('tap-flash');
  });

  it('cuma satu kartu menyala pada satu waktu', async () => {
    const user = setup(() => true);
    await user.click(card(/tempe goreng/i));
    await user.click(card(/tahu goreng/i));
    expect(card(/tempe goreng/i)).not.toHaveClass('tap-flash');
    expect(card(/tahu goreng/i)).toHaveClass('tap-flash');
  });

  it('membersihkan timer saat unmount', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(<PosMenuPicker menus={menus} onMenuTap={() => true} />);
    await user.click(card(/tempe goreng/i));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `npm run test -- components/pos/pos-menu-picker.test.tsx`

Expected: gagal. TypeScript/test akan protes karena `onMenuTap` sekarang bertipe `(menu: MenuOption) => void` di komponen, dan tidak ada kelas `tap-flash` di mana pun — assertion `toHaveClass('tap-flash')` gagal.

- [ ] **Step 3: Tambah kelas `.tap-flash` di `app/globals.css`**

Sisipkan tepat setelah blok `.ring-focus { … }` (sekitar baris 167), **sebelum** `@media (prefers-reduced-motion: reduce)`:

```css
/* Umpan balik tap di kartu menu — nyala seketika setelah baris mendarat di
   daftar, lalu memudar lewat `transition-colors` milik kartunya.
   Sengaja BUKAN @keyframes: blok prefers-reduced-motion di bawah memangkas
   animation-duration jadi 0.01ms, dan sinyal ini fungsional, bukan hiasan.
   Di bawah reduced-motion warnanya muncul & hilang seketika tanpa memudar —
   itu perilaku yang diinginkan.
   `:hover` ditulis eksplisit supaya `hover:bg-cream` milik kartu tidak menang
   saat kursor kebetulan berada di atasnya. */
.tap-flash,
.tap-flash:hover {
  background-color: var(--color-mustard-faint);
  transition: none;
}
```

- [ ] **Step 4: Implementasi picker**

Di `components/pos/pos-menu-picker.tsx`:

Ganti baris import pertama:

```tsx
import { useState, useMemo, useRef, useEffect } from 'react';
```

Tambahkan konstanta tepat di bawah `CATEGORY_LABEL`:

```tsx
/** Lama kartu menyala setelah baris mendarat. Pudarnya diurus transition kartu. */
const FLASH_MS = 400;
```

Ganti tanda tangan komponen:

```tsx
export function PosMenuPicker({
  menus,
  onMenuTap,
}: {
  menus: MenuOption[];
  /**
   * `true` = baris mendarat di daftar → picker menyalakan kartunya.
   * `false` = parent membuka modal konfigurasi → tanpa kilatan, karena
   * batal di modal berarti tidak ada baris yang ditambahkan.
   */
  onMenuTap: (menu: MenuOption) => boolean;
}) {
```

Tambahkan state + handler tepat setelah `categoryCounts`:

```tsx
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  function handleTap(menu: MenuOption) {
    const landed = onMenuTap(menu);
    if (isSearching) setSearch('');
    if (!landed) return;
    // Tap beruntun cukup me-reset timer — tidak ada animasi yang perlu di-restart.
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashId(menu.id);
    flashTimer.current = setTimeout(() => {
      setFlashId(null);
      flashTimer.current = null;
    }, FLASH_MS);
  }
```

Ganti tombol kartu menu (yang sekarang ada di sekitar baris 70-83):

```tsx
        {visibleMenus.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => handleTap(m)}
            className={[
              'flex h-full w-full flex-col justify-between rounded-lg border border-clay-soft bg-paper-soft p-3 text-left transition-colors duration-500 hover:bg-cream',
              flashId === m.id ? 'tap-flash' : '',
            ].join(' ')}
          >
            <div>
              <div className="font-medium text-coal">{m.name}</div>
              <div className="mt-1 text-xs text-clay">{formatRp(m.price)}</div>
            </div>
            {m.chips.length > 0 && (
              <div className="mt-2 text-[10px] text-mustard">{m.chips.length} pilihan</div>
            )}
          </button>
        ))}
```

- [ ] **Step 5: Kembalikan boolean dari kedua parent**

Di `components/pos/pos-client.tsx`, ganti prop `onMenuTap` (sekitar baris 174-184):

```tsx
          onMenuTap={(m) => {
            setEditingIdx(null);
            // Menu bergrup mutex (mis. Ayam goreng: Dada/Paha) tetap buka modal
            // konfigurasi — bagiannya harus diputuskan, bukan didiamkan. Menu lain
            // langsung masuk cart qty 1, tap lagi qty naik.
            if (needsChipConfig(m)) {
              setPickingMenu(m);
              return false;
            }
            setCart((prev) => addOrIncrementDraft(prev, m, crypto.randomUUID()));
            return true;
          }}
```

Di `components/add-items-modal.tsx`, ganti `handleMenuTap` (sekitar baris 55-62):

```tsx
  function handleMenuTap(menu: MenuOption): boolean {
    if (needsChipConfig(menu)) {
      setEditingLocalId(null);
      setPickingMenu(menu);
      return false;
    }
    setRows((prev) => addOrIncrementDraft(prev, menu, crypto.randomUUID()));
    return true;
  }
```

- [ ] **Step 6: Jalankan test picker, pastikan LULUS**

Run: `npm run test -- components/pos/pos-menu-picker.test.tsx`
Expected: 6 test PASS.

- [ ] **Step 7: Jalankan seluruh suite + lint**

Run: `npm run test`
Expected: seluruh suite hijau — khususnya `pos-client.test.tsx` dan `monitor-add-item-modal.test.tsx` yang menyentuh picker.

Run: `npm run lint`
Expected: bersih.

Kalau ada test lain yang gagal karena `onMenuTap` sekarang wajib mengembalikan `boolean`, perbaiki stub di test tersebut (`() => {}` → `() => true`), jangan longgarkan tipenya kembali.

- [ ] **Step 8: Commit**

```bash
git add app/globals.css components/pos/pos-menu-picker.tsx components/pos/pos-menu-picker.test.tsx components/pos/pos-client.tsx components/add-items-modal.tsx
git commit -m "feat(pos): kilatan kartu menu setelah item mendarat di daftar"
```

---

### Task 2: Kunci kontrak nilai balik di kedua parent

Task 1 menguji picker dengan stub. Task ini memastikan parent yang asli benar-benar melaporkan `true`/`false` sesuai jenis menunya — kalau seseorang nanti menghapus `return true`, test ini yang jatuh.

**Files:**
- Modify: `components/pos/pos-client.test.tsx`
- Modify: `components/monitor-add-item-modal.test.tsx`

**Interfaces:**
- Consumes: kelas `tap-flash` dan prop `onMenuTap: (menu: MenuOption) => boolean` dari Task 1.

Kedua test memakai timer asli (tanpa `vi.useFakeTimers()`) dan hanya memeriksa keadaan **tepat setelah** tap — jadi tidak perlu menunggu 400ms dan tidak berbenturan dengan `userEvent`.

- [ ] **Step 1: Tulis test yang gagal di `pos-client.test.tsx`**

Tambahkan fixture ini di bawah `const menus` yang sudah ada:

```tsx
// Menu bergrup mutex untuk menguji jalur "buka modal, jangan menyala".
// Kategori "makanan" supaya tampil di tab default picker tanpa ganti tab.
const menusWithMutex: MenuOption[] = [
  {
    id: 'menu-ayam',
    name: 'Ayam Goreng',
    category: 'makanan',
    price: 20000,
    chips: [
      { id: 'chip-dada', label: 'Dada', price_delta: 0, mutex_group: 'bagian', sort_order: 0 },
      { id: 'chip-paha', label: 'Paha', price_delta: 0, mutex_group: 'bagian', sort_order: 1 },
    ],
  },
];
```

Tambahkan `describe` baru di akhir berkas:

```tsx
describe('<PosClient /> — umpan balik tap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('menyalakan kartu menu biasa setelah item masuk cart', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    render(<PosClient menus={menus} printerSettings={DEFAULT_PRINTER_SETTINGS} />);

    await user.click(screen.getByRole('button', { name: /nasi/i }));
    const cardEl = screen.getByRole('button', { name: /^nasi putih rp 5\.000$/i });
    await user.click(cardEl);

    expect(cardEl).toHaveClass('tap-flash');
  });

  it('tidak menyalakan kartu bergrup mutex — modal konfigurasi yang terbuka', async () => {
    vi.stubGlobal('fetch', mockFetch());
    const user = userEvent.setup();
    render(<PosClient menus={menusWithMutex} printerSettings={DEFAULT_PRINTER_SETTINGS} />);

    // Elemen kartunya ditangkap SEBELUM modal terbuka. Setelah modal muncul,
    // query ulang /ayam goreng/i bisa ambigu karena judul modal ikut cocok.
    const cardEl = screen.getByRole('button', { name: /ayam goreng/i });
    await user.click(cardEl);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(cardEl).not.toHaveClass('tap-flash');
  });
});
```

- [ ] **Step 2: Tulis test yang gagal di `monitor-add-item-modal.test.tsx`**

Tambahkan fixture di bawah `const menus` yang sudah ada:

```tsx
// Menu bergrup mutex untuk jalur "buka modal konfigurasi, jangan menyala".
const menusWithMutex: MenuOption[] = [
  {
    id: 'menu-ayam-mutex',
    name: 'Ayam Bakar',
    category: 'makanan',
    price: 22000,
    chips: [
      { id: 'chip-dada', label: 'Dada', price_delta: 0, mutex_group: 'bagian', sort_order: 0 },
      { id: 'chip-paha', label: 'Paha', price_delta: 0, mutex_group: 'bagian', sort_order: 1 },
    ],
  },
];
```

Tambahkan `describe` baru di akhir berkas:

```tsx
describe('<MonitorAddItemModal /> — umpan balik tap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('menyalakan kartu menu biasa setelah baris masuk daftar', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menus}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const cardEl = screen.getByRole('button', { name: /ayam goreng/i });
    await user.click(cardEl);

    expect(cardEl).toHaveClass('tap-flash');
  });

  it('tidak menyalakan kartu bergrup mutex', async () => {
    vi.stubGlobal('fetch', mockFetch({}));
    const user = userEvent.setup();
    render(
      <MonitorAddItemModal
        row={mkRow()}
        menus={menusWithMutex}
        printerSettings={DEFAULT_PRINTER_SETTINGS}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    const cardEl = screen.getByRole('button', { name: /ayam bakar/i });
    await user.click(cardEl);

    expect(cardEl).not.toHaveClass('tap-flash');
  });
});
```

- [ ] **Step 3: Jalankan kedua berkas test**

Run: `npm run test -- components/pos/pos-client.test.tsx components/monitor-add-item-modal.test.tsx`
Expected: semua PASS (implementasinya sudah ada dari Task 1 — test ini mengunci perilaku, bukan mendorongnya).

Kalau `findByRole('dialog')` tidak menemukan apa pun, periksa dulu peran yang dipakai `PosItemConfigModal` di `components/ui/dialog.tsx` dan sesuaikan query-nya — jangan hapus assertion-nya.

- [ ] **Step 4: Jalankan seluruh suite + lint**

Run: `npm run test`
Expected: hijau semua.

Run: `npm run lint`
Expected: bersih.

- [ ] **Step 5: Commit**

```bash
git add components/pos/pos-client.test.tsx components/monitor-add-item-modal.test.tsx
git commit -m "test(pos): kunci kontrak nilai balik onMenuTap di kedua parent"
```

---

### Task 3: Verifikasi di browser + tutup spec

Dua risiko di spec bersifat CSS murni dan **tidak bisa** ditangkap test jsdom: jsdom tidak menghitung cascade. Harus dilihat mata.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-tap-feedback-menu-picker-design.md` (baris `**Status:**`)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Jalankan dev server**

Run: `npm run dev`
Buka `http://localhost:3000/pos`.

- [ ] **Step 2: Periksa keempat hal ini**

1. **Kilatan terlihat di HP.** Kecilkan jendela ke lebar ±390px (DevTools device toolbar, iPhone 12 Pro). Tap kartu menu biasa → kartu menyala kuning muda lalu memudar ±1 detik. Ini pemeriksaan utamanya.
2. **`hover:bg-cream` tidak menang.** Di layar lebar (desktop, ada kursor), klik kartu **dan biarkan kursor di atasnya**. Kartu harus tetap menyala `mustard-faint`, bukan langsung jadi `cream`. Kalau kalah, naikkan kekhususan `.tap-flash` — jangan hapus `:hover`-nya.
3. **Kontras cukup.** `--color-mustard-faint` (`#fbf0d6`) di atas `--color-paper-soft` (`#fefdf8`) itu tipis. Kalau di layar HP betulan hampir tidak kelihatan, ganti ke `var(--color-cream)` (`#f5efe0`) di `.tap-flash` lalu jalankan lagi `npm run test`.
4. **Menu bergrup mutex tidak menyala.** Tap Ayam goreng → modal konfigurasi terbuka, kartu di belakangnya tidak menyala. Tekan Batal → tidak ada baris masuk, tidak ada kilatan.

Ulangi butir 1 di `/monitor` (tombol `+ Item` pada kartu) dan di `/transactions/[id]/review` (tambah item) — dua-duanya memakai picker yang sama, jadi harusnya ikut. Kalau salah satu tidak ikut, berarti ada picker lain yang terlewat; cari dengan `grep -rn "PosMenuPicker" components/`.

- [ ] **Step 3: Kalau ada penyesuaian, commit terpisah**

```bash
git add app/globals.css
git commit -m "fix(pos): naikkan kontras kilatan kartu menu"
```

Lewati langkah ini kalau tidak ada yang perlu diubah.

- [ ] **Step 4: Tandai spec sebagai shipped**

Di `docs/superpowers/specs/2026-08-08-tap-feedback-menu-picker-design.md`, ganti baris status:

```markdown
**Status:** Shipped 2026-08-08 — plan: `docs/superpowers/plans/2026-08-08-tap-feedback-menu-picker.md`
```

- [ ] **Step 5: Catat di CLAUDE.md**

Di bagian **POS direct order + per-menu chips**, tambahkan butir di bawah "Tap-to-add seragam (2026-08-07)":

```markdown
- **Umpan balik tap (2026-08-08)**: kartu menu di `PosMenuPicker` menyala `--color-mustard-faint` selama 400ms **setelah baris benar-benar mendarat** di daftar — bukan saat disentuh. `onMenuTap` mengembalikan `boolean` (`false` = parent membuka modal konfigurasi → tanpa kilatan), supaya keputusan "masuk langsung atau buka modal" tetap di satu tempat. Dipasang sebagai kelas `.tap-flash` yang di-toggle React, **bukan `@keyframes`** — blok `prefers-reduced-motion` di `globals.css` memangkas `animation-duration` jadi `0.01ms` dan akan menghapusnya. Satu perubahan menutup `/pos`, `+ Item` di monitor, dan tambah item di review karena picker-nya dipakai bersama. Spec `docs/superpowers/specs/2026-08-08-tap-feedback-menu-picker-design.md`.
```

- [ ] **Step 6: Commit + push**

```bash
git add docs/superpowers/specs/2026-08-08-tap-feedback-menu-picker-design.md CLAUDE.md
git commit -m "docs: tandai umpan balik tap kartu menu sudah shipped"
git push origin master
```

Catatan: commit `0b68c58` (spec) dan `37d7a80` (migrasi `printing_at`) juga belum ter-push — `git push` di sini ikut mengirimnya.

---

## Self-Review

**Cakupan spec:**

| Bagian spec | Task |
|---|---|
| Perilaku kilatan 400ms setelah baris mendarat | Task 1 Step 4 |
| Menu mutex tidak menyala | Task 1 Step 5, Task 2 Step 1-2 |
| Kontrak `onMenuTap → boolean` | Task 1 Step 4-5 |
| State `flashId` + reset timer + cleanup unmount | Task 1 Step 4, diuji Step 1 |
| Kelas CSS bukan `@keyframes` | Task 1 Step 3 |
| `:hover` eksplisit | Task 1 Step 3, diverifikasi Task 3 Step 2.2 |
| Perilaku di bawah `prefers-reduced-motion` | Task 1 Step 3 (komentar), sifatnya konsekuensi cascade |
| Empat berkas yang berubah | Task 1 |
| Test picker (4 skenario spec + 2 tambahan) | Task 1 Step 1 |
| Test kontrak di kedua parent | Task 2 |
| Risiko kontras warna | Task 3 Step 2.3 |

Tidak ada bagian spec tanpa task.

**Placeholder:** tidak ada TBD/TODO; setiap langkah kode berisi kode utuh, bukan "serupa Task N".

**Konsistensi tipe:** `onMenuTap: (menu: MenuOption) => boolean` dipakai identik di picker, `pos-client`, `add-items-modal`, dan seluruh test. Kelas `tap-flash` dieja sama di CSS, komponen, dan enam assertion. `FLASH_MS = 400` cocok dengan `advanceTimersByTime(400)` di test dan angka 400ms di CLAUDE.md.
