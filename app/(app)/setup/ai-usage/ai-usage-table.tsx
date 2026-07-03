import type { DailyUsageView } from '@/lib/ai-usage';
import { formatRp } from '@/lib/currency';

const compact = new Intl.NumberFormat('id-ID', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function shortDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function AiUsageTable({ rows, today }: { rows: DailyUsageView[]; today: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-lg border border-coal/15 bg-white">
      <div className="border-b border-coal/10 px-4 py-2 text-xs uppercase tracking-wide text-coal-soft">
        Detail harian
      </div>
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white text-xs uppercase text-coal-soft">
            <tr className="border-b border-coal/10">
              <th className="px-3 py-2 text-left font-medium">Tgl</th>
              <th className="px-3 py-2 text-right font-medium">Scan</th>
              <th className="px-3 py-2 text-right font-medium">Sukses/Gagal</th>
              <th className="px-3 py-2 text-right font-medium">Input</th>
              <th className="px-3 py-2 text-right font-medium">Output</th>
              <th className="px-3 py-2 text-right font-medium" title="Bagian output yang dipakai model buat mikir. Sudah termasuk di Output.">Thinking</th>
              <th className="px-3 py-2 text-right font-medium">Est. IDR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isToday = r.date === today;
              return (
                <tr
                  key={r.date}
                  className={`border-b border-coal/5 ${isToday ? 'bg-gold/10' : ''}`}
                >
                  <td className="px-3 py-2 text-coal">
                    {shortDate(r.date)}
                    {isToday && <span className="ml-1 text-[10px] text-coal-soft">(hari ini)</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-coal">{r.scan_count}</td>
                  <td className="px-3 py-2 text-right text-coal-soft">
                    {r.success_count} / {r.fail_count}
                  </td>
                  <td className="px-3 py-2 text-right text-coal">{compact.format(r.input)}</td>
                  <td className="px-3 py-2 text-right text-coal">{compact.format(r.output)}</td>
                  <td className="px-3 py-2 text-right text-coal-soft">{compact.format(r.thoughts)}</td>
                  <td className="px-3 py-2 text-right text-coal">~{formatRp(r.idr)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
