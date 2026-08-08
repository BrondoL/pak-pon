// lib/monitor-server.ts
import { currentBusinessDate, businessDayRange } from '@/lib/date';
import { mapMonitorRow, type MonitorRow, type MonitorRawRow } from '@/lib/monitor';
import type { getSupabaseServer } from '@/lib/supabase/server';

type SupabaseLike = Awaited<ReturnType<typeof getSupabaseServer>>;

/**
 * Ambil transaksi belum-bayar untuk hari bisnis berjalan, termasuk dine-in dan bungkus.
 * Filter: confirmed + paid_at NULL + belum dihapus + created_at dalam hari ini.
 * Kasir tandai lunas bungkus dari papan yang sama.
 * Himpunan kecil (belum-bayar hari ini) — aman map/total di JS, bukan agregasi 1000-row.
 */
export async function fetchUnpaidRows(supabase: SupabaseLike): Promise<MonitorRow[]> {
  const { start, end } = businessDayRange(currentBusinessDate());
  const { data, error } = await supabase
    .from('transactions')
    .select('id, created_at, customer_name, table_no, is_takeaway, transaction_items(qty, unit_price_snapshot)')
    .eq('status', 'confirmed')
    .is('paid_at', null)
    .is('deleted_at', null)
    .gte('created_at', start)
    .lt('created_at', end)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => mapMonitorRow(r as unknown as MonitorRawRow));
}
