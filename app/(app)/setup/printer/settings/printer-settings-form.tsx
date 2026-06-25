'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import type { PrinterSettings } from '@/lib/printer-settings';
import { charsPerLine } from '@/lib/printer-settings';
import { savePrinterSettings, type SettingsState } from './actions';

const initialState: SettingsState = {};

export function PrinterSettingsForm({ initial }: { initial: PrinterSettings }) {
  const [state, action, pending] = useActionState(savePrinterSettings, initialState);
  const [paperWidth, setPaperWidth] = useState(initial.paper_width);
  const [cutMode, setCutMode] = useState(initial.cut_mode);

  useEffect(() => {
    if (state.ok) toast.success('Setting tersimpan');
    if (state.error) toast.error(`Gagal simpan: ${state.error}`);
  }, [state]);

  return (
    <form action={action} className="space-y-6">
      <Card variant="paper" className="p-5 space-y-5">
        <div className="space-y-2">
          <Label>Lebar kertas</Label>
          <RadioGroup
            name="paper_width"
            value={paperWidth}
            onValueChange={(v) => setPaperWidth(v as PrinterSettings['paper_width'])}
            className="grid grid-cols-2 gap-3"
          >
            <label className="flex items-start gap-3 rounded-md border border-clay-soft p-3 cursor-pointer hover:bg-paper-soft">
              <RadioGroupItem value="58mm" className="mt-0.5" />
              <span>
                <span className="block font-medium text-coal">58mm</span>
                <span className="block text-xs text-coal-soft">32 karakter / baris</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-md border border-clay-soft p-3 cursor-pointer hover:bg-paper-soft">
              <RadioGroupItem value="80mm" className="mt-0.5" />
              <span>
                <span className="block font-medium text-coal">80mm</span>
                <span className="block text-xs text-coal-soft">48 karakter / baris</span>
              </span>
            </label>
          </RadioGroup>
          <p className="text-xs text-coal-soft">
            Lebar separator otomatis menyesuaikan ({charsPerLine(paperWidth)} karakter).
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="feed_lines_before_cut">Feed lines sebelum cut</Label>
          <Input
            id="feed_lines_before_cut"
            name="feed_lines_before_cut"
            type="number"
            min={0}
            max={8}
            step={1}
            defaultValue={initial.feed_lines_before_cut}
            className="w-24"
          />
          <p className="text-xs text-coal-soft">
            Berapa baris kosong sebelum kertas dipotong. Naikkan kalau posisi sobek kepotong isi tiket. Range 0-8.
          </p>
        </div>

        <div className="space-y-2">
          <Label>Cut mode</Label>
          <RadioGroup
            name="cut_mode"
            value={cutMode}
            onValueChange={(v) => setCutMode(v as PrinterSettings['cut_mode'])}
            className="grid gap-2"
          >
            <label className="flex items-start gap-3 rounded-md border border-clay-soft p-3 cursor-pointer hover:bg-paper-soft">
              <RadioGroupItem value="full" className="mt-0.5" />
              <span>
                <span className="block font-medium text-coal">Full cut</span>
                <span className="block text-xs text-coal-soft">Potong penuh (default).</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-md border border-clay-soft p-3 cursor-pointer hover:bg-paper-soft">
              <RadioGroupItem value="partial" className="mt-0.5" />
              <span>
                <span className="block font-medium text-coal">Partial cut</span>
                <span className="block text-xs text-coal-soft">Sisain sedikit nyambung — tiket gampang dipisah satu-satu.</span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-md border border-clay-soft p-3 cursor-pointer hover:bg-paper-soft">
              <RadioGroupItem value="none" className="mt-0.5" />
              <span>
                <span className="block font-medium text-coal">No cut (feed only)</span>
                <span className="block text-xs text-coal-soft">Skip command cut — buat printer murah yang ga punya auto-cutter, sobek manual.</span>
              </span>
            </label>
          </RadioGroup>
        </div>
      </Card>

      <Card variant="paper" className="p-5 space-y-5">
        <h2 className="font-display text-lg text-coal">Optional</h2>

        <div className="space-y-2">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              name="beep_on_print"
              defaultChecked={initial.beep_on_print}
              className="mt-0.5 h-4 w-4 rounded border-clay-soft"
            />
            <span>
              <span className="block font-medium text-coal">Beep buzzer pas print</span>
              <span className="block text-xs text-coal-soft">
                Printer bunyi 3x pas terima tiket. Bagus buat warung rame — dapur denger ada order masuk.
              </span>
            </span>
          </label>
        </div>

        <div className="space-y-2">
          <Label htmlFor="header_text">Header text</Label>
          <Input
            id="header_text"
            name="header_text"
            type="text"
            maxLength={80}
            defaultValue={initial.header_text ?? ''}
            placeholder="cth: PECEL LELE PAK PON"
          />
          <p className="text-xs text-coal-soft">
            Tulisan custom di atas DAPUR/MINUMAN. Kosongin kalau ga perlu. Max 80 karakter.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="footer_text">Footer text (nota customer)</Label>
          <Textarea
            id="footer_text"
            name="footer_text"
            defaultValue={initial.footer_text}
            maxLength={200}
            rows={3}
            placeholder="cth: Terima kasih atas kunjungan Anda&#10;~ Pak Pon ~"
          />
          <p className="text-xs text-coal-soft">
            Hanya dicetak di nota customer (yang tampil harga + total). Kosongkan kalau tidak perlu. Max 200 karakter, multi-baris diperbolehkan.
          </p>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </div>
    </form>
  );
}
