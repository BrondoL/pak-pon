import { describe, it, expect } from 'vitest';
import { CreateMenuSchema, UpdateMenuSchema } from './_schemas';

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
