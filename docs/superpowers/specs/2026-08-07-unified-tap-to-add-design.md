# Tap-to-Add Seragam di POS, Review, dan Monitor — Design Spec

**Tanggal:** 2026-08-07
**Status:** Approved (brainstorm), pending implementation plan
**Terkait:** `docs/superpowers/specs/2026-08-07-monitor-add-item-design.md` (fitur monitor yang jadi acuan perilaku)

## Masalah

Tiga halaman bisa menambah item, dengan tiga perilaku berbeda:

| Halaman | Perilaku sekarang | Biaya per item |
|---|---|---|
| `/monitor` | tap kartu menu → langsung masuk daftar qty 1 | 1 tap |
| `/pos` | tap kartu menu → `PosItemConfigModal` (qty + chip + catatan) → "Tambah ke cart" | 3 tap |
| `/transactions/[id]/review` | "+ Tambah item" → `NotaItemModal` → cari menu → Simpan → **ulangi dari tombol** | 4-5 tap |

Yang paling mahal adalah review: `NotaItemModal` menambahkan **satu** item per pembukaan modal, jadi menambah 3 item berarti buka-tutup modal 3 kali.

## Tujuan

Satu perilaku di tiga halaman: tap menu = item masuk daftar, tap lagi = qty naik, chip/catatan diatur belakangan lewat ✏️, simpan sekali di akhir.

## Keputusan kunci

**Menu bergrup pilihan tetap membuka modal chip dulu.** Data produksi hanya punya satu menu berchip: *Ayam goreng*, dengan `mutex_group='bagian'` (Dada / Paha) plus chip bebas "Garing". Dada atau Paha adalah informasi yang dapur butuhkan; kalau kasir lupa menekan ✏️, tiket keluar tanpa keterangan bagian. Jadi aturannya: menu yang punya **minimal satu chip dengan `mutex_group` non-null** membuka `PosItemConfigModal` saat di-tap, seperti sekarang. Menu lain (mayoritas) langsung masuk daftar.

Aturan ini berlaku di **ketiga** halaman, termasuk `/monitor` yang sekarang belum punya pengecualian ini. Tujuannya keseragaman — kalau hanya `/pos` yang dikecualikan, monitor justru jadi satu-satunya yang berbeda.

**Modal tambah tidak menampilkan item yang sudah ada.** Konsisten dengan keputusan di spec monitor: layar HP muat lebih banyak menu, dan modal tidak perlu tahu isi nota.

**Edit item lama tetap lewat `NotaItemModal`.** Di halaman review, ✏️ pada baris nota yang sudah ada membuka modal lama — di situ kasir bisa mengganti menu dan menghapus item, kebutuhan yang berbeda dari sekadar menambah. Hanya jalur "tambah" yang berubah.

## Arsitektur — dua potong bersama, bukan salinan ketiga

UI dan aturan yang sama persis diangkat, bukan disalin. `MonitorAddItemModal` sudah memuat keduanya; menyalinnya ke `/pos` dan review akan membuat tiga salinan aturan tap.

### `lib/cart-draft.ts` (baru) — aturan tap, murni

Tidak mengimpor apa pun dari `components/` (arah impor `lib` → `components` terbalik). Tipe parameter ditulis struktural seperlunya.

```ts
export type AppliedChipRef = { label: string; price_delta: number };

/** Dipindah ke sini dari components/pos/pos-item-config-modal.tsx. */
export type PosCartItemDraft = {
  menu_id: string;
  menu_name_snapshot: string;
  category: 'makanan' | 'nasi' | 'minuman';
  unit_price_snapshot: number;
  qty: number;
  notes: string | null;
  applied_chips: AppliedChipRef[];
};

export type DraftRow = PosCartItemDraft & { _localId: string };

/**
 * True kalau menu punya minimal satu chip bergrup mutex — pilihan yang harus
 * diputuskan kasir (mis. Ayam goreng: Dada/Paha), jadi tap harus membuka
 * modal konfigurasi, bukan langsung masuk daftar.
 */
export function needsChipConfig(menu: { chips: Array<{ mutex_group: string | null }> }): boolean;

/**
 * Aturan tap kartu menu. Menaikkan qty pada baris menu yang sama HANYA kalau
 * baris itu belum punya chip maupun catatan — baris yang sudah dikonfigurasi
 * kasir tidak boleh diam-diam tertimpa, tap menu polos bikin baris baru.
 * Qty dibatasi 99. `newLocalId` di-inject supaya fungsi tetap murni & bisa dites.
 */
export function addOrIncrementDraft(
  rows: DraftRow[],
  menu: { id: string; name: string; category: PosCartItemDraft['category']; price: number },
  newLocalId: string,
): DraftRow[];
```

`components/pos/pos-item-config-modal.tsx` berhenti mendeklarasikan `PosCartItemDraft` dan mengimpornya dari `lib/cart-draft.ts`. Situs impor lain (`pos-client.tsx`, `monitor-add-item-modal.tsx`) ikut diarahkan ke `lib/cart-draft.ts`.

### `components/add-items-modal.tsx` (baru) — cangkang modal

Isi UI-nya diangkat apa adanya dari `MonitorAddItemModal` yang sekarang: `PosMenuPicker` di area scroll, daftar draft + footer menempel di bawah, ✏️ membuka `PosItemConfigModal`, 🗑️ menghapus, stepper qty per baris.

Tap kartu menu di dalam modal ini memakai aturan yang sama seperti `/pos`, dan `needsChipConfig` dicek **di sini juga**, bukan hanya di `/pos`:

```
needsChipConfig(menu) ? buka PosItemConfigModal, hasilnya jadi baris baru
                      : addOrIncrementDraft(rows, menu, crypto.randomUUID())
```

Kalau kasir menutup/membatalkan `PosItemConfigModal` yang terbuka karena tap menu bergrup, **tidak ada baris yang ditambahkan** — batal berarti batal. Ini berbeda dari ✏️ pada baris yang sudah ada, di mana batal berarti baris tetap seperti semula.

**Komponen ini tidak tahu apa-apa soal menyimpan.** Ia memegang state draft dan mengembalikannya lewat `onConfirm`.

```ts
export function AddItemsModal(props: {
  title: string;
  menus: MenuOption[];
  /** Label tombol utama, dihitung dari state draft internal. */
  confirmLabel: (count: number, totalAmount: number) => string;
  /** Parent mengunci tombol selama menyimpan. Modal tetap terbuka. */
  submitting?: boolean;
  onCancel: () => void;
  onConfirm: (drafts: PosCartItemDraft[]) => void;
}): JSX.Element;
```

`confirmLabel` sebagai fungsi karena teksnya bergantung pada state internal: monitor menampilkan `✓ Simpan & Cetak Rp 34.000`, review menampilkan `+ Tambah 3 item`.

Draft state hidup **di dalam** `AddItemsModal`. Selama parent belum melepas komponennya, draft bertahan — inilah yang membuat "gagal simpan → modal tetap terbuka, draft utuh" di monitor tetap berfungsi tanpa parent perlu menyimpan salinan.

### Konsumen

**`MonitorAddItemModal`** menyusut jadi hanya logika simpan + cetak. `handleSave` yang sekarang menjadi `onConfirm`, menerima `drafts` sebagai parameter alih-alih membaca state lokal. Seluruh penanganan error, kunci `submitLock`, bendera `saved`, dan pencocokan draft↔baris via `sort_order` **tidak berubah** — termasuk urutan `saved = true` sebelum `res.json()`.

**`/pos`** tidak memakai modal — grid dan cart sudah menyatu di halaman. Yang berubah hanya `onMenuTap`:

```
needsChipConfig(menu) ? buka PosItemConfigModal (perilaku sekarang)
                      : setCart(addOrIncrementDraft(cart, menu, crypto.randomUUID()))
```

✏️ pada baris cart tetap membuka `PosItemConfigModal` seperti sekarang.

**Review form** (`components/nota-review-form.tsx`): tombol "+ Tambah item" mengganti `setAdding(true)` menjadi membuka `AddItemsModal`. `onConfirm` memetakan tiap draft ke `NotaItem` dan menambahkannya ke state `items`:

```ts
{
  _localId: crypto.randomUUID(),   // id DB tidak diisi → item baru
  menu_id, menu_name_snapshot, unit_price_snapshot, qty, notes, applied_chips,
  sort_order: items.length + idx,
  confidence: null,
}
```

State `adding` dan cabang `adding` pada render `NotaItemModal` dihapus; `editing` tetap.

## Dampak pada cetak & deteksi perubahan

Tidak ada. Item yang ditambah lewat jalur ini tidak punya `id`, jadi `detectModalContext` di review-form tetap menggolongkannya sebagai `newItems`, bukan `modified` — modal "Cetak ulang ke dapur" tidak muncul, dan cetaknya tetap `auto_additional` seperti sekarang. Tidak ada perubahan pada API, `computeReplaceItems`, maupun `dispatchKitchenPrintJob`.

## Testing

`lib/cart-draft.test.ts` (baru) — inilah keuntungan nyata dari ekstraksi ini: aturan tap sekarang hidup di dalam komponen tanpa satu pun test.

- `needsChipConfig`: menu tanpa chip → false; chip semua `mutex_group: null` → false; ada satu chip bergrup → true
- `addOrIncrementDraft`: menu belum ada → baris baru qty 1 dengan `unit_price_snapshot = menu.price` dan `applied_chips: []`
- tap ulang menu polos yang sama → qty jadi 2, jumlah baris tetap
- baris yang sudah punya chip → tap menu sama bikin **baris baru**, baris ber-chip qty-nya tidak berubah
- baris yang punya catatan → sama, bikin baris baru
- qty mentok di 99
- baris lain tidak tersentuh, urutan dipertahankan

Komponen React tidak dites — repo belum punya harness-nya, dan spec ini tidak mengadakannya.

## Verifikasi manual

1. `/pos`: tap Nasi 3× → satu baris qty 3. Tap Ayam goreng → modal chip terbuka (bukan langsung masuk). Pilih Dada → masuk cart. Tap Ayam goreng lagi → modal chip terbuka lagi, pilih Paha → baris kedua terpisah.
2. `/pos`: ✏️ pada baris cart tetap bisa ubah qty/chip/catatan. Simpan & cetak jalan seperti biasa.
3. Review: "+ Tambah item" → tap 3 menu → qty salah satu dinaikkan → "+ Tambah 3 item" → ketiganya masuk daftar nota dengan harga benar, modal tertutup.
4. Review: ✏️ pada baris nota lama tetap membuka modal lama lengkap dengan tombol Hapus dan ganti menu.
5. Review pada transaksi `confirmed`: tambah item → Simpan → tiket dapur hanya berisi item baru, tanpa modal "Cetak ulang".
6. Monitor: tap Ayam goreng sekarang membuka modal chip (perubahan perilaku), menu lain tetap langsung masuk. Sisanya tidak berubah.

## File yang disentuh

| File | Status |
|---|---|
| `lib/cart-draft.ts` | baru — aturan tap + tipe `PosCartItemDraft` |
| `lib/cart-draft.test.ts` | baru |
| `components/add-items-modal.tsx` | baru — cangkang modal, diangkat dari monitor |
| `components/monitor-add-item-modal.tsx` | menyusut jadi simpan + cetak saja |
| `components/pos/pos-client.tsx` | `onMenuTap` pakai aturan baru |
| `components/pos/pos-item-config-modal.tsx` | impor `PosCartItemDraft` dari `lib/cart-draft.ts` |
| `components/nota-review-form.tsx` | "+ Tambah item" pakai `AddItemsModal`, buang state `adding` |
| `components/nota-item-modal.tsx` | tidak diubah — tetap dipakai untuk edit item lama |
| `components/pos/pos-menu-picker.tsx`, `components/chip-picker.tsx` | tidak diubah |

## Non-goals (YAGNI)

- Mengubah `NotaItemModal` atau jalur edit item lama
- Menampilkan item nota yang sudah ada di dalam modal tambah
- Mengubah API, logika cetak, atau deteksi item termodifikasi
- Menambah harness test komponen React
- Mengubah tata letak `/pos` (grid + cart tetap menyatu di halaman, bukan modal)
