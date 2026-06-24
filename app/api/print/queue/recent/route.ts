import { NextResponse, type NextRequest } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase/server';
import { newEvent, tagStatus } from '@/lib/logger';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const VALID_STATUS = ['pending', 'printing', 'done', 'failed'] as const;

export async function GET(request: NextRequest) {
  const evt = newEvent('GET /api/print/queue/recent');
  try {
    const supabase = await getSupabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      tagStatus(evt, 401);
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    evt.set('user_id', user.id);

    const limitParam = request.nextUrl.searchParams.get('limit');
    const statusParam = request.nextUrl.searchParams.get('status');

    const limit = Math.min(
      Math.max(parseInt(limitParam ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    evt.set('limit', limit);

    let query = supabase
      .from('print_queue')
      .select('id, tx_id, target, trigger, status, failure_reason, created_at, picked_up_at, completed_at, agent_label, transactions(customer_name, table_no, daily_seq)')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (statusParam && statusParam !== 'all' && (VALID_STATUS as readonly string[]).includes(statusParam)) {
      query = query.eq('status', statusParam);
      evt.set('filter_status', statusParam);
    }

    const { data, error } = await query;
    if (error) {
      tagStatus(evt, 500);
      evt.error(error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const jobs = (data ?? []).map((row) => {
      const rawTx = (row as { transactions?: unknown }).transactions;
      const tx = Array.isArray(rawTx) ? rawTx[0] : rawTx;
      const txTyped = tx as { customer_name?: string | null; table_no?: string | null; daily_seq?: number | null } | null | undefined;
      return {
        id: row.id,
        tx_id: row.tx_id,
        target: row.target,
        trigger: row.trigger,
        status: row.status,
        failure_reason: row.failure_reason,
        created_at: row.created_at,
        picked_up_at: row.picked_up_at,
        completed_at: row.completed_at,
        agent_label: row.agent_label ?? null,
        customer_name: txTyped?.customer_name ?? null,
        table_no: txTyped?.table_no ?? null,
        daily_seq: txTyped?.daily_seq ?? null,
      };
    });

    evt.set('rows_count', jobs.length);
    tagStatus(evt, 200);
    return NextResponse.json({ jobs });
  } catch (err) {
    tagStatus(evt, 500);
    evt.error(err);
    throw err;
  } finally {
    evt.emit();
  }
}
