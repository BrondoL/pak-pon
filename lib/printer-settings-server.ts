import { getSupabaseServer } from './supabase/server';
import { DEFAULT_PRINTER_SETTINGS, type PrinterSettings } from './printer-settings';

export async function getPrinterSettings(): Promise<PrinterSettings> {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from('printer_settings')
    .select('paper_width, feed_lines_before_cut, cut_mode, beep_on_print, header_text')
    .eq('id', 1)
    .single();
  if (!data) return DEFAULT_PRINTER_SETTINGS;
  return data as PrinterSettings;
}
