import Link from 'next/link';
import { getSupabaseServer } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import {
  TransactionTrashRow,
  type TrashRow,
} from '@/components/transaction-trash-row';

export const dynamic = 'force-dynamic';

const LIMIT = 100;

export default async function TrashPage() {
  const supabase = await getSupabaseServer();

  const { data } = await supabase
    .from('transactions')
    .select(
      'id, created_at, deleted_at, status, customer_name, table_no, transaction_items(qty, unit_price_snapshot)'
    )
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
    .limit(LIMIT);

  const items: TrashRow[] = (data ?? []).map((tx) => {
    const lines = (tx.transaction_items ?? []) as Array<{
      qty: number;
      unit_price_snapshot: number;
    }>;
    const total = lines.reduce((acc, l) => acc + l.qty * l.unit_price_snapshot, 0);
    return {
      id: tx.id,
      created_at: tx.created_at,
      deleted_at: tx.deleted_at as string,
      status: tx.status,
      customer_name: tx.customer_name,
      table_no: tx.table_no,
      total,
      item_count: lines.length,
    };
  });

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-xs text-clay">
        <Link href="/transactions" className="hover:text-coal transition-colors">
          ‹ Kembali ke history
        </Link>
      </div>

      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Tempat sampah
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Yang baru <span className="italic">dihapus</span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-coal-soft">
          Transaksi soft-delete bertahan 7 hari sebelum dihapus permanen oleh cron pembersihan.
          Klik “Pulihkan” untuk mengembalikan transaksi ke history.
        </p>
      </div>

      {items.length === 0 ? (
        <Card variant="paper" className="px-6 py-14 text-center">
          <p className="font-display text-xl italic text-coal">
            🗑️ Tidak ada transaksi yang baru dihapus.
          </p>
          <p className="mt-2 text-sm text-coal-soft">
            Saat kamu menghapus transaksi, itu akan muncul di sini selama 7 hari.
          </p>
        </Card>
      ) : (
        <Card variant="paper">
          <ul className="divide-y divide-clay-soft/60">
            {items.map((tx) => (
              <TransactionTrashRow key={tx.id} tx={tx} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
