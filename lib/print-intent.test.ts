import { describe, it, expect } from 'vitest';
import { buildRawBtIntentUrl, splitItemsByTarget, type TransactionItemForPrint } from './print-intent';

describe('buildRawBtIntentUrl', () => {
  const dummyBytes = new Uint8Array([0x1b, 0x40, 0x48, 0x49]); // "HI" with init

  it('builds intent URL with profile name & base64 payload', () => {
    const url = buildRawBtIntentUrl({ profile: 'Dapur', bytes: dummyBytes });
    expect(url).toMatch(/^intent:\/\//);
    expect(url).toContain('scheme=rawbt');
    expect(url).toContain('S.profile=Dapur');
    expect(url).toContain('S.payload=');
    expect(url).toContain('end');
  });

  it('encodes bytes as base64 in payload', () => {
    const url = buildRawBtIntentUrl({ profile: 'Dapur', bytes: dummyBytes });
    // base64 of [0x1b, 0x40, 0x48, 0x49] = "G0BISQ=="
    expect(url).toContain('S.payload=G0BISQ=='); // raw, no url-encoding (see buildRawBtIntentUrl)
  });

  it('different profiles produce different URLs', () => {
    const a = buildRawBtIntentUrl({ profile: 'Dapur', bytes: dummyBytes });
    const b = buildRawBtIntentUrl({ profile: 'Minuman', bytes: dummyBytes });
    expect(a).not.toBe(b);
    expect(b).toContain('S.profile=Minuman');
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
