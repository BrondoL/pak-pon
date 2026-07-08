import { describe, it, expect } from 'vitest';
import { CreateMenuSchema, UpdateMenuSchema, ChipInputSchema } from './_schemas';

describe('CreateMenuSchema', () => {
  it('accepts valid payload', () => {
    const result = CreateMenuSchema.safeParse({
      name: 'Pecel Lele',
      category: 'makanan',
      price: 16000,
    });
    expect(result.success).toBe(true);
  });
  it('defaults sort_order to 0', () => {
    const result = CreateMenuSchema.parse({
      name: 'X',
      category: 'makanan',
      price: 1000,
    });
    expect(result.sort_order).toBe(0);
  });
  it('rejects invalid category', () => {
    const result = CreateMenuSchema.safeParse({
      name: 'X',
      category: 'dessert',
      price: 1000,
    });
    expect(result.success).toBe(false);
  });
  it('rejects negative price', () => {
    const result = CreateMenuSchema.safeParse({
      name: 'X',
      category: 'makanan',
      price: -1,
    });
    expect(result.success).toBe(false);
  });
  it('rejects empty name', () => {
    const result = CreateMenuSchema.safeParse({
      name: '',
      category: 'makanan',
      price: 100,
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateMenuSchema', () => {
  it('accepts partial update', () => {
    const result = UpdateMenuSchema.safeParse({ price: 20000 });
    expect(result.success).toBe(true);
  });
  it('accepts is_active toggle', () => {
    const result = UpdateMenuSchema.safeParse({ is_active: false });
    expect(result.success).toBe(true);
  });
  it('rejects unknown field', () => {
    const result = UpdateMenuSchema.safeParse({ foo: 'bar' });
    expect(result.success).toBe(false);
  });
});

describe('ChipInputSchema', () => {
  it('accepts valid chip', () => {
    const result = ChipInputSchema.safeParse({
      label: 'Dada',
      price_delta: 3000,
      mutex_group: 'bagian',
      sort_order: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts null mutex_group', () => {
    const result = ChipInputSchema.safeParse({
      label: 'Extra pedas',
      price_delta: 2000,
      mutex_group: null,
      sort_order: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional id for existing chip', () => {
    const result = ChipInputSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      label: 'Dada',
      price_delta: 0,
      mutex_group: null,
      sort_order: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative price_delta', () => {
    const result = ChipInputSchema.safeParse({
      label: 'Diskon',
      price_delta: -500,
      mutex_group: null,
      sort_order: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty label', () => {
    const result = ChipInputSchema.safeParse({
      label: '',
      price_delta: 0,
      mutex_group: null,
      sort_order: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects label >40 chars', () => {
    const result = ChipInputSchema.safeParse({
      label: 'x'.repeat(41),
      price_delta: 0,
      mutex_group: null,
      sort_order: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects mutex_group >20 chars', () => {
    const result = ChipInputSchema.safeParse({
      label: 'A',
      price_delta: 0,
      mutex_group: 'x'.repeat(21),
      sort_order: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('CreateMenuSchema with chips', () => {
  it('accepts menu with chips array', () => {
    const result = CreateMenuSchema.safeParse({
      name: 'Ayam Goreng',
      category: 'makanan',
      price: 22000,
      sort_order: 0,
      chips: [
        { label: 'Dada', price_delta: 0, mutex_group: 'bagian', sort_order: 0 },
        { label: 'Paha', price_delta: 0, mutex_group: 'bagian', sort_order: 1 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts menu without chips (defaults to empty array)', () => {
    const result = CreateMenuSchema.safeParse({
      name: 'Ayam Goreng',
      category: 'makanan',
      price: 22000,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.chips).toEqual([]);
  });

  it('rejects duplicate chip label (case-insensitive)', () => {
    const result = CreateMenuSchema.safeParse({
      name: 'Ayam Goreng',
      category: 'makanan',
      price: 22000,
      chips: [
        { label: 'Dada', price_delta: 0, mutex_group: null, sort_order: 0 },
        { label: 'dada', price_delta: 0, mutex_group: null, sort_order: 1 },
      ],
    });
    expect(result.success).toBe(false);
  });
});
