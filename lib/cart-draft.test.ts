import { describe, it, expect } from 'vitest';
import { needsChipConfig, addOrIncrementDraft, MAX_QTY, type DraftRow } from './cart-draft';

const nasi = { id: 'menu-nasi', name: 'Nasi Putih', category: 'nasi' as const, price: 5000 };
const teh = { id: 'menu-teh', name: 'Es Teh', category: 'minuman' as const, price: 4000 };

function row(over: Partial<DraftRow> & { _localId: string; menu_id: string }): DraftRow {
  return {
    menu_name_snapshot: 'X',
    category: 'makanan',
    unit_price_snapshot: 1000,
    qty: 1,
    notes: null,
    applied_chips: [],
    ...over,
  };
}

describe('needsChipConfig', () => {
  it('is false for a menu with no chips', () => {
    expect(needsChipConfig({ chips: [] })).toBe(false);
  });

  it('is false when every chip is free-choice (mutex_group null)', () => {
    expect(needsChipConfig({ chips: [{ mutex_group: null }, { mutex_group: null }] })).toBe(false);
  });

  it('is true when at least one chip belongs to a mutex group', () => {
    expect(needsChipConfig({ chips: [{ mutex_group: null }, { mutex_group: 'bagian' }] })).toBe(true);
  });
});

describe('addOrIncrementDraft', () => {
  it('appends a new row with qty 1 and the menu base price', () => {
    const result = addOrIncrementDraft([], nasi, 'local-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      _localId: 'local-1',
      menu_id: 'menu-nasi',
      menu_name_snapshot: 'Nasi Putih',
      category: 'nasi',
      unit_price_snapshot: 5000,
      qty: 1,
      notes: null,
      applied_chips: [],
    });
  });

  it('increments qty when the same plain menu is tapped again', () => {
    const first = addOrIncrementDraft([], nasi, 'local-1');
    const second = addOrIncrementDraft(first, nasi, 'local-2');
    expect(second).toHaveLength(1);
    expect(second[0].qty).toBe(2);
    expect(second[0]._localId).toBe('local-1');
  });

  it('does NOT increment a row that already carries chips — appends instead', () => {
    const existing = [
      row({ _localId: 'a', menu_id: 'menu-teh', applied_chips: [{ label: 'Panas', price_delta: 0 }] }),
    ];
    const result = addOrIncrementDraft(existing, teh, 'local-new');
    expect(result).toHaveLength(2);
    expect(result[0].qty).toBe(1);
    expect(result[1]._localId).toBe('local-new');
    expect(result[1].applied_chips).toEqual([]);
  });

  it('does NOT increment a row that already carries notes — appends instead', () => {
    const existing = [row({ _localId: 'a', menu_id: 'menu-teh', notes: 'tanpa es' })];
    const result = addOrIncrementDraft(existing, teh, 'local-new');
    expect(result).toHaveLength(2);
    expect(result[0].notes).toBe('tanpa es');
  });

  it('caps qty at MAX_QTY', () => {
    const existing = [row({ _localId: 'a', menu_id: 'menu-nasi', qty: MAX_QTY })];
    const result = addOrIncrementDraft(existing, nasi, 'local-new');
    expect(result).toHaveLength(1);
    expect(result[0].qty).toBe(MAX_QTY);
  });

  it('leaves other rows untouched and preserves order', () => {
    const existing = [
      row({ _localId: 'a', menu_id: 'menu-teh', qty: 3 }),
      row({ _localId: 'b', menu_id: 'menu-nasi', qty: 1 }),
    ];
    const result = addOrIncrementDraft(existing, nasi, 'local-new');
    expect(result.map((r) => r._localId)).toEqual(['a', 'b']);
    expect(result[0].qty).toBe(3);
    expect(result[1].qty).toBe(2);
  });

  it('does not mutate the input array', () => {
    const existing = [row({ _localId: 'a', menu_id: 'menu-nasi', qty: 1 })];
    addOrIncrementDraft(existing, nasi, 'local-new');
    expect(existing[0].qty).toBe(1);
  });
});
