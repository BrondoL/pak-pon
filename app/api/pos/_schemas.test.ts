import { describe, expect, it } from 'vitest';
import { CreatePosTransactionSchema } from './_schemas';

describe('CreatePosTransactionSchema', () => {
  const validPayload = {
    customer_name: null,
    table_no: '5',
    is_takeaway: false,
    items: [{
      menu_id: '11111111-1111-4111-8111-111111111111',
      qty: 2,
      chip_labels: ['Dada'],
      notes: null,
      sort_order: 0,
    }],
  };

  it('accepts valid payload', () => {
    expect(CreatePosTransactionSchema.safeParse(validPayload).success).toBe(true);
  });

  it('accepts empty chip_labels', () => {
    const p = { ...validPayload, items: [{ ...validPayload.items[0], chip_labels: [] }] };
    expect(CreatePosTransactionSchema.safeParse(p).success).toBe(true);
  });

  it('rejects empty items array', () => {
    expect(CreatePosTransactionSchema.safeParse({ ...validPayload, items: [] }).success).toBe(false);
  });

  it('rejects qty < 1', () => {
    const p = { ...validPayload, items: [{ ...validPayload.items[0], qty: 0 }] };
    expect(CreatePosTransactionSchema.safeParse(p).success).toBe(false);
  });

  it('rejects invalid menu_id (not uuid)', () => {
    const p = { ...validPayload, items: [{ ...validPayload.items[0], menu_id: 'not-uuid' }] };
    expect(CreatePosTransactionSchema.safeParse(p).success).toBe(false);
  });
});
