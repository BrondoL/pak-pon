// lib/print-duration.ts

/** Di atas ini ditandai merah di halaman debug. Diambil dari p90 terukur
 *  1-8 Agustus 2026: minuman p90 1,2 dtk, customer p90 5,6 dtk. */
export const SLOW_THRESHOLD_MS = 5000;

export type PrintJobStatus = 'pending' | 'printing' | 'done' | 'failed';

export type ClaimedVia = 'fcm' | 'poll';

export type PrintJobTimestamps = {
  status: PrintJobStatus;
  created_at: string;
  printing_at: string | null;
  done_at: string | null;
  failed_at: string | null;
  claimed_via: ClaimedVia | null;
  receive_to_claim_ms: number | null;
};

export type JobDuration = {
  totalMs: number;
  /** created_at → printing_at. null kalau printing_at tidak ada (baris lama). */
  sendMs: number | null;
  /** printing_at → akhir. null kalau printing_at tidak ada. */
  printMs: number | null;
  /** receive_to_claim_ms — lama agent memproses sebelum klaim mendarat. */
  agentMs: number | null;
  /** sendMs − agentMs, clamp 0. null kalau salah satunya tidak ada. */
  deliverMs: number | null;
  claimedVia: ClaimedVia | null;
  /** totalMs >= SLOW_THRESHOLD_MS. Dihitung dari total, bukan per ruas. */
  isSlow: boolean;
};

/**
 * Selisih milidetik, di-clamp ke 0. created_at & printing_at dari jam Postgres,
 * done_at & failed_at dari jam tablet — kalau jam tablet mundur, selisihnya bisa
 * negatif. NaN (stempel tak terbaca) dibiarkan lewat supaya pemanggil bisa
 * mendeteksinya.
 */
function diffMs(from: string, to: string): number {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Math.max(0, ms);
}

/**
 * null kalau job belum punya ujung (pending/printing) atau stempelnya hilang /
 * tidak terbaca — sengaja null, bukan 0, supaya UI bisa membedakan "belum
 * selesai" dari "selesai dalam 0 detik".
 */
export function computeJobDuration(job: PrintJobTimestamps): JobDuration | null {
  // Pada baris `failed`, done_at BUKAN waktu selesai: agent menulis waktu klaim
  // ke sana (PrintHistoryRepository.claim) dan hanya markDone yang menimpanya.
  // Memakainya di sini menampilkan ~0,9 detik seolah durasi cetak — menyesatkan
  // justru ketika halaman ini sedang dipakai menyelidiki.
  const endedAt =
    job.status === 'done' ? job.done_at
    : job.status === 'failed' ? job.failed_at
    : null;
  if (endedAt === null) return null;

  const totalMs = diffMs(job.created_at, endedAt);
  if (!Number.isFinite(totalMs)) return null;

  const rawSendMs = job.printing_at ? diffMs(job.created_at, job.printing_at) : null;
  const sendMs = rawSendMs !== null && Number.isFinite(rawSendMs) ? rawSendMs : null;
  const printMs = job.printing_at ? diffMs(job.printing_at, endedAt) : null;

  const agentMs =
    job.receive_to_claim_ms !== null && Number.isFinite(job.receive_to_claim_ms)
      ? Math.max(0, job.receive_to_claim_ms)
      : null;

  // Sisa waktu setelah pemrosesan agent dikeluarkan = perjalanan FCM.
  // Dua sumber waktu berbeda (Postgres vs jam monotonik tablet), jadi
  // selisihnya bisa sedikit negatif karena pembulatan — clamp ke 0.
  const deliverMs =
    sendMs !== null && agentMs !== null ? Math.max(0, sendMs - agentMs) : null;

  return {
    totalMs,
    sendMs,
    printMs: Number.isFinite(printMs) ? printMs : null,
    agentMs,
    deliverMs,
    claimedVia: job.claimed_via,
    isSlow: totalMs >= SLOW_THRESHOLD_MS,
  };
}

/** 1234 → "1,2 dtk". Koma desimal, satu angka di belakang. */
export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} dtk`;
}
