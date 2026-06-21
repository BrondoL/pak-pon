'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { compressNotaImage } from '@/lib/compress';
import { Button } from '@/components/ui/button';

type Stage = 'idle' | 'compressing' | 'uploading' | 'ocr' | 'error';

export function PhotoUploader() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('File harus berupa gambar (JPG/PNG).');
      setStage('error');
      return;
    }

    setError(null);
    setPreview(URL.createObjectURL(file));

    try {
      setStage('compressing');
      const compressed = await compressNotaImage(file);

      setStage('uploading');
      const formData = new FormData();
      formData.append('image', compressed);

      setStage('ocr');
      const res = await fetch('/api/scan', { method: 'POST', body: formData });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? 'scan-failed');
      }
      const json: { transaction_id: string } = await res.json();
      router.push(`/transactions/${json.transaction_id}/review`);
    } catch (err) {
      setError(
        err instanceof Error
          ? `Gagal memproses foto: ${err.message}. Coba lagi.`
          : 'Gagal memproses foto. Coba lagi.'
      );
      setStage('error');
    }
  }

  function reset() {
    setStage('idle');
    setError(null);
    setPreview(null);
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const busy = stage === 'compressing' || stage === 'uploading' || stage === 'ocr';

  return (
    <div className="space-y-4">
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        className="hidden"
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        className="hidden"
      />

      {preview && (
        <div className="surface-paper overflow-hidden rounded-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="mx-auto max-h-96 object-contain" />
        </div>
      )}

      {!preview && (
        <div className="surface-paper rounded-2xl border-receipt p-12 text-center">
          <p className="font-display text-2xl italic text-coal">
            Siapkan nota
          </p>
          <p className="mt-2 text-sm text-coal-soft">
            Ambil foto langsung dari kamera, atau pilih dari galeri.
          </p>
        </div>
      )}

      {busy && (
        <div className="rounded-md bg-clay-mist px-4 py-3 text-sm text-coal-soft">
          {stage === 'compressing' && '📐 Mengompres foto…'}
          {stage === 'uploading' && '⬆️ Mengunggah ke server…'}
          {stage === 'ocr' && '✨ OCR sedang membaca nota… (5-15 detik)'}
        </div>
      )}

      {error && (
        <p
          className="rounded-md border border-brick/30 bg-brick-faint px-3 py-2 text-sm text-brick-dark"
          role="alert"
        >
          {error}
        </p>
      )}

      {!busy && !preview && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Button
            size="lg"
            onClick={() => cameraInputRef.current?.click()}
            className="w-full"
          >
            📷 Buka Kamera
          </Button>
          <Button
            size="lg"
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            className="w-full"
          >
            🖼️ Pilih dari Galeri
          </Button>
        </div>
      )}

      {(stage === 'error' || (preview && !busy)) && (
        <Button variant="ghost" onClick={reset} className="w-full">
          Mulai ulang
        </Button>
      )}
    </div>
  );
}
