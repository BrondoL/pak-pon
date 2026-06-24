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

const INVALID_FCM_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/**
 * Fire-and-forget "check_queue" trigger push to one or more agent devices.
 * Returns counts + the subset of tokens FCM said are dead so the caller
 * can clean them out of the DB.
 */
export async function pushCheckQueue(args: PushAgentArgs): Promise<PushAgentResult> {
  const app = adminApp();
  if (!app || args.tokens.length === 0) {
    return { ok: 0, failed: 0, invalidTokens: [] };
  }

  const messaging = getMessaging(app);
  const res = await messaging.sendEachForMulticast({
    tokens: args.tokens,
    data: { action: 'check_queue' },
    android: {
      priority: 'high',
      ttl: 60 * 1000, // 1 minute — agent's catch-up handles delayed receipts
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
