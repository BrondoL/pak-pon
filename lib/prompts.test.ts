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
  it('accepts valid Gemini-like response with confidence + alternatives (short keys)', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [
        { m: 'Pecel Lele', q: 3, n: null, c: 95, a: [] },
        { m: 'Es Teh', q: 2, n: 'dingin', c: 60, a: [
          { m: 'Pecel Lele', c: 30 },
        ] },
      ],
      t: 60000,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(true);
  });

  it('transforms short-key input to long-key output', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [
        { m: 'Pecel Lele', q: 3, n: null },
        { m: 'Es Teh', q: 2, n: 'dingin', c: 60, a: [{ m: 'Pecel Lele' }] },
      ],
      t: 60000,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].menu_name).toBe('Pecel Lele');
      expect(result.data.items[0].qty).toBe(3);
      expect(result.data.items[0].notes).toBeNull();
      expect(result.data.items[1].confidence).toBe(60);
      expect(result.data.items[1].alternatives?.[0]).toEqual({ menu_name: 'Pecel Lele', confidence: undefined });
      expect(result.data.handwritten_total).toBe(60000);
      expect(result.data.customer_name).toBeNull();
      expect(result.data.table_no).toBeNull();
    }
  });

  it('rejects menu_name not in master list', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [{ m: 'Burger', q: 1, n: null, c: 90, a: [] }],
      t: 50000,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects qty < 1', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [{ m: 'Pecel Lele', q: 0, n: null, c: 90, a: [] }],
      t: 0,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence out of 0-100 range', () => {
    const schema = buildScanSchema(sampleMenus);
    expect(schema.safeParse({
      i: [{ m: 'Pecel Lele', q: 1, n: null, c: 150, a: [] }],
      t: 0,
      cn: null,
      tn: null,
    }).success).toBe(false);
    expect(schema.safeParse({
      i: [{ m: 'Pecel Lele', q: 1, n: null, c: -1, a: [] }],
      t: 0,
      cn: null,
      tn: null,
    }).success).toBe(false);
  });

  it('rejects more than 2 alternatives', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [{
        m: 'Pecel Lele',
        q: 1,
        n: null,
        c: 50,
        a: [
          { m: 'Es Teh', c: 30 },
          { m: 'Es Teh', c: 20 },
          { m: 'Es Teh', c: 10 },
        ],
      }],
      t: 0,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(false);
  });

  it('accepts item without confidence or alternatives (both optional)', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [{ m: 'Pecel Lele', q: 1, n: null }],
      t: 0,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts alternative without confidence (Gemini sometimes omits it)', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [{
        m: 'Pecel Lele',
        q: 1,
        n: null,
        c: 85,
        a: [{ m: 'Es Teh' }],
      }],
      t: 0,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts string-shaped alternatives (some Gemini versions return shorthand)', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [{
        m: 'Pecel Lele',
        q: 1,
        n: null,
        c: 60,
        a: ['Es Teh'],
      }],
      t: 0,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].alternatives?.[0]).toEqual({ menu_name: 'Es Teh', confidence: undefined });
    }
  });

  it('rejects string alternative with menu_name not in master list', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [{
        m: 'Pecel Lele',
        q: 1,
        n: null,
        c: 60,
        a: ['Burger'],
      }],
      t: 0,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects alternative with menu_name not in master list', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [{
        m: 'Pecel Lele',
        q: 1,
        n: null,
        c: 50,
        a: [{ m: 'Burger', c: 30 }],
      }],
      t: 0,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(false);
  });

  it('handles empty menu list', () => {
    const schema = buildScanSchema([]);
    const result = schema.safeParse({
      i: [],
      t: 0,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts item with omitted n (token-saver: Gemini skip null keys)', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [{ m: 'Pecel Lele', q: 1 }],
      t: 16000,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items[0].notes).toBeNull();
      expect(result.data.customer_name).toBeNull();
      expect(result.data.table_no).toBeNull();
    }
  });

  it('normalizes omitted cn/tn to null in transform output', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [{ m: 'Pecel Lele', q: 1, n: null }],
      t: 0,
      // cn + tn omitted entirely
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customer_name).toBeNull();
      expect(result.data.table_no).toBeNull();
    }
  });
});
