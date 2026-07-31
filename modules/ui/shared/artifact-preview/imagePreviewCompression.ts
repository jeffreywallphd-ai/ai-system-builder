export interface CompressedImagePreviewOptions {
  readonly maxEdgePixels?: number;
  readonly quality?: number;
  readonly outputType?: string;
}

const DEFAULT_MAX_EDGE_PIXELS = 960;
const DEFAULT_QUALITY = 0.72;
const DEFAULT_OUTPUT_TYPE = "image/webp";

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = bytes.slice();
  return copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
}

function loadImageFromObjectUrl(sourceUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image preview could not be loaded."));
    image.src = sourceUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error("Image preview could not be compressed."));
    }, type, quality);
  });
}

function getScaledDimensions(width: number, height: number, maxEdgePixels: number): { width: number; height: number } {
  const largestEdge = Math.max(width, height);
  if (!Number.isFinite(largestEdge) || largestEdge <= maxEdgePixels) {
    return { width, height };
  }

  const scale = maxEdgePixels / largestEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function createCompressedImagePreviewObjectUrl(
  bytes: Uint8Array,
  mediaType?: string,
  options: CompressedImagePreviewOptions = {},
): Promise<string> {
  const sourceBlob = new Blob([copyBytesToArrayBuffer(bytes)], {
    type: mediaType?.startsWith("image/") ? mediaType : "image/png",
  });
  const sourceUrl = URL.createObjectURL(sourceBlob);

  try {
    const image = await loadImageFromObjectUrl(sourceUrl);
    const dimensions = getScaledDimensions(
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
      options.maxEdgePixels ?? DEFAULT_MAX_EDGE_PIXELS,
    );
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Image preview could not be prepared.");
    }

    context.drawImage(image, 0, 0, dimensions.width, dimensions.height);
    const compressedBlob = await canvasToBlob(
      canvas,
      options.outputType ?? DEFAULT_OUTPUT_TYPE,
      options.quality ?? DEFAULT_QUALITY,
    );

    return URL.createObjectURL(compressedBlob);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
