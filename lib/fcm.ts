import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

/**
 * Lazy-initialise Firebase Admin. We never want to crash at module load
 * (which Next.js may do for any imported file) if the env var is missing
 * in some environment — instead we no-op the push.
 */
function adminApp(): App | null {
  if (getApps().length > 0) return getApps()[0]!;

  // Path-based credential (dev)
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) {
    return initializeApp({ credential: cert(path) });
  }

  // Base64 JSON (Vercel)
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (b64) {
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    return initializeApp({ credential: cert(json) });
  }

  console.warn('[fcm] no credentials configured, push disabled');
  return null;
}

export interface PushAgentArgs {
  /** FCM device tokens to push to. Empty array = no-op. */
  tokens: string[];
  /**
   * Inline job payload — sent in FCM data so the agent can process the
   * print without needing a follow-up Supabase fetch. Agent ignores empty
   * `tx_id` (sentinel for test print). `item_ids` JSON-encoded as string array.
   */
  job: {
    id: string;
    tx_id: string | null;
    target: 'dapur' | 'minuman' | 'customer';
    trigger: 'auto' | 'auto_additional' | 'reprint' | 'reprint_additional' | 'customer' | 'test';
    item_ids: string[] | null;
    bytes_b64: string;
  };
}

export interface PushAgentResult {
  /** How many tokens FCM accepted for delivery. */
  ok: number;
  /** How many failed for any reason. */
  failed: number;
  /**
   * Tokens that FCM said are unregistered / invalid. The caller should
   * clear these from the DB so we don't keep retrying them every push.
   */
  invalidTokens: string[];
}

/**
 * Umur pesan FCM. Disamakan dengan jendela cron print-sweep (5 menit): lewat
 * itu baris `pending` sudah ditandai `failed`, sehingga FCM yang datang
 * terlambat tidak bisa lagi mengklaim (filter `status='pending'` di
 * `PrintHistoryRepository.claim()`) dan tidak ada kertas yang keluar.
 *
 * Sebelumnya 60 detik, dipasang supaya nota basi tidak tiba-tiba tercetak.
 * Alasan itu sudah usang sejak claim-before-print: perlindungannya sekarang
 * dipegang klaim atomik, bukan TTL. Yang tersisa cuma kerugiannya — gangguan
 * pengiriman sesaat bikin pesan DIBUANG FCM, dan job baru tercetak saat
 * poller 60 detik menyapunya.
 */
const FCM_TTL_MS = 5 * 60 * 1000;

const INVALID_FCM_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Fire-and-forget inline print job push to one or more agent devices.
 * Returns counts + the subset of tokens FCM said are dead so the caller
 * can clean them out of the DB.
 */
export async function pushPrintJob(args: PushAgentArgs): Promise<PushAgentResult> {
  const app = adminApp();
  if (!app || args.tokens.length === 0) {
    return { ok: 0, failed: 0, invalidTokens: [] };
  }

  // FCM data values must be strings. After Phase 3 cleanup, payload always
  // includes the full inline job — no legacy `check_queue` fallback.
  const data: Record<string, string> = {
    action: 'print_job',
    job_id: args.job.id,
    tx_id: args.job.tx_id ?? '',
    target: args.job.target,
    trigger: args.job.trigger,
    item_ids: JSON.stringify(args.job.item_ids ?? []),
    bytes_b64: args.job.bytes_b64,
  };

  const messaging = getMessaging(app);
  const res = await messaging.sendEachForMulticast({
    tokens: args.tokens,
    data,
    android: {
      priority: 'high',
      ttl: FCM_TTL_MS,
    },
  });

  const invalidTokens: string[] = [];
  res.responses.forEach((r, i) => {
    const code = r.error?.code;
    if (code && INVALID_FCM_ERROR_CODES.has(code)) {
      invalidTokens.push(args.tokens[i]!);
    }
  });

  return {
    ok: res.successCount,
    failed: res.failureCount,
    invalidTokens,
  };
}
