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
        <h2 className="text-lg font-medium">2. Buat profile &quot;Dapur&quot;</h2>
        <ol className="list-decimal space-y-1 pl-6 text-sm">
          <li>Buka RawBT</li>
          <li>Tap menu → <strong>Settings</strong> → <strong>Printers</strong></li>
          <li>Tap <strong>+</strong> (tambah)</li>
          <li>Type: <strong>Network</strong></li>
          <li>Name: <strong>Dapur</strong> (penting: harus persis &quot;Dapur&quot;)</li>
          <li>IP: alamat printer dapur (misal 192.168.1.50)</li>
          <li>Port: <strong>9100</strong></li>
          <li>Save</li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">3. Buat profile &quot;Minuman&quot;</h2>
        <p className="text-sm">Ulangi langkah 2, ganti name jadi <strong>Minuman</strong> dan IP printer minuman.</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">4. Tes printer</h2>
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
          Cek halaman diagnostic untuk lihat history print event.
        </p>
        <a href="/setup/printer/debug" className="text-sm underline">
          Buka halaman diagnostic
        </a>
      </section>
    </div>
  );
}
