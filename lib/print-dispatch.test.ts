import { describe, it, expect } from 'vitest';
import { splitItemsByPrintTarget } from './print-dispatch';

describe('splitItemsByPrintTarget', () => {
  it('routes minuman to the drinks printer', () => {
    const result = splitItemsByPrintTarget([{ category: 'minuman' as const, name: 'Es Teh' }]);
    expect(result.minuman).toHaveLength(1);
    expect(result.dapur).toHaveLength(0);
  });

  it('routes makanan and nasi to the kitchen printer', () => {
    const result = splitItemsByPrintTarget([
      { category: 'makanan' as const, name: 'Pecel Lele' },
      { category: 'nasi' as const, name: 'Nasi Putih' },
    ]);
    expect(result.dapur.map((i) => i.name)).toEqual(['Pecel Lele', 'Nasi Putih']);
    expect(result.minuman).toHaveLength(0);
  });

  it('preserves input order within each target', () => {
    const result = splitItemsByPrintTarget([
      { category: 'minuman' as const, name: 'A' },
      { category: 'makanan' as const, name: 'B' },
      { category: 'minuman' as const, name: 'C' },
    ]);
    expect(result.minuman.map((i) => i.name)).toEqual(['A', 'C']);
    expect(result.dapur.map((i) => i.name)).toEqual(['B']);
  });

  it('returns empty buckets for empty input', () => {
    const result = splitItemsByPrintTarget([]);
    expect(result).toEqual({ dapur: [], minuman: [] });
  });
});
