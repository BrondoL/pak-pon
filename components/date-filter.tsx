'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { today } from '@/lib/date';

export function DateFilter() {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const dateFrom = sp.get('date_from') ?? today();
  const dateTo = sp.get('date_to') ?? dateFrom;
  const q = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';

  function update(key: string, value: string) {
    const next = new URLSearchParams(sp.toString());
    if (value === '') next.delete(key);
    else next.set(key, value);
    next.delete('page');
    startTransition(() => {
      router.replace(`?${next.toString()}`);
    });
  }

  function quickRange(days: number) {
    const to = today();
    const [y, m, d] = to.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, d - (days - 1))).toISOString().slice(0, 10);
    const next = new URLSearchParams(sp.toString());
    next.set('date_from', from);
    next.set('date_to', to);
    next.delete('page');
    startTransition(() => router.replace(`?${next.toString()}`));
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor="date_from">Dari tanggal</Label>
          <Input
            id="date_from"
            type="date"
            value={dateFrom}
            onChange={(e) => update('date_from', e.target.value)}
            className="mt-2"
          />
        </div>
        <div>
          <Label htmlFor="date_to">Sampai tanggal</Label>
          <Input
            id="date_to"
            type="date"
            value={dateTo}
            onChange={(e) => update('date_to', e.target.value)}
            className="mt-2"
          />
        </div>
        <div>
          <Label htmlFor="q">Cari nama</Label>
          <Input
            id="q"
            value={q}
            placeholder="cth: Pak Budi"
            onChange={(e) => update('q', e.target.value)}
            className="mt-2"
          />
        </div>
        <div>
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            value={status}
            onChange={(e) => update('status', e.target.value)}
            className="mt-2 block w-full rounded-md border border-clay-soft bg-paper-soft px-3 py-2 text-sm text-coal"
          >
            <option value="">Semua</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending_review">Pending Review</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => quickRange(1)} disabled={pending}>Hari ini</Button>
        <Button size="sm" variant="ghost" onClick={() => quickRange(7)} disabled={pending}>7 hari</Button>
        <Button size="sm" variant="ghost" onClick={() => quickRange(30)} disabled={pending}>30 hari</Button>
      </div>
    </div>
  );
}
