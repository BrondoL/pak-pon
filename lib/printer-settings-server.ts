import { getSupabaseServer } from './supabase/server';
import { DEFAULT_PRINTER_SETTINGS, type PrinterSettings } from './printer-settings';

export async function getPrinterSettings(): Promise<PrinterSettings> {
  const supabase = await getSupabaseServer();
  const { data } = await supabase
    .from('printer_settings')
    .select('paper_width, feed_lines_before_cut, cut_mode, beep_on_print, header_text, footer_text')
    .eq('id', 1)
    .single();
  if (!data) return DEFAULT_PRINTER_SETTINGS;
  // Defensive: footer_text bisa null kalau migration belum apply di env terkait.
  return {
    paper_width: data.paper_width,
    feed_lines_before_cut: data.feed_lines_before_cut,
    cut_mode: data.cut_mode,
    beep_on_print: data.beep_on_print,
    header_text: data.header_text,
    footer_text: data.footer_text ?? '',
  };
}
