import { describe, it, expect } from 'vitest';
import { PrintSendSchema } from './_schema';

describe('PrintSendSchema', () => {
  const valid = {
    tx_id: '11111111-1111-4111-8111-111111111111',
    target: 'dapur' as const,
    trigger: 'auto' as const,
    item_ids: ['22222222-2222-4222-8222-222222222222'],
    bytes_b64: 'G0BISQ==',
  };

  it('accepts valid payload', () => {
    expect(PrintSendSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts null tx_id (test print)', () => {
    expect(PrintSendSchema.safeParse({ ...valid, tx_id: null }).success).toBe(true);
  });

  it('accepts null item_ids (customer or test)', () => {
    expect(PrintSendSchema.safeParse({ ...valid, item_ids: null }).success).toBe(true);
  });

  it('accepts target=customer trigger=customer', () => {
    expect(PrintSendSchema.safeParse({ ...valid, target: 'customer', trigger: 'customer', item_ids: null }).success).toBe(true);
  });

  it('accepts trigger=auto_additional', () => {
    expect(PrintSendSchema.safeParse({ ...valid, trigger: 'auto_additional' }).success).toBe(true);
  });

  it('rejects invalid target', () => {
    expect(PrintSendSchema.safeParse({ ...valid, target: 'kitchen' }).success).toBe(false);
  });

  it('rejects empty bytes_b64', () => {
    expect(PrintSendSchema.safeParse({ ...valid, bytes_b64: '' }).success).toBe(false);
  });

  it('strict — rejects extra fields', () => {
    expect(PrintSendSchema.safeParse({ ...valid, extra: 'foo' }).success).toBe(false);
  });
});
