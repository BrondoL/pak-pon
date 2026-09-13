import { z } from 'zod';

const displayName = z.string().trim().min(1).max(60);
const password = z.string().min(8).max(72);

export const CreateUserSchema = z.object({
  email: z.string().email().max(160),
  password,
  display_name: displayName,
  // guid() bukan uuid(): uuid() zod v4 strict soal nibble varian RFC4122, menolak
  // UUID fixture test (mis. '1111...') yang dipakai luas di test suite ini.
  role_id: z.string().guid().nullable().default(null),
  is_superadmin: z.boolean().default(false),
});

export const UpdateUserSchema = z
  .object({
    display_name: displayName.optional(),
    role_id: z.string().guid().nullable().optional(),
    is_active: z.boolean().optional(),
    is_superadmin: z.boolean().optional(),
    password: password.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'body kosong' });

export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
