/**
 * localStorage helper untuk track status printer per device.
 *
 * State per target (dapur, minuman):
 * - not_configured: belum pernah test atau status di-reset
 * - success: test/print terakhir berhasil
 * - failed: test/print terakhir gagal (manual lapor user)
 *
 * SSR-safe: cek typeof window.
 */

export const STORAGE_KEY = 'pak_pon_printer_status';

export type PrinterStatusState = 'success' | 'failed' | 'not_configured';
export type PrinterTarget = 'dapur' | 'minuman';

export type PrinterStatus = {
  state: PrinterStatusState;
  last_check: string | null; // ISO timestamp
  last_outcome_note?: string;
};

export type PrinterStatusMap = {
  dapur: PrinterStatus;
  minuman: PrinterStatus;
};

const DEFAULT: PrinterStatusMap = {
  dapur: { state: 'not_configured', last_check: null },
  minuman: { state: 'not_configured', last_check: null },
};

export function getPrinterStatus(): PrinterStatusMap {
  if (typeof window === 'undefined') return DEFAULT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<PrinterStatusMap>;
    return {
      dapur: parsed.dapur ?? DEFAULT.dapur,
      minuman: parsed.minuman ?? DEFAULT.minuman,
    };
  } catch {
    return DEFAULT;
  }
}

export function setPrinterStatus(target: PrinterTarget, status: PrinterStatus): void {
  if (typeof window === 'undefined') return;
  const current = getPrinterStatus();
  const next: PrinterStatusMap = { ...current, [target]: status };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
