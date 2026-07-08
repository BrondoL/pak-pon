import { z } from 'zod';

export const CreatePosTransactionSchema = z.object({
  customer_name: z.string().max(80).nullable().default(null),
  table_no: z.string().max(20).nullable().default(null),
  is_takeaway: z.boolean().default(false),
  items: z.array(
    z.object({
      menu_id: z.string().uuid(),
      qty: z.number().int().positive(),
      chip_labels: z.array(z.string().min(1).max(40)).max(20).default([]),
      notes: z.string().nullable().default(null),
      sort_order: z.number().int().min(0).default(0),
    }),
  ).min(1),
});

export type CreatePosTransaction = z.infer<typeof CreatePosTransactionSchema>;
