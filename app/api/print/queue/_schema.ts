import { z } from 'zod';

export const PrintQueueInsertSchema = z.object({
  // tx_id null untuk test print (trigger='test')
  tx_id: z.string().uuid().nullable(),
  target: z.enum(['dapur', 'minuman', 'customer']),
  trigger: z.enum([
    'auto',
    'auto_additional',
    'reprint',
    'reprint_additional',
    'customer',
    'test',
  ]),
  // item_ids null untuk customer & test (tidak update flag).
  // Empty array dianggap valid untuk kompatibilitas — route handler treat sebagai "no items".
  item_ids: z.array(z.string().uuid()).nullable(),
  bytes_b64: z.string().min(1),
}).strict();

export type PrintQueueInsertInput = z.infer<typeof PrintQueueInsertSchema>;
