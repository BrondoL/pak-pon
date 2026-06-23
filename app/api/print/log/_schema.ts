import { z } from 'zod';

export const PrintLogSchema = z.object({
  // tx_id null untuk test print (gak terkait transaksi)
  tx_id: z.string().guid().nullable(),
  daily_seq: z.number().int().nullable(),
  target: z.enum(['dapur', 'minuman']),
  trigger: z.enum(['auto', 'reprint', 'test']),
  outcome: z.enum(['dispatched', 'reported_success', 'reported_failed']),
  failure_note: z.string().optional(),
  url_scheme_variant: z.string().optional(),
  user_agent: z.string().optional(),
}).strict();

export type PrintLogInput = z.infer<typeof PrintLogSchema>;
