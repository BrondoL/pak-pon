import imageCompression from 'browser-image-compression';

/**
 * Compress foto nota di browser sebelum upload.
 * Target: 1600px max dimension, JPEG quality 0.8 → biasanya 200-500 KB dari 3-5 MB asli.
 * Dipanggil dari PhotoUploader sebelum POST /api/scan.
 */
export async function compressNotaImage(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: 0.5,
    maxWidthOrHeight: 1600,
    useWebWorker: true,
    fileType: 'image/jpeg',
    initialQuality: 0.8,
  });
}
