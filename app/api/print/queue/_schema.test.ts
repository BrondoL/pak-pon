import { describe, it, expect } from 'vitest';
import { PrintQueueInsertSchema } from './_schema';

describe('PrintQueueInsertSchema', () => {
  const valid = {
    tx_id: '11111111-1111-4111-8111-111111111111',
    target: 'dapur',
    trigger: 'auto',
    bytes_b64: 'G0BISQ==',
  };

  it('accepts valid payload', () => {
    expect(PrintQueueInsertSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts null tx_id (test print)', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, tx_id: null }).success).toBe(true);
  });

  it('rejects invalid target', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, target: 'kitchen' }).success).toBe(false);
  });

  it('rejects invalid trigger', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, trigger: 'manual' }).success).toBe(false);
  });

  it('rejects missing bytes_b64', () => {
    const { bytes_b64: _, ...without } = valid;
    expect(PrintQueueInsertSchema.safeParse(without).success).toBe(false);
  });

  it('rejects empty bytes_b64', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, bytes_b64: '' }).success).toBe(false);
  });

  it('strict — rejects extra unknown fields', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, extra: 'foo' }).success).toBe(false);
  });
});
