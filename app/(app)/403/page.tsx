import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PERMISSIONS } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const def = PERMISSIONS.find((x) => x.key === p);

  return (
    <div className="mx-auto max-w-lg">
      <Card variant="paper" className="px-6 py-8 text-center">
        <p className="font-body text-[11px] font-semibold uppercase tracking-[0.22em] text-clay">
          Akses ditolak
        </p>
        <h1 className="mt-3 font-display text-2xl italic leading-snug text-coal">
          Halaman ini tidak tersedia untuk akun Anda.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-coal-soft">
          {def
            ? `Dibutuhkan izin "${def.label}" — ${def.hint}.`
            : 'Akun Anda tidak punya izin untuk membuka halaman ini.'}{' '}
          Minta pemilik warung menambahkan izin ini ke role Anda.
        </p>
        <Link href="/" className="mt-6 inline-block">
          <Button>Kembali ke beranda</Button>
        </Link>
      </Card>
    </div>
  );
}
