import { describe, it, expect } from 'vitest';
import { PrintQueueInsertSchema } from './_schema';

describe('PrintQueueInsertSchema', () => {
  const valid = {
    tx_id: '11111111-1111-4111-8111-111111111111',
    target: 'dapur' as const,
    trigger: 'auto' as const,
    item_ids: ['22222222-2222-4222-8222-222222222222'],
    bytes_b64: 'G0BISQ==',
  };

  it('accepts valid payload with item_ids', () => {
    expect(PrintQueueInsertSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts null tx_id (test print)', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, tx_id: null }).success).toBe(true);
  });

  it('accepts null item_ids (customer or test)', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, item_ids: null }).success).toBe(true);
  });

  it('accepts empty item_ids array', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, item_ids: [] }).success).toBe(true);
  });

  it('accepts target=customer', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, target: 'customer', item_ids: null }).success).toBe(true);
  });

  it('accepts trigger=auto_additional', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, trigger: 'auto_additional' }).success).toBe(true);
  });

  it('accepts trigger=reprint_additional', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, trigger: 'reprint_additional' }).success).toBe(true);
  });

  it('accepts trigger=customer', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, trigger: 'customer' }).success).toBe(true);
  });

  it('rejects invalid target', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, target: 'kitchen' }).success).toBe(false);
  });

  it('rejects invalid trigger', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, trigger: 'manual' }).success).toBe(false);
  });

  it('rejects non-uuid in item_ids', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, item_ids: ['not-uuid'] }).success).toBe(false);
  });

  it('rejects empty bytes_b64', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, bytes_b64: '' }).success).toBe(false);
  });

  it('strict — rejects extra unknown fields', () => {
    expect(PrintQueueInsertSchema.safeParse({ ...valid, extra: 'foo' }).success).toBe(false);
  });
});
