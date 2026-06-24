'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSupabaseServer } from '@/lib/supabase/server';

const SettingsSchema = z.object({
  paper_width: z.enum(['58mm', '80mm']),
  feed_lines_before_cut: z.coerce.number().int().min(0).max(8),
  cut_mode: z.enum(['full', 'partial', 'none']),
  beep_on_print: z.coerce.boolean(),
  header_text: z
    .string()
    .max(80)
    .transform((s) => (s.trim() === '' ? null : s.trim()))
    .nullable(),
});

export type SettingsState = { ok?: boolean; error?: string };

export async function savePrinterSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const parsed = SettingsSchema.safeParse({
    paper_width: formData.get('paper_width'),
    feed_lines_before_cut: formData.get('feed_lines_before_cut'),
    cut_mode: formData.get('cut_mode'),
    beep_on_print: formData.get('beep_on_print') === 'on',
    header_text: formData.get('header_text') ?? '',
  });
  if (!parsed.success) {
    return { error: 'Input tidak valid.' };
  }

  const supabase = await getSupabaseServer();
  const { error } = await supabase
    .from('printer_settings')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', 1);

  if (error) return { error: error.message };

  revalidatePath('/setup/printer/settings');
  return { ok: true };
}
