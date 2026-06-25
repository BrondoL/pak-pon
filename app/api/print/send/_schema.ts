import { z } from 'zod';

export const PrintSendSchema = z.object({
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
  item_ids: z.array(z.string().uuid()).nullable(),
  bytes_b64: z.string().min(1),
}).strict();

export type PrintSendInput = z.infer<typeof PrintSendSchema>;
