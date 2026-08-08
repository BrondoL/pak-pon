import { NextResponse, after, type NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';
import { pushPrintJob } from '@/lib/fcm';
import { PrintSendSchema } from './_schema';

// Dispatch threshold = "agent kemungkinan masih reachable via FCM" — bukan
// "heartbeat fresh". OEM Doze/App Standby (HiOS, MIUI, ColorOS) freeze
// heartbeat thread, tapi Google Play Services tetap deliver FCM. Threshold
// 24 jam cukup longgar untuk semua case freeze realistis (tablet idle
// overnight), tetep filter agent yang truly dead (uninstall, ganti device).
// UI banner di /api/agent/heartbeat tetap pakai 90s untuk indikasi staleness.
const ONLINE_THRESHOLD_SECONDS = 24 * 60 * 60;

export async function POST(request: NextRequest) {
  const evt = newEvent('POST /api/print/send');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const body = await request.json();
    const parsed = PrintSendSchema.safeParse(body);
    if (!parsed.success) {
      tagStatus(evt, 400);
      evt.merge({ validation_errors: parsed.error.flatten() });
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }
    const payload = parsed.data;

    const job_id = randomUUID();
    evt.merge({
      job_id,
      tx_id: payload.tx_id,
      target: payload.target,
      trigger: payload.trigger,
      bytes_size: payload.bytes_b64.length,
      item_ids_count: payload.item_ids?.length ?? 0,
    });

    // Find agents currently online (explicit state + recent heartbeat).
    const threshold = new Date(Date.now() - ONLINE_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: agents, error: queryErr } = await supabase
      .from('agent_heartbeats')
      .select('agent_label, fcm_token')
      .eq('is_primary', true)
      .eq('status', 'online')
      .gte('last_seen_at', threshold)
      .not('fcm_token', 'is', null);
    if (queryErr) {
      tagStatus(evt, 500);
      evt.error(queryErr);
      return NextResponse.json({ error: queryErr.message }, { status: 500 });
    }

    const targets = (agents ?? []).filter(
      (a): a is { agent_label: string; fcm_token: string } =>
        typeof a.fcm_token === 'string' && a.fcm_token.length > 0,
    );

    if (targets.length === 0) {
      tagStatus(evt, 503);
      evt.set('reject_reason', 'primary_offline');
      return NextResponse.json(
        { error: 'agent_offline', detail: 'primary agent offline or not set' },
        { status: 503 },
      );
    }
    evt.set('dispatched_to', targets.map((t) => t.agent_label));

    // Insert pending row sebagai proof of dispatch. Polling agent juga
    // pakai row ini sebagai fallback kalau FCM ga nyampe.
    const primaryLabel = targets[0].agent_label;
    const { error: insertErr } = await supabase
      .from('print_history')
      .insert({
        id: job_id,
        tx_id: payload.tx_id,
        agent_label: primaryLabel,
        target: payload.target,
        trigger: payload.trigger,
        item_ids: payload.item_ids,
        bytes_b64: payload.bytes_b64,
        status: 'pending',
      });
    if (insertErr) {
      tagStatus(evt, 500);
      evt.error(insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
    evt.set('inserted_pending', true);

    // Push FCM SETELAH respons terkirim, tapi lewat `after()` — BUKAN promise
    // menggantung. Di serverless, kerja yang belum selesai saat respons
    // dikembalikan boleh dimatikan begitu instance-nya dibekukan; kalau itu
    // kejadian, pesannya tidak pernah terkirim sama sekali dan job baru
    // tercetak saat poller 60 detik menyapunya. `after()` menahan invocation
    // sampai callback-nya selesai. Cookies/headers tetap boleh dipakai di
    // dalamnya untuk Route Handler, jadi klien `supabase` di atas aman.
    after(async () => {
      try {
        const r = await pushPrintJob({
          tokens: targets.map((t) => t.fcm_token),
          job: {
            id: job_id,
            tx_id: payload.tx_id,
            target: payload.target,
            trigger: payload.trigger,
            item_ids: payload.item_ids,
            bytes_b64: payload.bytes_b64,
          },
        });
        console.log(`[fcm] push job=${job_id} ok=${r.ok} failed=${r.failed}`);
        if (r.invalidTokens.length > 0) {
          await supabase
            .from('agent_heartbeats')
            .update({ fcm_token: null })
            .in('fcm_token', r.invalidTokens);
          console.log(`[fcm] cleared ${r.invalidTokens.length} stale token(s)`);
        }
      } catch (e) {
        console.warn(`[fcm] push job=${job_id} error`, e);
      }
    });

    tagStatus(evt, 200);
    return NextResponse.json({
      job_id,
      dispatched_to: targets.map((t) => t.agent_label),
    });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
