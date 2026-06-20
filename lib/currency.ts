export function formatRp(amount: number): string {
  if (Number.isNaN(amount)) return 'Rp –';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(amount));
  const withSeparator = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}Rp ${withSeparator}`;
}

export function parseRp(input: string): number {
  // Case-insensitive prefix: tolerate "Rp", "rp", "RP" — defensive for OCR output in Plan 2.
  const cleaned = input.replace(/[Rr][Pp]\s?/, '').replace(/\./g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}
