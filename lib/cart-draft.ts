// lib/cart-draft.ts
export type AppliedChipRef = { label: string; price_delta: number };

/**
 * Satu baris draft item yang belum tersimpan. Dipindah ke `lib/` dari
 * `components/pos/pos-item-config-modal.tsx` supaya aturan tap di bawah bisa
 * hidup di luar komponen React dan dites langsung.
 */
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

export const MAX_QTY = 99;

/**
 * True kalau menu punya minimal satu chip bergrup mutex — pilihan yang HARUS
 * diputuskan kasir (mis. Ayam goreng: Dada/Paha), bukan opsi tambahan.
 * Menu begini tetap membuka modal konfigurasi saat di-tap; kalau dibiarkan
 * masuk diam-diam, tiket dapur keluar tanpa keterangan bagian.
 */
export function needsChipConfig(menu: { chips: Array<{ mutex_group: string | null }> }): boolean {
  return menu.chips.some((c) => c.mutex_group !== null);
}

/**
 * Aturan tap kartu menu: qty naik pada baris menu yang sama HANYA kalau baris
 * itu belum punya chip maupun catatan. Baris yang sudah dikonfigurasi kasir
 * tidak boleh diam-diam tertimpa — tap menu polos bikin baris baru.
 *
 * `newLocalId` di-inject (bukan crypto.randomUUID() di dalam) supaya fungsinya
 * tetap murni dan hasilnya bisa diperiksa di test.
 */
export function addOrIncrementDraft(
  rows: DraftRow[],
  menu: { id: string; name: string; category: PosCartItemDraft['category']; price: number },
  newLocalId: string,
): DraftRow[] {
  const idx = rows.findIndex(
    (d) => d.menu_id === menu.id && d.applied_chips.length === 0 && d.notes === null,
  );
  if (idx === -1) {
    return [
      ...rows,
      {
        _localId: newLocalId,
        menu_id: menu.id,
        menu_name_snapshot: menu.name,
        category: menu.category,
        unit_price_snapshot: menu.price,
        qty: 1,
        notes: null,
        applied_chips: [],
      },
    ];
  }
  return rows.map((d, i) => (i === idx ? { ...d, qty: Math.min(MAX_QTY, d.qty + 1) } : d));
}
