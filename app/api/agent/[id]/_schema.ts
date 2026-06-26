import { z } from 'zod';

// Hanya bisa promote ke primary (set is_primary=true). Demote dilakukan
// implicit via promote agent lain (RPC set_primary_agent clear semua dulu).
// Field literal(true) supaya body { is_primary: false } ke-reject di
// validation, bukan jadi no-op confusing.
export const AgentPatchSchema = z.object({
  is_primary: z.literal(true),
}).strict();

export type AgentPatchInput = z.infer<typeof AgentPatchSchema>;
