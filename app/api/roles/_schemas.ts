import { z } from 'zod';
import { isPermissionKey, type PermissionKey } from '@/lib/permissions';

export const RoleWriteSchema = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(160).nullable().default(null),
  permissions: z
    .array(z.string().refine(isPermissionKey, { message: 'kunci izin tidak dikenal' }))
    .max(50)
    // Zod memvalidasi tiap elemen; sisa kerjanya cuma membuang duplikat supaya
    // INSERT tidak bentrok dengan PK (role_id, permission_key).
    .transform((keys) => Array.from(new Set(keys)) as PermissionKey[]),
});

export type RoleWrite = z.infer<typeof RoleWriteSchema>;
