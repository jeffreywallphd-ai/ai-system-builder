/** Protocol support is not installed-engine or language readiness. */
export const DATASET_PREPARATION_OCR_CAPABILITY =
  "dataset-preparation.staged-pdf-ocr-v1";
export const DATASET_PREPARATION_OCR_PROTOCOL = "staged-pdf-ocr-v1";
export const DATASET_PREPARATION_OCR_MAX_SOURCE_BYTES = 16 * 1024 ** 2;
export const DATASET_PREPARATION_OCR_MAX_FILE_NAME_LENGTH = 240;

/** Application-compiled from authorized bytes; never a public command option. */
export interface DatasetPreparationOcrSourceBinding {
  artifactId: string;
  /** Generated direct child of runtimeWorkingDirectory, not an input path. */
  fileName: string;
  byteLength: number;
  /** Exactly 64 lowercase hexadecimal characters, without an algorithm prefix. */
  sha256: string;
}

export interface DatasetPreparationRuntimeOcrSources {
  protocol: typeof DATASET_PREPARATION_OCR_PROTOCOL;
  /** Exactly one entry per selected PDF, in the same order; maximum 256. */
  sources: DatasetPreparationOcrSourceBinding[];
}

/** Syntax only. The provider must separately check installed language support. */
export function isDatasetPreparationOcrLanguage(value: unknown): value is string {
  return typeof value === "string" && value.length <= 35 &&
    /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(value);
}

export function isDatasetPreparationOcrArtifactId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512 &&
    !/[\u0000-\u001f\ud800-\udfff]/u.test(value);
}

export function supportsDatasetPreparationOcr(capabilities: unknown): boolean {
  return Array.isArray(capabilities) &&
    capabilities.every((value) => typeof value === "string") &&
    capabilities.includes(DATASET_PREPARATION_OCR_CAPABILITY);
}

export type DatasetPreparationOcrChoiceResolution =
  | { ok: true; content?: { ocrEnabled: true; ocrLanguage: string } }
  | { ok: false; message: string };

/** Form/request convenience. Application authorization and worker checks still apply. */
export function resolveDatasetPreparationOcrChoice(input: {
  enabled?: unknown;
  language?: unknown;
  method?: unknown;
  sourceCount: number;
  sourceFormats?: readonly string[];
}): DatasetPreparationOcrChoiceResolution {
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    return {
      ok: false,
      message: "The saved text recognition choice is invalid. Turn it off or choose it again.",
    };
  }
  if (input.enabled !== true) return { ok: true };
  if (input.method !== "structure-aware") {
    return {
      ok: false,
      message: "Choose Document-structure sections for scanned PDFs, or turn off text recognition.",
    };
  }
  if (
    !Number.isSafeInteger(input.sourceCount) ||
    input.sourceCount < 1 ||
    input.sourceCount > 256 ||
    !Array.isArray(input.sourceFormats) ||
    input.sourceFormats.length !== input.sourceCount ||
    input.sourceFormats.some((format) => format !== "pdf")
  ) {
    return {
      ok: false,
      message: "Select only PDF files for text recognition. Select at most 256 files.",
    };
  }
  if (!isDatasetPreparationOcrLanguage(input.language)) {
    return {
      ok: false,
      message: "Enter the exact installed Windows language tag, such as en-US, without spaces.",
    };
  }
  return {
    ok: true,
    content: { ocrEnabled: true, ocrLanguage: input.language },
  };
}
