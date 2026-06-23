'use client';

import { useState } from 'react';
import { TestPrintDialog } from '@/components/test-print-dialog';

export default function SetupPrinterPage() {
  const [activeTest, setActiveTest] = useState<'dapur' | 'minuman' | null>(null);

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-semibold">Setup Printer</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">1. Install aplikasi RawBT</h2>
        <p className="text-sm text-coal-soft">
          RawBT adalah aplikasi gratis untuk Android yang menyambungkan web app ini ke printer thermal LAN.
        </p>
        <a
          href="https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter"
          target="_blank"
          rel="noreferrer"
          className="inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          Buka Play Store
        </a>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">2. Setup printer di RawBT</h2>
        <div className="rounded-md border border-gold-dark/30 bg-mustard-faint p-3 text-sm text-coal-soft">
          <strong className="text-coal">⚠ Catatan penting:</strong> RawBT cuma support 1 printer default per app.
          Untuk sekarang, setup <strong>1 printer dulu</strong> (mis. printer dapur). Semua print job
          (dapur + minuman) akan keluar di printer ini. Multi-printer simultan akan kita atur dengan
          solusi terpisah nanti.
        </div>
        <ol className="list-decimal space-y-1 pl-6 text-sm">
          <li>Buka RawBT</li>
          <li>Tap menu → <strong>Settings</strong> → <strong>Printers</strong></li>
          <li>Tap <strong>+</strong> (tambah)</li>
          <li>Type: <strong>Network</strong></li>
          <li>Name: bebas (mis. <strong>Dapur</strong>)</li>
          <li>IP: alamat printer (misal 192.168.1.50)</li>
          <li>Port: <strong>9100</strong></li>
          <li>Save → set sebagai <strong>default printer</strong></li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">3. Tes printer</h2>
        {activeTest === null && (
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTest('dapur')}
              className="flex-1 rounded-md border border-clay-soft px-4 py-2 text-coal"
            >
              Tes Printer Dapur
            </button>
            <button
              onClick={() => setActiveTest('minuman')}
              className="flex-1 rounded-md border border-clay-soft px-4 py-2 text-coal"
            >
              Tes Printer Minuman
            </button>
          </div>
        )}
        {activeTest && (
          <TestPrintDialog
            target={activeTest}
            onClose={() => setActiveTest(null)}
          />
        )}
      </section>

      <section className="space-y-3 pt-4 border-t border-clay-soft">
        <h2 className="text-lg font-medium">Bermasalah?</h2>
        <p className="text-sm text-coal-soft">
          Kalau pas tap &quot;Cetak Tes Sekarang&quot; aplikasi RawBT gak ke-buka, kemungkinan:
          (1) RawBT belum di-install, (2) RawBT di-disable di setting Android,
          atau (3) ada masalah handler URL <code className="bg-clay-mist px-1">rawbt:</code>.
          Coba uninstall + install ulang RawBT dari Play Store.
        </p>
        <p className="text-sm text-coal-soft">
          Cek halaman diagnostic untuk lihat history print event.
        </p>
        <a href="/setup/printer/debug" className="text-sm underline">
          Buka halaman diagnostic
        </a>
      </section>
    </div>
  );
}
