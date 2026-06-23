import { describe, it, expect } from 'vitest';
import { PrintLogSchema } from './_schema';

describe('PrintLogSchema', () => {
  const valid = {
    tx_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    daily_seq: 42,
    target: 'dapur',
    trigger: 'auto',
    outcome: 'dispatched',
  };

  it('accepts valid payload', () => {
    const result = PrintLogSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('rejects invalid target', () => {
    const result = PrintLogSchema.safeParse({ ...valid, target: 'bar' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid trigger', () => {
    const result = PrintLogSchema.safeParse({ ...valid, trigger: 'foo' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid outcome', () => {
    const result = PrintLogSchema.safeParse({ ...valid, outcome: 'xyz' });
    expect(result.success).toBe(false);
  });

  it('accepts null daily_seq', () => {
    const result = PrintLogSchema.safeParse({ ...valid, daily_seq: null });
    expect(result.success).toBe(true);
  });

  it('accepts null tx_id (for test prints)', () => {
    const result = PrintLogSchema.safeParse({ ...valid, tx_id: null });
    expect(result.success).toBe(true);
  });

  it('accepts optional failure_note, url_scheme_variant, user_agent', () => {
    const result = PrintLogSchema.safeParse({
      ...valid,
      failure_note: 'kertas habis',
      url_scheme_variant: 'rawbt-intent-v1',
      user_agent: 'Mozilla/5.0',
    });
    expect(result.success).toBe(true);
  });
});
