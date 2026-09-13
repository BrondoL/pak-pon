import { requirePermission } from '@/lib/auth/session';
import { PrinterDebugClient } from './printer-debug-client';

export default async function PrinterDebugPage() {
  await requirePermission('setup.printer');

  return <PrinterDebugClient />;
}
