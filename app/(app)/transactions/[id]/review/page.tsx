import { notFound } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getPrinterSettings } from '@/lib/printer-settings-server';
import { NotaReviewForm } from '@/components/nota-review-form';
import type { MenuOption } from '@/components/nota-item-modal';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'notas';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await getSupabaseServer();

  const { data: tx, error: txError } = await supabase
    .from('transactions')
    .select('id, status, handwritten_total, customer_name, table_no, is_takeaway, created_at, scan_image_path')
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  if (txError || !tx) notFound();

  const { data: items } = await supabase
    .from('transaction_items')
    .select('id, menu_id, menu_name_snapshot, unit_price_snapshot, qty, notes, sort_order, confidence')
    .eq('transaction_id', id)
    .order('sort_order');

  const { data: menusData } = await supabase
    .from('menus')
    .select('id, name, category, price')
    .eq('is_active', true)
    .order('category')
    .order('name');
  const menus: MenuOption[] = menusData ?? [];

  let scanUrl: string | null = null;
  if (tx.scan_image_path) {
    const { data: signed } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(tx.scan_image_path, SIGNED_URL_TTL_SECONDS);
    scanUrl = signed?.signedUrl ?? null;
  }

  const printerSettings = await getPrinterSettings();

  return (
    <NotaReviewForm
      transaction={{
        id: tx.id,
        status: tx.status,
        handwritten_total: tx.handwritten_total,
        customer_name: tx.customer_name,
        table_no: tx.table_no,
        is_takeaway: tx.is_takeaway,
        created_at: tx.created_at,
      }}
      initialItems={items ?? []}
      menus={menus}
      scanUrl={scanUrl}
      printerSettings={printerSettings}
    />
  );
}
