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
