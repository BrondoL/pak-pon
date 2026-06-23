/**
 * Cheap client-side quality analysis untuk foto nota.
 * Downsamples image, computes brightness + contrast (luminance std-dev),
 * dan flag issue yang kemungkinan bikin OCR salah.
 *
 * Tujuan: gate SEBELUM call API ($0.0015/scan + 3-6s waktu kasir).
 */

export type QualityReport = {
  width: number;
  height: number;
  brightness: number;  // 0-255 (average luminance)
  contrast: number;    // luminance std-dev
  warnings: string[];
};

const SAMPLE_SIZE = 200;
const MIN_BRIGHTNESS = 60;
const MIN_CONTRAST = 25;
const MIN_DIMENSION = 700;

export async function analyzeImageQuality(file: File): Promise<QualityReport> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  const scale = Math.min(1, SAMPLE_SIZE / Math.max(width, height));
  const sw = Math.max(1, Math.round(width * scale));
  const sh = Math.max(1, Math.round(height * scale));

  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return { width, height, brightness: 128, contrast: 50, warnings: [] };
  }
  ctx.drawImage(bitmap, 0, 0, sw, sh);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, sw, sh);
  const n = sw * sh;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += lum;
    sumSq += lum * lum;
  }
  const brightness = sum / n;
  const variance = sumSq / n - brightness * brightness;
  const contrast = Math.sqrt(Math.max(0, variance));

  const warnings: string[] = [];
  if (brightness < MIN_BRIGHTNESS) {
    warnings.push('🔅 Foto terlalu gelap — coba pencahayaan lebih terang.');
  }
  if (contrast < MIN_CONTRAST) {
    warnings.push('💧 Foto pucat atau blur — pastikan kamera fokus.');
  }
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    warnings.push('📏 Resolusi rendah — coba dekatkan kamera ke nota.');
  }

  return { width, height, brightness, contrast, warnings };
}
