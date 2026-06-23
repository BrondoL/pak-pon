import { describe, it, expect } from 'vitest';
import { buildRawBtIntentUrl, splitItemsByTarget, type TransactionItemForPrint } from './print-intent';

describe('buildRawBtIntentUrl', () => {
  const dummyBytes = new Uint8Array([0x1b, 0x40, 0x48, 0x49]); // "HI" with init

  it('builds rawbt: URL with base64 payload', () => {
    const url = buildRawBtIntentUrl({ profile: 'Dapur', bytes: dummyBytes });
    expect(url).toMatch(/^rawbt:base64,/);
  });

  it('encodes bytes as base64 after scheme prefix', () => {
    const url = buildRawBtIntentUrl({ profile: 'Dapur', bytes: dummyBytes });
    // base64 of [0x1b, 0x40, 0x48, 0x49] = "G0BISQ=="
    expect(url).toBe('rawbt:base64,G0BISQ==');
  });

  it('produces identical URLs regardless of profile name (profile not in URL)', () => {
    // RawBT uses default printer set in its own settings; URL cannot pick a profile.
    const a = buildRawBtIntentUrl({ profile: 'Dapur', bytes: dummyBytes });
    const b = buildRawBtIntentUrl({ profile: 'Minuman', bytes: dummyBytes });
    expect(a).toBe(b);
  });
});

describe('splitItemsByTarget', () => {
  const items: TransactionItemForPrint[] = [
    { id: '1', menu_name_snapshot: 'Ayam Goreng', menu_category: 'makanan', qty: 2, notes: null },
    { id: '2', menu_name_snapshot: 'Nasi Putih', menu_category: 'nasi', qty: 1, notes: null },
    { id: '3', menu_name_snapshot: 'Es Teh', menu_category: 'minuman', qty: 1, notes: null },
  ];

  it('routes makanan & nasi to dapur', () => {
    const { dapur } = splitItemsByTarget(items);
    expect(dapur).toHaveLength(2);
    expect(dapur.map((i) => i.menu_category)).toEqual(['makanan', 'nasi']);
  });

  it('routes minuman to minuman', () => {
    const { minuman } = splitItemsByTarget(items);
    expect(minuman).toHaveLength(1);
    expect(minuman[0].menu_category).toBe('minuman');
  });

  it('returns empty array for target without items', () => {
    const { dapur, minuman } = splitItemsByTarget([
      { id: '1', menu_name_snapshot: 'Es Teh', menu_category: 'minuman', qty: 1, notes: null },
    ] satisfies TransactionItemForPrint[]);
    expect(dapur).toEqual([]);
    expect(minuman).toHaveLength(1);
  });
});
