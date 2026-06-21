import { notFound } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
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
    .select('id, status, handwritten_total, customer_name, table_no, created_at, scan_image_path')
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  if (!tx) notFound();

  const { data: items } = await supabase
    .from('transaction_items')
    .select('id, menu_name_snapshot, unit_price_snapshot, qty, notes, sort_order')
    .eq('transaction_id', id)
    .order('sort_order');

  let scanUrl: string | null = null;
  if (tx.scan_image_path) {
    const { data: signed } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(tx.scan_image_path, SIGNED_URL_TTL_SECONDS);
    scanUrl = signed?.signedUrl ?? null;
  }

  return (
    <TransactionDetail
      transaction={{
        id: tx.id,
        status: tx.status,
        handwritten_total: tx.handwritten_total,
        customer_name: tx.customer_name,
        table_no: tx.table_no,
        created_at: tx.created_at,
      }}
      items={items ?? []}
      scanUrl={scanUrl}
    />
  );
}
