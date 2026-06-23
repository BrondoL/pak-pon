import { z } from 'zod';

export const PrintQueueInsertSchema = z.object({
  // tx_id null untuk test print (trigger='test')
  tx_id: z.string().uuid().nullable(),
  target: z.enum(['dapur', 'minuman']),
  trigger: z.enum(['auto', 'reprint', 'test']),
  bytes_b64: z.string().min(1),
}).strict();

export type PrintQueueInsertInput = z.infer<typeof PrintQueueInsertSchema>;
