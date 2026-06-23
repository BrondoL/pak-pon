import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPrinterStatus,
  setPrinterStatus,
  STORAGE_KEY,
  type PrinterStatusMap,
} from './printer-status';

describe('printer-status', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns not_configured default for both targets when empty', () => {
    const status = getPrinterStatus();
    expect(status.dapur.state).toBe('not_configured');
    expect(status.minuman.state).toBe('not_configured');
  });

  it('set + get roundtrip', () => {
    setPrinterStatus('dapur', { state: 'success', last_check: '2026-06-23T07:00:00Z' });
    const status = getPrinterStatus();
    expect(status.dapur.state).toBe('success');
    expect(status.dapur.last_check).toBe('2026-06-23T07:00:00Z');
    expect(status.minuman.state).toBe('not_configured');
  });

  it('set both targets independently', () => {
    setPrinterStatus('dapur', { state: 'success', last_check: '2026-06-23T07:00:00Z' });
    setPrinterStatus('minuman', { state: 'failed', last_check: '2026-06-23T07:01:00Z' });
    const status = getPrinterStatus();
    expect(status.dapur.state).toBe('success');
    expect(status.minuman.state).toBe('failed');
  });

  it('handles corrupted JSON gracefully', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    const status = getPrinterStatus();
    expect(status.dapur.state).toBe('not_configured');
    expect(status.minuman.state).toBe('not_configured');
  });

  it('STORAGE_KEY is prefixed pak_pon_', () => {
    expect(STORAGE_KEY).toMatch(/^pak_pon_/);
  });
});
