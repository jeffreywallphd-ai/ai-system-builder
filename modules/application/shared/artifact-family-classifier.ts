import type { ArtifactFamily } from "../../domain/artifact";

const DOCUMENT_EXTENSIONS = new Set(["pdf", "doc", "docx", "rtf"]);
const TEXT_EXTENSIONS = new Set(["txt", "md"]);
const STRUCTURED_TEXT_EXTENSIONS = new Set(["json", "yaml", "yml"]);
const TABULAR_EXTENSIONS = new Set(["csv", "tsv", "xls", "xlsx", "parquet"]);

const DOCUMENT_MEDIA_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/rtf",
  "text/rtf",
]);

const STRUCTURED_TEXT_MEDIA_TYPES = new Set([
  "application/json",
  "application/yaml",
  "application/x-yaml",
  "text/yaml",
  "text/x-yaml",
]);

const TABULAR_MEDIA_TYPES = new Set([
  "text/csv",
  "text/tab-separated-values",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/x-parquet",
]);

function normalizeExtension(extensionOrName: string | undefined): string | undefined {
  if (typeof extensionOrName !== "string") {
    return undefined;
  }

  const trimmed = extensionOrName.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!trimmed.includes(".")) {
    return trimmed.toLowerCase();
  }

  const slashNormalized = trimmed.replace(/\\/g, "/");
  const fileName = slashNormalized.slice(slashNormalized.lastIndexOf("/") + 1);
  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex <= 0 || lastDotIndex >= fileName.length - 1) {
    return undefined;
  }

  return fileName.slice(lastDotIndex + 1).toLowerCase();
}

export function resolveArtifactFamily(input: {
  mediaType?: string;
  extension?: string;
  fileName?: string;
}): ArtifactFamily {
  const mediaType = input.mediaType?.trim().toLowerCase();
  const extension = normalizeExtension(input.extension ?? input.fileName);

  if (mediaType?.startsWith("image/")) {
    return "image";
  }

  if (mediaType && DOCUMENT_MEDIA_TYPES.has(mediaType)) {
    return "document";
  }

  if (mediaType === "text/plain" || mediaType === "text/markdown") {
    return "text";
  }

  if (mediaType && STRUCTURED_TEXT_MEDIA_TYPES.has(mediaType)) {
    return "structured-text";
  }

  if (mediaType && TABULAR_MEDIA_TYPES.has(mediaType)) {
    return "tabular";
  }

  if (mediaType?.startsWith("text/")) {
    return "text";
  }

  if (extension && DOCUMENT_EXTENSIONS.has(extension)) {
    return "document";
  }

  if (extension && TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }

  if (extension && STRUCTURED_TEXT_EXTENSIONS.has(extension)) {
    return "structured-text";
  }

  if (extension && TABULAR_EXTENSIONS.has(extension)) {
    return "tabular";
  }

  return "binary";
}
