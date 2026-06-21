import { describe, it, expect } from 'vitest';
import { buildScanSchema, buildMenuRefText, OCR_SYSTEM_PROMPT, type MenuRef } from './prompts';

const sampleMenus: MenuRef[] = [
  { id: 'a', name: 'Pecel Lele', category: 'makanan', price: 16000 },
  { id: 'b', name: 'Es Teh',     category: 'minuman', price: 6000 },
];

describe('OCR_SYSTEM_PROMPT', () => {
  it('mentions Pak Pon and is in Indonesian', () => {
    expect(OCR_SYSTEM_PROMPT).toContain('Pak Pon');
    expect(OCR_SYSTEM_PROMPT.toLowerCase()).toContain('handwritten');
  });
});

describe('buildMenuRefText', () => {
  it('lists menus with price + category', () => {
    const text = buildMenuRefText(sampleMenus);
    expect(text).toContain('Pecel Lele');
    expect(text).toContain('makanan');
    expect(text).toContain('16000');
    expect(text).toContain('Es Teh');
  });
  it('returns a string even for empty menu list', () => {
    expect(typeof buildMenuRefText([])).toBe('string');
  });
});

describe('buildScanSchema', () => {
  it('accepts valid Gemini-like response', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [
        { menu_name: 'Pecel Lele', qty: 3, notes: null },
        { menu_name: 'Es Teh', qty: 2, notes: 'dingin' },
      ],
      handwritten_total: 60000,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(true);
  });
  it('rejects menu_name not in master list', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [{ menu_name: 'Burger', qty: 1, notes: null }],
      handwritten_total: 50000,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(false);
  });
  it('rejects qty < 1', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [{ menu_name: 'Pecel Lele', qty: 0, notes: null }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(false);
  });
  it('handles empty menu list (no scan possible — schema still valid for empty result)', () => {
    const schema = buildScanSchema([]);
    const result = schema.safeParse({
      items: [],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(true);
  });
});
