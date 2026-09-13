import { z } from 'zod';

const displayName = z.string().trim().min(1).max(60);
const password = z.string().min(8).max(72);

export const CreateUserSchema = z.object({
  email: z.string().email().max(160),
  password,
  display_name: displayName,
  // uuid() (bukan guid()): zod v4 uuid() strict soal nibble versi/varian RFC4122 —
  // role_id produksi selalu dari Postgres gen_random_uuid() (v4), jadi ini selalu
  // lolos untuk data nyata. Fixture test HARUS UUID v4 asli (nibble versi '4',
  // nibble varian salah satu 8/9/a/b), bukan string all-1s — kalau tergoda ganti
  // ke guid() lagi karena test gagal, perbaiki fixture-nya, bukan longgarkan cek ini.
  role_id: z.string().uuid().nullable().default(null),
  is_superadmin: z.boolean().default(false),
});

export const UpdateUserSchema = z
  .object({
    display_name: displayName.optional(),
    role_id: z.string().uuid().nullable().optional(),
    is_active: z.boolean().optional(),
    is_superadmin: z.boolean().optional(),
    password: password.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'body kosong' });

export type CreateUser = z.infer<typeof CreateUserSchema>;
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
