import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { HomeTiles } from '@/components/home-tiles';
import { PrinterStatusBanner } from '@/components/printer-status-banner';
import { getSupabaseServer } from '@/lib/supabase/server';
import { currentBusinessDate, businessDayRange } from '@/lib/date';
import { formatRp } from '@/lib/currency';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await getSupabaseServer();
  const date = currentBusinessDate();
  const { start, end } = businessDayRange(date);

  const { data } = await supabase
    .from('transactions')
    .select('id, status, transaction_items(qty, unit_price_snapshot)')
    .is('deleted_at', null)
    .gte('created_at', start)
    .lt('created_at', end);

  let todayTotal = 0;
  let confirmedCount = 0;
  let pendingCount = 0;
  for (const tx of data ?? []) {
    if (tx.status === 'pending_review') {
      pendingCount += 1;
      continue;
    }
    confirmedCount += 1;
    const lines = (tx.transaction_items ?? []) as Array<{ qty: number; unit_price_snapshot: number }>;
    todayTotal += lines.reduce((acc, l) => acc + l.qty * l.unit_price_snapshot, 0);
  }

  const dateLabel = new Date(`${date}T12:00:00+07:00`).toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="space-y-8 md:space-y-10">
      <PrinterStatusBanner />
      <div className="max-w-2xl">
        <p className="font-body text-[11px] font-medium uppercase tracking-[0.22em] text-clay">
          Shift · {dateLabel}
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Selamat datang, <span className="italic">Pak.</span>
        </h1>
        <p className="mt-3 font-display text-base italic leading-relaxed text-coal-soft md:text-lg">
          Pilih kegiatan di bawah untuk mulai. Foto nota, lihat history,
          buka laporan, atau atur menu master.
        </p>
      </div>

      <Card variant="paper" className="px-5 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
            Ringkasan hari ini
          </p>
          <Link
            href="/reports/daily"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brick hover:text-brick-dark"
          >
            Buka closingan →
          </Link>
        </div>
        {confirmedCount === 0 && pendingCount === 0 ? (
          <div className="mt-4 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-display text-xl italic leading-snug text-coal">
                Belum ada transaksi hari ini.
              </p>
              <p className="mt-1 text-sm text-coal-soft">
                Mulai shift dengan foto nota pertama — tinggal scan, sistem
                yang baca.
              </p>
            </div>
            <Link href="/scan">
              <Button>📷 Scan nota pertama</Button>
            </Link>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-clay">Pemasukan</div>
              <div className="mt-1 font-display text-2xl tracking-tight text-coal md:text-3xl">
                {formatRp(todayTotal)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-clay">Transaksi</div>
              <div className="mt-1 font-display text-2xl text-coal md:text-3xl">
                {confirmedCount}
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <div className="text-[10px] uppercase tracking-[0.18em] text-clay">Draft pending</div>
              {pendingCount > 0 ? (
                <Link
                  href={`/transactions?date_from=${date}&date_to=${date}&status=pending_review`}
                  className="mt-1 inline-flex items-baseline gap-2 font-display text-2xl text-mustard md:text-3xl hover:text-mustard/80"
                >
                  {pendingCount}
                  <span className="text-xs uppercase tracking-wide text-coal-soft">
                    perlu konfirmasi →
                  </span>
                </Link>
              ) : (
                <div className="mt-1 font-display text-2xl text-coal/40 md:text-3xl">0</div>
              )}
            </div>
          </div>
        )}
      </Card>

      <HomeTiles />
    </div>
  );
}
