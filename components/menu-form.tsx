'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

export type MenuFormValues = {
  id?: string;
  name: string;
  category: 'makanan' | 'nasi' | 'minuman';
  price: number;
  sort_order: number;
  is_active?: boolean;
};

const categoryOptions: { value: MenuFormValues['category']; label: string }[] = [
  { value: 'makanan', label: 'Makanan' },
  { value: 'nasi',    label: 'Nasi & side' },
  { value: 'minuman', label: 'Minuman' },
];

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
        const data: { error?: string } = await res.json().catch(() => ({}));
        if (data.error === 'invalid_body') {
          throw new Error('Data tidak valid. Periksa nama, harga, dan kategori.');
        }
        if (data.error === 'unauthorized') {
          throw new Error('Sesi habis. Silakan login ulang.');
        }
        throw new Error('Gagal menyimpan. Coba lagi.');
      }
      toast.success(initial?.id ? 'Menu diperbarui' : 'Menu baru ditambah');
      onSaved();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal menyimpan. Coba lagi.';
      setError(message);
      toast.error('Gagal menyimpan menu', { description: message });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
        {/* Name */}
        <div>
          <Label htmlFor="name">Nama menu</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            placeholder="cth: Ayam Bakar"
            className="mt-2"
          />
        </div>

        {/* Category — segmented toggle, bukan native select */}
        <div>
          <Label>Kategori</Label>
          <RadioGroup
            value={category}
            onValueChange={(v) => setCategory(v as MenuFormValues['category'])}
            aria-label="Kategori menu"
            className="mt-2 inline-flex rounded-lg bg-cream p-1"
          >
            {categoryOptions.map((opt) => (
              <div key={opt.value} className="flex">
                <RadioGroupItem value={opt.value} id={`cat-${opt.value}`} className="peer sr-only" />
                <Label
                  htmlFor={`cat-${opt.value}`}
                  variant="default"
                  className={[
                    'cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                    'duration-[var(--duration-fast)]',
                    'peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-brick peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-cream',
                    'peer-data-[checked]:bg-paper-soft peer-data-[checked]:text-coal peer-data-[checked]:shadow-[var(--shadow-paper)]',
                    'text-coal-soft hover:text-coal',
                  ].join(' ')}
                >
                  {opt.label}
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        {/* Price + sort_order on one row pada wider screens */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="price">Harga (Rp)</Label>
            <Input
              id="price"
              type="number"
              min={0}
              step={1000}
              value={price}
              onChange={(e) => setPrice(Number(e.target.value))}
              required
              className="mt-2 font-display tracking-tight"
            />
          </div>
          <div>
            <Label htmlFor="sort_order">Urutan tampil</Label>
            <Input
              id="sort_order"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              className="mt-2"
            />
          </div>
        </div>

        {error && (
          <p
            className="rounded-md bg-brick-faint px-3 py-2 text-sm text-brick-dark"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={pending}>
            Batal
          </Button>
          <Button type="submit" disabled={pending || name.length === 0}>
            {pending ? 'Menyimpan…' : initial?.id ? 'Simpan perubahan' : 'Tambah menu'}
          </Button>
        </div>
      </form>
  );
}
