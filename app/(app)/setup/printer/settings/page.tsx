import { getPrinterSettings } from '@/lib/printer-settings-server';
import { PrinterSettingsForm } from './printer-settings-form';

export const dynamic = 'force-dynamic';

export default async function PrinterSettingsPage() {
  const settings = await getPrinterSettings();
  return (
    <div className="mx-auto max-w-2xl p-4 space-y-6">
      <div>
        <h1 className="font-display text-2xl text-coal">Setting Printer</h1>
        <p className="mt-1 text-sm text-coal-soft">
          Pengaturan format struk yang dicetak. Disimpan di web — ga perlu update agent.
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs">
          <a href="/setup/printer" className="text-coal-soft underline hover:text-coal">
            Belum install agent? Lihat panduan →
          </a>
          <a href="/setup/printer/debug" className="text-coal-soft underline hover:text-coal">
            Diagnostic →
          </a>
        </div>
      </div>
      <PrinterSettingsForm initial={settings} />
    </div>
  );
}
