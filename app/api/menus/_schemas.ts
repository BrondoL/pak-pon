import { z } from 'zod';

export const CategorySchema = z.enum(['makanan', 'nasi', 'minuman']);

export const ChipInputSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().min(1).max(40),
  price_delta: z.number().int().min(0),
  mutex_group: z.string().min(1).max(20).nullable(),
  sort_order: z.number().int().min(0),
});

const ChipsArraySchema = z
  .array(ChipInputSchema)
  .max(20)
  .default([])
  .refine(
    (chips) => {
      const labels = chips.map((c) => c.label.toLowerCase());
      return new Set(labels).size === labels.length;
    },
    { message: 'Duplicate chip label (case-insensitive)' },
  );

export const CreateMenuSchema = z.object({
  name: z.string().min(1).max(80),
  category: CategorySchema,
  price: z.number().int().nonnegative(),
  sort_order: z.number().int().default(0),
  chips: ChipsArraySchema,
});

export const UpdateMenuSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  category: CategorySchema.optional(),
  price: z.number().int().nonnegative().optional(),
  sort_order: z.number().int().optional(),
  is_active: z.boolean().optional(),
  chips: ChipsArraySchema.optional(),
}).strict();

export type ChipInput = z.infer<typeof ChipInputSchema>;
export type CreateMenu = z.infer<typeof CreateMenuSchema>;
export type UpdateMenu = z.infer<typeof UpdateMenuSchema>;
