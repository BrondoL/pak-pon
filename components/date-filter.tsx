'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { currentBusinessDate } from '@/lib/date';

const SEARCH_DEBOUNCE_MS = 400;

export function DateFilter() {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const dateFrom = sp.get('date_from') ?? currentBusinessDate();
  const dateTo = sp.get('date_to') ?? dateFrom;
  const q = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const takeaway = sp.get('takeaway') ?? '';

  // Local mirror of `q` so the input stays responsive while typing;
  // the URL (and thus server query) is only updated after debounce.
  // Sync from external URL changes via the "adjusting state on prop change"
  // pattern (https://react.dev/learn/you-might-not-need-an-effect).
  const [qLocal, setQLocal] = useState(q);
  const [prevQ, setPrevQ] = useState(q);
  if (q !== prevQ) {
    setPrevQ(q);
    setQLocal(q);
  }

  // Debounce: push qLocal to URL only after user pauses typing.
  useEffect(() => {
    if (qLocal === q) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(sp.toString());
      if (qLocal === '') next.delete('q');
      else next.set('q', qLocal);
      next.delete('page');
      startTransition(() => {
        router.replace(`?${next.toString()}`);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [qLocal, q, sp, router]);

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
    const to = currentBusinessDate();
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
            value={qLocal}
            placeholder="cth: Pak Budi"
            onChange={(e) => setQLocal(e.target.value)}
            className="mt-2"
          />
        </div>
        <div>
          <Label htmlFor="status">Status</Label>
          <Select value={status || 'all'} onValueChange={(v) => update('status', v === 'all' ? '' : String(v))}>
            <SelectTrigger id="status" className="mt-2 w-full">
              <SelectValue placeholder="Semua" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="pending_review">Pending Review</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="takeaway">Bungkus</Label>
          <Select value={takeaway || 'all'} onValueChange={(v) => update('takeaway', v === 'all' ? '' : String(v))}>
            <SelectTrigger id="takeaway" className="mt-2 w-full">
              <SelectValue placeholder="Semua" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua</SelectItem>
              <SelectItem value="yes">Bungkus</SelectItem>
              <SelectItem value="no">Makan sini</SelectItem>
            </SelectContent>
          </Select>
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
