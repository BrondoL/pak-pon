// lib/print-duration.test.ts
import { describe, expect, it } from 'vitest';
import {
  computeJobDuration,
  formatDuration,
  SLOW_THRESHOLD_MS,
  type PrintJobTimestamps,
} from './print-duration';

const T0 = '2026-08-08T11:48:30.000Z';

/** T0 + n milidetik, sebagai string ISO. */
function at(ms: number): string {
  return new Date(new Date(T0).getTime() + ms).toISOString();
}

function job(over: Partial<PrintJobTimestamps> = {}): PrintJobTimestamps {
  return {
    status: 'done',
    created_at: T0,
    printing_at: null,
    done_at: null,
    failed_at: null,
    ...over,
  };
}

describe('computeJobDuration', () => {
  it('memecah job sukses jadi ruas kirim dan cetak', () => {
    const d = computeJobDuration(
      job({ status: 'done', printing_at: at(900), done_at: at(16100) }),
    )!;
    expect(d.totalMs).toBe(16100);
    expect(d.sendMs).toBe(900);
    expect(d.printMs).toBe(15200);
    // Identitas ini hanya berlaku karena semua selisih di fixture positif.
    expect(d.sendMs! + d.printMs!).toBe(d.totalMs);
  });

  it('baris lama tanpa printing_at tetap punya total, tanpa pecahan', () => {
    const d = computeJobDuration(job({ status: 'done', done_at: at(1200) }))!;
    expect(d.totalMs).toBe(1200);
    expect(d.sendMs).toBeNull();
    expect(d.printMs).toBeNull();
  });

  // Load-bearing: pada baris gagal, done_at berisi stempel KLAIM dari agent,
  // bukan waktu selesai. Fixture sengaja memasang keduanya dengan jarak jauh —
  // rumus yang keliru menghasilkan 900, bukan 5900.
  it('baris gagal memakai failed_at dan mengabaikan stempel klaim di done_at', () => {
    const d = computeJobDuration(
      job({ status: 'failed', done_at: at(900), failed_at: at(5900) }),
    )!;
    expect(d.totalMs).toBe(5900);
    expect(d.totalMs).not.toBe(900);
  });

  it('memecah ruas baris gagal dari printing_at, bukan done_at', () => {
    const d = computeJobDuration(
      job({ status: 'failed', printing_at: at(730), done_at: at(730), failed_at: at(5730) }),
    )!;
    expect(d.sendMs).toBe(730);
    expect(d.printMs).toBe(5000);
  });

  it('job yang belum ada ujungnya mengembalikan null', () => {
    expect(computeJobDuration(job({ status: 'pending' }))).toBeNull();
    expect(computeJobDuration(job({ status: 'printing', printing_at: at(800) }))).toBeNull();
  });

  it('mengembalikan null kalau stempel yang dibutuhkan hilang', () => {
    expect(computeJobDuration(job({ status: 'done', done_at: null }))).toBeNull();
    expect(computeJobDuration(job({ status: 'failed', failed_at: null }))).toBeNull();
  });

  it('mengembalikan null kalau stempelnya tidak bisa dibaca', () => {
    expect(computeJobDuration(job({ status: 'done', done_at: 'bukan tanggal' }))).toBeNull();
  });

  it('isSlow tepat di batas', () => {
    expect(computeJobDuration(job({ done_at: at(SLOW_THRESHOLD_MS - 1) }))!.isSlow).toBe(false);
    expect(computeJobDuration(job({ done_at: at(SLOW_THRESHOLD_MS) }))!.isSlow).toBe(true);
  });

  it('isSlow dihitung dari total, bukan salah satu ruas', () => {
    // Tiap ruas di bawah ambang, totalnya di atas.
    const d = computeJobDuration(
      job({ printing_at: at(3000), done_at: at(6000) }),
    )!;
    expect(d.sendMs).toBe(3000);
    expect(d.printMs).toBe(3000);
    expect(d.isSlow).toBe(true);
  });

  it('meng-clamp selisih negatif ke 0 saat jam tablet mundur', () => {
    const d = computeJobDuration(job({ status: 'done', done_at: at(-400) }))!;
    expect(d.totalMs).toBe(0);
  });
});

describe('formatDuration', () => {
  it('memakai koma desimal dan satu angka di belakang', () => {
    expect(formatDuration(1234)).toBe('1,2 dtk');
    expect(formatDuration(59800)).toBe('59,8 dtk');
    expect(formatDuration(0)).toBe('0,0 dtk');
  });
});
