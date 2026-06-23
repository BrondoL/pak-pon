'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { compressNotaImage, preprocessNotaImage } from '@/lib/compress';
import { analyzeImageQuality, type QualityReport } from '@/lib/image-quality';
import { Button } from '@/components/ui/button';

type Stage =
  | 'idle'
  | 'analyzing'
  | 'review-quality'
  | 'preprocessing'
  | 'compressing'
  | 'uploading'
  | 'ocr'
  | 'error';

export function PhotoUploader() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      console.log(JSON.stringify({
        route: 'PhotoUploader.handleFile',
        outcome: 'rejected_not_image',
        file_type: file.type,
      }));
      setError('File harus berupa gambar (JPG/PNG).');
      setStage('error');
      return;
    }

    setError(null);
    setPreview(URL.createObjectURL(file));
    setPendingFile(file);
    setStage('analyzing');

    let report: QualityReport;
    try {
      report = await analyzeImageQuality(file);
    } catch (err) {
      console.error(JSON.stringify({
        route: 'PhotoUploader.analyze',
        outcome: 'analyze_failed',
        error: err instanceof Error ? err.message : String(err),
      }));
      // Gate failure shouldn't block — fall through to scan
      await runScan(file);
      return;
    }

    setQualityReport(report);
    if (report.warnings.length > 0) {
      setStage('review-quality');
    } else {
      await runScan(file);
    }
  }

  async function runScan(file: File) {
    const t0 = performance.now();
    const evt: Record<string, unknown> = {
      route: 'PhotoUploader.runScan',
      file_name: file.name,
      file_type: file.type,
      file_bytes: file.size,
      quality_brightness: qualityReport?.brightness,
      quality_contrast: qualityReport?.contrast,
      quality_warnings: qualityReport?.warnings,
    };

    try {
      setStage('preprocessing');
      const enhanced = await preprocessNotaImage(file);
      evt.preprocessed_bytes = enhanced.size;

      setStage('compressing');
      const compressed = await compressNotaImage(enhanced);
      evt.compressed_bytes = compressed.size;

      setStage('uploading');
      const formData = new FormData();
      formData.append('image', compressed);

      setStage('ocr');
      const res = await fetch('/api/scan', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      evt.scan_status = res.status;
      evt.scan_response = data;

      if (!res.ok) {
        throw new Error(data.error ?? 'scan-failed');
      }
      const json = data as { transaction_id: string };
      evt.outcome = 'ok';
      evt.duration_ms = Math.round(performance.now() - t0);
      console.log(JSON.stringify(evt));
      router.push(`/transactions/${json.transaction_id}/review`);
    } catch (err) {
      evt.outcome = 'error';
      evt.error_message = err instanceof Error ? err.message : String(err);
      evt.duration_ms = Math.round(performance.now() - t0);
      console.error(JSON.stringify(evt));
      setError(
        err instanceof Error
          ? `Gagal memproses foto: ${err.message}. Coba lagi.`
          : 'Gagal memproses foto. Coba lagi.'
      );
      setStage('error');
    }
  }

  async function proceedAnyway() {
    if (!pendingFile) return;
    await runScan(pendingFile);
  }

  function reset() {
    setStage('idle');
    setError(null);
    setPreview(null);
    setPendingFile(null);
    setQualityReport(null);
    if (cameraInputRef.current) cameraInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const busy =
    stage === 'analyzing' ||
    stage === 'preprocessing' ||
    stage === 'compressing' ||
    stage === 'uploading' ||
    stage === 'ocr';

  const reviewingQuality = stage === 'review-quality';

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

      {reviewingQuality && qualityReport && (
        <div
          className="rounded-md border border-mustard/40 bg-mustard-faint px-4 py-3 text-sm text-coal"
          role="alert"
        >
          <p className="font-medium">Foto kelihatan kurang ideal:</p>
          <ul className="mt-2 space-y-1">
            {qualityReport.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-coal-soft">
            Lanjut tetap bisa, tapi hasil OCR mungkin kurang akurat. Disarankan foto ulang.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={reset}>
              📷 Foto ulang
            </Button>
            <Button size="sm" onClick={proceedAnyway}>
              Lanjut tetap scan
            </Button>
          </div>
        </div>
      )}

      {busy && (
        <div
          className="flex items-center gap-3 rounded-md bg-clay-mist px-4 py-3 text-sm text-coal-soft"
          role="status"
          aria-live="polite"
        >
          <span
            className="inline-block size-4 animate-spin rounded-full border-2 border-coal-soft/30 border-t-coal-soft"
            aria-hidden
          />
          <span className="flex-1">
            {stage === 'analyzing' && 'Mengecek kualitas foto…'}
            {stage === 'preprocessing' && 'Memperbaiki kontras…'}
            {stage === 'compressing' && 'Mengompres foto…'}
            {stage === 'uploading' && 'Mengunggah ke server…'}
            {stage === 'ocr' && 'OCR sedang membaca nota… (biasanya 5–15 detik)'}
          </span>
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

      {(stage === 'error' || (preview && !busy && !reviewingQuality)) && (
        <Button variant="ghost" onClick={reset} className="w-full">
          Mulai ulang
        </Button>
      )}
    </div>
  );
}
