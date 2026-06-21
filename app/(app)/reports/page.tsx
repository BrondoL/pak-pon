import Link from 'next/link';
import { Card } from '@/components/ui/card';

export default function ReportsPage() {
  return (
    <div className="space-y-8">
      <div>
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Laporan
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight tracking-tight text-coal md:text-4xl">
          Pilih <span className="italic">laporan</span>
        </h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/reports/daily">
          <Card variant="paper" className="px-6 py-8 hover:bg-cream/50 transition-colors cursor-pointer">
            <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
              Harian
            </p>
            <h2 className="mt-2 font-display text-2xl text-coal">Closingan</h2>
            <p className="mt-2 text-sm text-coal-soft">
              Total pemasukan hari ini & top menu. Untuk cocokkan dengan kas fisik.
            </p>
          </Card>
        </Link>
        <Link href="/reports/monthly">
          <Card variant="paper" className="px-6 py-8 hover:bg-cream/50 transition-colors cursor-pointer">
            <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
              Bulanan
            </p>
            <h2 className="mt-2 font-display text-2xl text-coal">Performa</h2>
            <p className="mt-2 text-sm text-coal-soft">
              Total bulan ini, chart per hari, menu paling laris.
            </p>
          </Card>
        </Link>
      </div>
    </div>
  );
}
