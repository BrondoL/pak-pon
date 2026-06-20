import { z } from 'zod';

export const CategorySchema = z.enum(['makanan', 'nasi', 'minuman']);

export const CreateMenuSchema = z.object({
  name: z.string().min(1).max(80),
  category: CategorySchema,
  price: z.number().int().nonnegative(),
  sort_order: z.number().int().default(0),
});

export const UpdateMenuSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  category: CategorySchema.optional(),
  price: z.number().int().nonnegative().optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
}).strict();

export type CreateMenu = z.infer<typeof CreateMenuSchema>;
export type UpdateMenu = z.infer<typeof UpdateMenuSchema>;
