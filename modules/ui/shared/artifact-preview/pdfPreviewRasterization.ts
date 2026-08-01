export const ARTIFACT_PDF_PREVIEW_MAX_BYTES = 32 * 1024 * 1024;

const PDF_PREVIEW_MAX_EDGE_PIXELS = 1_400;
const PDF_PREVIEW_MAX_CANVAS_PIXELS = 2_000_000;
function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("PDF preview image could not be prepared."));
    }, "image/png");
  });
}

export async function createPdfFirstPagePreviewObjectUrl(
  bytes: Uint8Array,
): Promise<string> {
  if (bytes.byteLength === 0 || bytes.byteLength > ARTIFACT_PDF_PREVIEW_MAX_BYTES) {
    throw new Error("PDF preview bytes are outside the supported limit.");
  }
  const [pdfjs, workerAsset] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerAsset.default;
  const loadingTask = pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
    useSystemFonts: true,
  });
  try {
    const document = await loadingTask.promise;
    if (document.numPages < 1) {
      throw new Error("PDF has no previewable pages.");
    }
    const page = await document.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const edgeScale =
      PDF_PREVIEW_MAX_EDGE_PIXELS /
      Math.max(baseViewport.width, baseViewport.height);
    const pixelScale = Math.sqrt(
      PDF_PREVIEW_MAX_CANVAS_PIXELS /
        Math.max(1, baseViewport.width * baseViewport.height),
    );
    const scale = Math.min(1.5, edgeScale, pixelScale);
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new Error("PDF page dimensions are invalid.");
    }
    const viewport = page.getViewport({ scale });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({
      canvas,
      viewport,
      annotationMode: pdfjs.AnnotationMode.DISABLE,
      background: "rgb(255,255,255)",
    }).promise;
    page.cleanup();
    return URL.createObjectURL(await canvasToPngBlob(canvas));
  } finally {
    await loadingTask.destroy();
  }
}
