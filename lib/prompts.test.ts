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

  it('mentions confidence as an optional per-item field', () => {
    expect(OCR_SYSTEM_PROMPT.toLowerCase()).toContain('confidence');
  });

  it('mentions alternatives as an optional per-item field', () => {
    expect(OCR_SYSTEM_PROMPT.toLowerCase()).toContain('alternatives');
  });

  it('instructs AI that handwritten_total is in thousands', () => {
    expect(OCR_SYSTEM_PROMPT.toLowerCase()).toContain('ribuan');
  });

  it('instructs AI to keep raw notes when uncertain', () => {
    expect(OCR_SYSTEM_PROMPT.toLowerCase()).toContain('mentah');
  });

  it('prioritizes not missing items over per-item certainty', () => {
    expect(OCR_SYSTEM_PROMPT.toLowerCase()).toContain('miss');
  });

  it('stays under ~1800 char (token budget guardrail)', () => {
    // Baseline 2026-06-30: prompt ~2400 char → ~600 tokens.
    // Target post-trim: <1800 char → ~300-400 tokens.
    expect(OCR_SYSTEM_PROMPT.length).toBeLessThan(1800);
  });
});

describe('buildMenuRefText', () => {
  it('lists menu names only (no category, no price)', () => {
    const text = buildMenuRefText(sampleMenus);
    expect(text).toContain('Pecel Lele');
    expect(text).toContain('Es Teh');
    // Token-saver: jangan kirim metadata yang tidak dipakai Gemini
    expect(text).not.toMatch(/makanan|minuman/);
    expect(text).not.toMatch(/Rp|16000|6000/);
  });
  it('returns a string even for empty menu list', () => {
    expect(typeof buildMenuRefText([])).toBe('string');
  });
});

describe('buildScanSchema', () => {
  it('accepts valid Gemini-like response with confidence + alternatives', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [
        { menu_name: 'Pecel Lele', qty: 3, notes: null, confidence: 95, alternatives: [] },
        { menu_name: 'Es Teh', qty: 2, notes: 'dingin', confidence: 60, alternatives: [
          { menu_name: 'Pecel Lele', confidence: 30 },
        ] },
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
      items: [{ menu_name: 'Burger', qty: 1, notes: null, confidence: 90, alternatives: [] }],
      handwritten_total: 50000,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects qty < 1', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [{ menu_name: 'Pecel Lele', qty: 0, notes: null, confidence: 90, alternatives: [] }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence out of 0-100 range', () => {
    const schema = buildScanSchema(sampleMenus);
    expect(schema.safeParse({
      items: [{ menu_name: 'Pecel Lele', qty: 1, notes: null, confidence: 150, alternatives: [] }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    }).success).toBe(false);
    expect(schema.safeParse({
      items: [{ menu_name: 'Pecel Lele', qty: 1, notes: null, confidence: -1, alternatives: [] }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    }).success).toBe(false);
  });

  it('rejects more than 2 alternatives', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [{
        menu_name: 'Pecel Lele',
        qty: 1,
        notes: null,
        confidence: 50,
        alternatives: [
          { menu_name: 'Es Teh', confidence: 30 },
          { menu_name: 'Es Teh', confidence: 20 },
          { menu_name: 'Es Teh', confidence: 10 },
        ],
      }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(false);
  });

  it('accepts item without confidence or alternatives (both optional)', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [{ menu_name: 'Pecel Lele', qty: 1, notes: null }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts alternative without confidence (Gemini sometimes omits it)', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [{
        menu_name: 'Pecel Lele',
        qty: 1,
        notes: null,
        confidence: 85,
        alternatives: [{ menu_name: 'Es Teh' }],
      }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts string-shaped alternatives (some Gemini versions return shorthand)', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [{
        menu_name: 'Pecel Lele',
        qty: 1,
        notes: null,
        confidence: 60,
        alternatives: ['Es Teh'],
      }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].alternatives?.[0]).toEqual({ menu_name: 'Es Teh' });
    }
  });

  it('rejects string alternative with menu_name not in master list', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [{
        menu_name: 'Pecel Lele',
        qty: 1,
        notes: null,
        confidence: 60,
        alternatives: ['Burger'],
      }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects alternative with menu_name not in master list', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      items: [{
        menu_name: 'Pecel Lele',
        qty: 1,
        notes: null,
        confidence: 50,
        alternatives: [{ menu_name: 'Burger', confidence: 30 }],
      }],
      handwritten_total: 0,
      customer_name: null,
      table_no: null,
    });
    expect(result.success).toBe(false);
  });

  it('handles empty menu list', () => {
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
