import { describe, expect, it } from 'vitest';
import {
  buildAppliedChipsSnapshot,
  validateChipMutex,
  type MenuChip,
  type AppliedChip,
} from './menu-chips';

const chips: MenuChip[] = [
  { id: 'c1', menu_id: 'm1', label: 'Dada', price_delta: 0, mutex_group: 'bagian', sort_order: 0 },
  { id: 'c2', menu_id: 'm1', label: 'Paha', price_delta: 0, mutex_group: 'bagian', sort_order: 1 },
  { id: 'c3', menu_id: 'm1', label: 'Paha atas', price_delta: 3000, mutex_group: 'bagian', sort_order: 2 },
  { id: 'c4', menu_id: 'm1', label: 'Extra pedas', price_delta: 2000, mutex_group: null, sort_order: 3 },
  { id: 'c5', menu_id: 'm1', label: 'Goreng garing', price_delta: 0, mutex_group: null, sort_order: 4 },
];

describe('buildAppliedChipsSnapshot', () => {
  it('snapshots chip labels + price_delta only', () => {
    const result = buildAppliedChipsSnapshot(['Dada', 'Goreng garing'], chips);
    expect(result).toEqual([
      { label: 'Dada', price_delta: 0 },
      { label: 'Goreng garing', price_delta: 0 },
    ]);
  });

  it('preserves client label order', () => {
    const result = buildAppliedChipsSnapshot(['Goreng garing', 'Dada'], chips);
    expect(result[0].label).toBe('Goreng garing');
    expect(result[1].label).toBe('Dada');
  });

  it('throws on unknown label', () => {
    expect(() => buildAppliedChipsSnapshot(['NonExistent'], chips))
      .toThrow(/unknown chip.*NonExistent/i);
  });

  it('returns empty for empty labels', () => {
    expect(buildAppliedChipsSnapshot([], chips)).toEqual([]);
  });

  it('picks non-zero price_delta correctly', () => {
    const result = buildAppliedChipsSnapshot(['Paha atas', 'Extra pedas'], chips);
    expect(result).toEqual([
      { label: 'Paha atas', price_delta: 3000 },
      { label: 'Extra pedas', price_delta: 2000 },
    ]);
  });
});

describe('validateChipMutex', () => {
  it('accepts multiple chips from different mutex groups', () => {
    expect(() => validateChipMutex(['Dada', 'Extra pedas'], chips)).not.toThrow();
  });

  it('accepts multiple mutex_group=null chips', () => {
    expect(() => validateChipMutex(['Extra pedas', 'Goreng garing'], chips)).not.toThrow();
  });

  it('rejects 2 chips from same mutex group', () => {
    expect(() => validateChipMutex(['Dada', 'Paha'], chips))
      .toThrow(/mutex.*bagian.*Dada.*Paha/i);
  });

  it('rejects 3 chips from same mutex group', () => {
    expect(() => validateChipMutex(['Dada', 'Paha', 'Paha atas'], chips))
      .toThrow(/mutex.*bagian/i);
  });

  it('accepts single chip from mutex group', () => {
    expect(() => validateChipMutex(['Dada'], chips)).not.toThrow();
  });
});
