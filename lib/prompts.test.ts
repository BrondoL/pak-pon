import { describe, it, expect } from 'vitest';
import { buildScanSchema, buildScanResponseSchema, OCR_SYSTEM_PROMPT, type MenuRef } from './prompts';

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

  it('does not instruct AI to emit alternatives (feature removed 2026-07-03)', () => {
    expect(OCR_SYSTEM_PROMPT.toLowerCase()).not.toContain('alternatives');
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

describe('buildScanSchema', () => {
  it('accepts valid Gemini-like response with confidence (short keys)', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [
        { m: 'Pecel Lele', q: 3, n: null, c: 95 },
        { m: 'Es Teh', q: 2, n: 'dingin', c: 60 },
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
        { m: 'Es Teh', q: 2, n: 'dingin', c: 60 },
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
      expect(result.data.handwritten_total).toBe(60000);
      expect(result.data.customer_name).toBeNull();
      expect(result.data.table_no).toBeNull();
    }
  });

  it('rejects menu_name not in master list', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [{ m: 'Burger', q: 1, n: null, c: 90 }],
      t: 50000,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects qty < 1', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [{ m: 'Pecel Lele', q: 0, n: null, c: 90 }],
      t: 0,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects confidence out of 0-100 range', () => {
    const schema = buildScanSchema(sampleMenus);
    expect(schema.safeParse({
      i: [{ m: 'Pecel Lele', q: 1, n: null, c: 150 }],
      t: 0,
      cn: null,
      tn: null,
    }).success).toBe(false);
    expect(schema.safeParse({
      i: [{ m: 'Pecel Lele', q: 1, n: null, c: -1 }],
      t: 0,
      cn: null,
      tn: null,
    }).success).toBe(false);
  });

  it('accepts item without confidence (optional)', () => {
    const schema = buildScanSchema(sampleMenus);
    const result = schema.safeParse({
      i: [{ m: 'Pecel Lele', q: 1, n: null }],
      t: 0,
      cn: null,
      tn: null,
    });
    expect(result.success).toBe(true);
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

describe('buildScanResponseSchema', () => {
  it('returns OpenAPI 3.0 schema with menu enum constraint', () => {
    const schema = buildScanResponseSchema(sampleMenus);
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(expect.arrayContaining(['i', 't']));
    const props = schema.properties as Record<string, { items?: { properties?: Record<string, { enum?: string[] }>; required?: string[] } }>;
    const itemSchema = props.i.items!;
    expect(itemSchema.properties!.m.enum).toEqual(['Pecel Lele', 'Es Teh']);
    expect(itemSchema.required).toEqual(expect.arrayContaining(['m', 'q']));
  });

  it('marks n / c / cn / tn as optional (not in required)', () => {
    const schema = buildScanResponseSchema(sampleMenus);
    const props = schema.properties as Record<string, { items?: { required?: string[] } }>;
    const itemRequired = props.i.items!.required!;
    expect(itemRequired).not.toContain('n');
    expect(itemRequired).not.toContain('c');
    expect(schema.required).not.toContain('cn');
    expect(schema.required).not.toContain('tn');
  });

  it('does not expose `a` (alternatives) on item schema — feature removed 2026-07-03', () => {
    const schema = buildScanResponseSchema(sampleMenus);
    const props = schema.properties as Record<string, { items?: { properties?: Record<string, unknown> } }>;
    expect(props.i.items!.properties!.a).toBeUndefined();
  });

  it('handles empty menu list (no enum constraint)', () => {
    const schema = buildScanResponseSchema([]);
    const props = schema.properties as Record<string, { items?: { properties?: Record<string, { type?: string; enum?: string[] }> } }>;
    const menuProp = props.i.items!.properties!.m;
    expect(menuProp.enum).toBeUndefined();
    expect(menuProp.type).toBe('string');
  });
});
