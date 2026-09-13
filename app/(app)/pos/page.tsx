import { requirePermission } from '@/lib/auth/session';
import { getSupabaseServer } from '@/lib/supabase/server';
import { getPrinterSettings } from '@/lib/printer-settings-server';
import { fetchActiveMenusWithChips } from '@/lib/menus-server';
import { PosClient } from '@/components/pos/pos-client';

export const dynamic = 'force-dynamic';

export default async function PosPage() {
  await requirePermission('pos.use');

  const supabase = await getSupabaseServer();

  const [menus, printerSettings] = await Promise.all([
    fetchActiveMenusWithChips(supabase),
    getPrinterSettings(),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="font-display text-3xl leading-tight text-coal mb-4">
        Buat <span className="italic">pesanan</span>
      </h1>
      <PosClient menus={menus} printerSettings={printerSettings} />
    </div>
  );
}
