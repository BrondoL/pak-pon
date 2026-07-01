import imageCompression from 'browser-image-compression';

const DEFAULT_MAX_WIDTH = 1600;

function readMaxWidth(): number {
  const raw = process.env.NEXT_PUBLIC_IMAGE_MAX_WIDTH;
  if (!raw) return DEFAULT_MAX_WIDTH;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 256 || n > 4096) return DEFAULT_MAX_WIDTH;
  return n;
}

/**
 * Compress foto nota di browser sebelum upload.
 * Default 1600px, override via NEXT_PUBLIC_IMAGE_MAX_WIDTH env var (range 256-4096).
 * Nilai lebih rendah = image tokens lebih sedikit di Gemini tapi risk accuracy drop
 * untuk handwritten qty (pensil tipis).
 * Dipanggil dari PhotoUploader sebelum POST /api/scan.
 */
export async function compressNotaImage(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: 0.5,
    maxWidthOrHeight: readMaxWidth(),
    useWebWorker: true,
    fileType: 'image/jpeg',
    initialQuality: 0.8,
  });
}

// Exported for tests only — do not use in production code.
export const __readMaxWidthForTest = readMaxWidth;

const STRETCH_SKIP_RANGE = 220; // if all channels already span >=220, no-op

/**
 * Light-touch preprocessing: auto-levels (histogram stretch per RGB channel).
 * Normalizes exposure without aggressive transforms — tetap kelihatan natural
 * supaya Gemini tidak bingung (model dilatih dengan foto biasa, bukan threshold).
 * Idempotent: foto yang sudah terexposed bagus akan di-return apa adanya.
 */
export async function preprocessNotaImage(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Sample every 10th pixel for min/max (fast)
  let minR = 255, maxR = 0;
  let minG = 255, maxG = 0;
  let minB = 255, maxB = 0;
  for (let i = 0; i < data.length; i += 40) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    if (g < minG) minG = g;
    if (g > maxG) maxG = g;
    if (b < minB) minB = b;
    if (b > maxB) maxB = b;
  }

  const rRange = maxR - minR;
  const gRange = maxG - minG;
  const bRange = maxB - minB;
  if (rRange >= STRETCH_SKIP_RANGE && gRange >= STRETCH_SKIP_RANGE && bRange >= STRETCH_SKIP_RANGE) {
    return file;
  }

  const sR = 255 / Math.max(1, rRange);
  const sG = 255 / Math.max(1, gRange);
  const sB = 255 / Math.max(1, bRange);
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = Math.min(255, Math.max(0, (data[i]     - minR) * sR));
    data[i + 1] = Math.min(255, Math.max(0, (data[i + 1] - minG) * sG));
    data[i + 2] = Math.min(255, Math.max(0, (data[i + 2] - minB) * sB));
  }

  ctx.putImageData(imageData, 0, 0);
  try {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    return new File([blob], file.name, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
