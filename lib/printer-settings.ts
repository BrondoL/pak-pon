export type PaperWidth = '58mm' | '80mm';
export type CutMode = 'full' | 'partial' | 'none';

export type PrinterSettings = {
  paper_width: PaperWidth;
  feed_lines_before_cut: number;
  cut_mode: CutMode;
  beep_on_print: boolean;
  header_text: string | null;
};

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  paper_width: '58mm',
  feed_lines_before_cut: 4,
  cut_mode: 'full',
  beep_on_print: false,
  header_text: null,
};

export function charsPerLine(paperWidth: PaperWidth): number {
  return paperWidth === '80mm' ? 48 : 32;
}
