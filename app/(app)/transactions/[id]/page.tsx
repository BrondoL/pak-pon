import { notFound } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getPrinterSettings } from '@/lib/printer-settings-server';
import { TransactionDetail } from '@/components/transaction-detail';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'notas';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export default async function TransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getSupabaseServer();

  const { data: tx } = await supabase
    .from('transactions')
    .select('id, status, handwritten_total, customer_name, table_no, created_at, scan_image_path, daily_seq')
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  if (!tx) notFound();

  const { data: items } = await supabase
    .from('transaction_items')
    .select('id, menu_name_snapshot, unit_price_snapshot, qty, notes, sort_order, menus(category)')
    .eq('transaction_id', id)
    .order('sort_order');

  let scanUrl: string | null = null;
  if (tx.scan_image_path) {
    const { data: signed } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(tx.scan_image_path, SIGNED_URL_TTL_SECONDS);
    scanUrl = signed?.signedUrl ?? null;
  }

  const printerSettings = await getPrinterSettings();

  return (
    <TransactionDetail
      transaction={{
        id: tx.id,
        status: tx.status,
        handwritten_total: tx.handwritten_total,
        customer_name: tx.customer_name,
        table_no: tx.table_no,
        created_at: tx.created_at,
        daily_seq: tx.daily_seq ?? null,
      }}
      items={(items ?? []).map((it) => {
        const rawMenus = (it as { menus?: unknown }).menus;
        let category: string | null = null;
        if (Array.isArray(rawMenus)) {
          const first = rawMenus[0] as { category?: string } | undefined;
          category = first?.category ?? null;
        } else if (rawMenus && typeof rawMenus === 'object') {
          category = (rawMenus as { category?: string }).category ?? null;
        }
        return {
          id: it.id,
          menu_name_snapshot: it.menu_name_snapshot,
          unit_price_snapshot: it.unit_price_snapshot,
          qty: it.qty,
          notes: it.notes,
          menu_category: category,
        };
      })}
      scanUrl={scanUrl}
      printerSettings={printerSettings}
    />
  );
}
