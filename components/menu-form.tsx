'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type MenuFormValues = {
  id?: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
  sort_order: number;
  is_active?: boolean;
};

export function MenuForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Partial<MenuFormValues>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState<MenuFormValues['category']>(initial?.category ?? 'makanan');
  const [price, setPrice] = useState<number>(initial?.price ?? 0);
  const [sortOrder, setSortOrder] = useState<number>(initial?.sort_order ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const payload = { name, category, price, sort_order: sortOrder };
      const res = initial?.id
        ? await fetch(`/api/menus/${initial.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/menus',           { method: 'POST',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'Gagal menyimpan.');
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="font-semibold">{initial?.id ? 'Edit menu' : 'Menu baru'}</h3>

      <div>
        <Label htmlFor="name">Nama</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      </div>

      <div>
        <Label htmlFor="category">Kategori</Label>
        <select
          id="category"
          value={category}
          onChange={(e) => setCategory(e.target.value as MenuFormValues['category'])}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800"
        >
          <option value="makanan">Makanan</option>
          <option value="nasi">Nasi & side</option>
          <option value="minuman">Minuman</option>
        </select>
      </div>

      <div>
        <Label htmlFor="price">Harga (Rp)</Label>
        <Input id="price" type="number" min={0} step={1000} value={price} onChange={(e) => setPrice(Number(e.target.value))} required />
      </div>

      <div>
        <Label htmlFor="sort_order">Urutan tampil</Label>
        <Input id="sort_order" type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
      </div>

      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>Batal</Button>
        <Button type="submit" disabled={pending || name.length === 0}>{pending ? 'Menyimpan…' : 'Simpan'}</Button>
      </div>
    </form>
  );
}
