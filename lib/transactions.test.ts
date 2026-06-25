import { describe, it, expect } from 'vitest';
import { computeReplaceItems, type ExistingItem, type RequestedItem, type MenuRef } from './transactions';

const menus: MenuRef[] = [
  { id: 'menu-pecel', name: 'Pecel Lele', price: 16000 },
  { id: 'menu-nasi',  name: 'Nasi',       price: 7000 },
];

const existing: ExistingItem[] = [
  { id: 'item-1', menu_id: 'menu-pecel', unit_price_snapshot: 15000, qty: 2, notes: null,   sort_order: 0, printed_dapur_at: '2026-06-25T01:00:00Z', printed_minuman_at: null },
  { id: 'item-2', menu_id: 'menu-nasi',  unit_price_snapshot: 6500,  qty: 3, notes: 'less', sort_order: 1, printed_dapur_at: null,                     printed_minuman_at: null },
];

describe('computeReplaceItems', () => {
  it('preserves snapshot price for items with matching id', () => {
    const requested: RequestedItem[] = [
      { id: 'item-1', menu_id: 'menu-pecel', qty: 4, notes: null, sort_order: 0 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].unit_price_snapshot).toBe(15000);
    expect(result.rows[0].qty).toBe(4);
    expect(result.rows[0].menu_name_snapshot).toBe('Pecel Lele');
  });

  it('snapshots current menu price for new items (no id)', () => {
    const requested: RequestedItem[] = [
      { menu_id: 'menu-pecel', qty: 1, notes: 'extra sambel', sort_order: 0 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows[0].unit_price_snapshot).toBe(16000);
    expect(result.rows[0].notes).toBe('extra sambel');
  });

  it('omits items whose id was in existing but not in requested (effective delete)', () => {
    const requested: RequestedItem[] = [
      { id: 'item-1', menu_id: 'menu-pecel', qty: 1, notes: null, sort_order: 0 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].menu_id).toBe('menu-pecel');
  });

  it('rejects requested item referencing unknown menu_id', () => {
    const requested: RequestedItem[] = [
      { menu_id: 'menu-nonexistent', qty: 1, notes: null, sort_order: 0 },
    ];
    expect(() => computeReplaceItems({ existing, requested, menus })).toThrow(/unknown menu/i);
  });

  it('handles requested id that does not match any existing — treats as new', () => {
    const requested: RequestedItem[] = [
      { id: 'fake-id', menu_id: 'menu-nasi', qty: 5, notes: null, sort_order: 0 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].unit_price_snapshot).toBe(7000);
  });

  it('returns sort_order from requested', () => {
    const requested: RequestedItem[] = [
      { menu_id: 'menu-pecel', qty: 1, notes: null, sort_order: 5 },
      { menu_id: 'menu-nasi',  qty: 1, notes: null, sort_order: 3 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows[0].sort_order).toBe(5);
    expect(result.rows[1].sort_order).toBe(3);
  });

  it('passes through confidence + alternatives from requested when present', () => {
    const requested: RequestedItem[] = [
      {
        menu_id: 'menu-pecel',
        qty: 1,
        notes: null,
        sort_order: 0,
        confidence: 62,
        alternatives: [{ menu_name: 'Nasi', confidence: 20 }],
      },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows[0].confidence).toBe(62);
    expect(result.rows[0].alternatives).toEqual([{ menu_name: 'Nasi', confidence: 20 }]);
  });

  it('defaults confidence + alternatives to null when not provided', () => {
    const requested: RequestedItem[] = [
      { menu_id: 'menu-pecel', qty: 1, notes: null, sort_order: 0 },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows[0].confidence).toBeNull();
    expect(result.rows[0].alternatives).toBeNull();
  });

  it('passes through explicit null confidence + empty alternatives (user-edited item)', () => {
    const requested: RequestedItem[] = [
      {
        menu_id: 'menu-pecel',
        qty: 1,
        notes: null,
        sort_order: 0,
        confidence: null,
        alternatives: [],
      },
    ];
    const result = computeReplaceItems({ existing, requested, menus });
    expect(result.rows[0].confidence).toBeNull();
    expect(result.rows[0].alternatives).toEqual([]);
  });

  describe('printed_*_at preservation', () => {
    it('preserves id + printed_*_at when matching existing id', () => {
      const requested: RequestedItem[] = [
        { id: 'item-1', menu_id: 'menu-pecel', qty: 3, notes: null, sort_order: 0 },
      ];
      const result = computeReplaceItems({ existing, requested, menus });
      expect(result.rows[0].id).toBe('item-1');
      expect(result.rows[0].printed_dapur_at).toBe('2026-06-25T01:00:00Z');
      expect(result.rows[0].printed_minuman_at).toBeNull();
    });

    it('leaves id undefined and flags null for newly-added items', () => {
      const requested: RequestedItem[] = [
        { menu_id: 'menu-nasi', qty: 1, notes: null, sort_order: 0 },
      ];
      const result = computeReplaceItems({ existing, requested, menus });
      expect(result.rows[0].id).toBeUndefined();
      expect(result.rows[0].printed_dapur_at).toBeNull();
      expect(result.rows[0].printed_minuman_at).toBeNull();
    });

    it('treats unmatched requested id as new (no flag preservation)', () => {
      const requested: RequestedItem[] = [
        { id: 'fake-id', menu_id: 'menu-nasi', qty: 1, notes: null, sort_order: 0 },
      ];
      const result = computeReplaceItems({ existing, requested, menus });
      expect(result.rows[0].id).toBeUndefined();
      expect(result.rows[0].printed_dapur_at).toBeNull();
    });

    it('mixed scenario: preserve flags for kept items, fresh nulls for new ones', () => {
      const requested: RequestedItem[] = [
        { id: 'item-1', menu_id: 'menu-pecel', qty: 2, notes: null, sort_order: 0 },
        { menu_id: 'menu-nasi', qty: 1, notes: 'new', sort_order: 1 },
      ];
      const result = computeReplaceItems({ existing, requested, menus });
      expect(result.rows[0].id).toBe('item-1');
      expect(result.rows[0].printed_dapur_at).toBe('2026-06-25T01:00:00Z');
      expect(result.rows[1].id).toBeUndefined();
      expect(result.rows[1].printed_dapur_at).toBeNull();
    });
  });
});
