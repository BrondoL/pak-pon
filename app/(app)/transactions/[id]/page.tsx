import { notFound } from 'next/navigation';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getPrinterSettings } from '@/lib/printer-settings-server';
import { TransactionDetail } from '@/components/transaction-detail';
import { requirePermission, getCurrentActor } from '@/lib/auth/session';
import { can } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'notas';
const SIGNED_URL_TTL_SECONDS = 60 * 60;

export default async function TransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission('transactions.view');
  // getCurrentActor() is cache()'d in the same request — the requirePermission
  // call above already fetched it, so this is not a second query.
  const actor = await getCurrentActor();
  const canEdit = can(actor, 'transactions.edit');
  const canDelete = can(actor, 'transactions.delete');
  // Tandai/batalkan lunas memakai kunci yang sama dengan /monitor — lihat
  // pemisahan dua kunci di PATCH /api/transactions/[id].
  const canMarkPaid = can(actor, 'monitor.use');

  const { id } = await params;
  const supabase = await getSupabaseServer();

  const { data: tx } = await supabase
    .from('transactions')
    .select('id, status, handwritten_total, customer_name, table_no, is_takeaway, created_at, scan_image_path, scan_image_purged_at, daily_seq, paid_at, created_by')
    .eq('id', id)
    .is('deleted_at', null)
    .single();
  if (!tx) notFound();

  // RLS `profiles_read` cuma izinkan baca baris sendiri atau semua baris kalau
  // superadmin — kasir yang buka transaksi rekannya dapat null di sini, dan
  // baris "Diinput oleh" tidak dirender. Itu perilaku yang diterima, bukan bug.
  let createdByName: string | null = null;
  if (tx.created_by) {
    const { data: creator } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('user_id', tx.created_by)
      .maybeSingle();
    createdByName = creator?.display_name ?? null;
  }

  const { data: items } = await supabase
    .from('transaction_items')
    .select('id, menu_name_snapshot, unit_price_snapshot, qty, notes, applied_chips, sort_order, printed_dapur_at, printed_minuman_at, menus(category)')
    .eq('transaction_id', id)
    .order('sort_order');

  let scanUrl: string | null = null;
  if (tx.scan_image_path) {
    const { data: signed } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(tx.scan_image_path, SIGNED_URL_TTL_SECONDS);
    scanUrl = signed?.signedUrl ?? null;
  }

  const scanPurged = !tx.scan_image_path && !!(tx as { scan_image_purged_at?: string | null }).scan_image_purged_at;

  const printerSettings = await getPrinterSettings();

  return (
    <TransactionDetail
      transaction={{
        id: tx.id,
        status: tx.status,
        handwritten_total: tx.handwritten_total,
        customer_name: tx.customer_name,
        table_no: tx.table_no,
        is_takeaway: tx.is_takeaway,
        created_at: tx.created_at,
        daily_seq: tx.daily_seq ?? null,
        paid_at: tx.paid_at ?? null,
        created_by_name: createdByName,
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
          applied_chips: it.applied_chips ?? [],
          menu_category: category,
          printed_dapur_at: it.printed_dapur_at,
          printed_minuman_at: it.printed_minuman_at,
        };
      })}
      scanUrl={scanUrl}
      scanPurged={scanPurged}
      printerSettings={printerSettings}
      canEdit={canEdit}
      canDelete={canDelete}
      canMarkPaid={canMarkPaid}
    />
  );
}
