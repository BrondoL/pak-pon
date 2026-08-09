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
    claimed_via: null,
    receive_to_claim_ms: null,
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

  it('meng-clamp tiap ruas sendiri-sendiri, bukan cuma totalnya', () => {
    // printing_at (jam Postgres) lebih belakang dari done_at (jam tablet yang
    // mundur) — ruas cetak negatif, totalnya masih positif.
    const d = computeJobDuration(
      job({ status: 'done', printing_at: at(900), done_at: at(800) }),
    )!;
    expect(d.totalMs).toBe(800);
    expect(d.sendMs).toBe(900);
    expect(d.printMs).toBe(0);
    // Sengaja: begitu ada ruas yang ter-clamp, sendMs + printMs TIDAK lagi
    // sama dengan totalMs. Lihat spec bagian "Ketelitian angka".
    expect(d.sendMs! + d.printMs!).not.toBe(d.totalMs);
  });

  it('memecah ruas kirim jadi fcm dan agent', () => {
    const d = computeJobDuration(
      job({
        status: 'done',
        printing_at: at(2000),
        done_at: at(2200),
        claimed_via: 'fcm',
        receive_to_claim_ms: 300,
      }),
    )!;
    expect(d.sendMs).toBe(2000);
    expect(d.agentMs).toBe(300);
    expect(d.deliverMs).toBe(1700);
    expect(d.claimedVia).toBe('fcm');
  });

  it('meng-clamp deliverMs ke 0 kalau agentMs melebihi sendMs', () => {
    // Bisa terjadi: sendMs dari jam Postgres, agentMs dari jam monotonik
    // tablet. Pembulatan & jitter bikin agentMs sesekali sedikit lebih besar.
    const d = computeJobDuration(
      job({ printing_at: at(500), done_at: at(700), receive_to_claim_ms: 900 }),
    )!;
    expect(d.deliverMs).toBe(0);
  });

  it('baris lama tanpa kolom klaim: agentMs & deliverMs null', () => {
    const d = computeJobDuration(job({ printing_at: at(900), done_at: at(1200) }))!;
    expect(d.sendMs).toBe(900);
    expect(d.agentMs).toBeNull();
    expect(d.deliverMs).toBeNull();
    expect(d.claimedVia).toBeNull();
  });

  it('deliverMs null kalau printing_at tidak ada meski receive_to_claim_ms ada', () => {
    const d = computeJobDuration(job({ done_at: at(1200), receive_to_claim_ms: 300 }))!;
    expect(d.sendMs).toBeNull();
    expect(d.agentMs).toBe(300);
    expect(d.deliverMs).toBeNull();
  });

  it('meneruskan claimed_via poll apa adanya', () => {
    const d = computeJobDuration(
      job({ printing_at: at(60000), done_at: at(60200), claimed_via: 'poll', receive_to_claim_ms: 400 }),
    )!;
    expect(d.claimedVia).toBe('poll');
    expect(d.agentMs).toBe(400);
    // deliverMs TETAP dihitung untuk baris poll — yang memutuskan
    // menyembunyikannya adalah UI, bukan fungsi ini.
    expect(d.deliverMs).toBe(59600);
  });
});

describe('formatDuration', () => {
  it('memakai koma desimal dan satu angka di belakang', () => {
    expect(formatDuration(1234)).toBe('1,2 dtk');
    expect(formatDuration(59800)).toBe('59,8 dtk');
    expect(formatDuration(0)).toBe('0,0 dtk');
  });
});
