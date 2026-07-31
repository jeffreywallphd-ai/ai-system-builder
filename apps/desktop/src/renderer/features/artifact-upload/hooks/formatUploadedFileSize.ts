const BYTES_PER_MEGABYTE = 1024 * 1024;
const BYTES_PER_GIGABYTE = 1024 * BYTES_PER_MEGABYTE;

export function formatUploadedFileSize(sizeBytes: number | undefined): string {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return "unknown";
  }

  if (sizeBytes >= BYTES_PER_GIGABYTE) {
    return `${(sizeBytes / BYTES_PER_GIGABYTE).toFixed(2)} GB`;
  }

  return `${(sizeBytes / BYTES_PER_MEGABYTE).toFixed(2)} MB`;
}
