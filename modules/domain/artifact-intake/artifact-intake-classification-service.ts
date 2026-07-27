import type { ArtifactIntakeCandidate } from "./artifact-intake-candidate";
import type { AcceptedArtifactUploadPolicy } from "./accepted-artifact-upload-policy";
import type { ArtifactIntakeFamily } from "./artifact-intake-family";

export interface ArtifactIntakeClassification {
  accepted: boolean;
  artifactFamily: ArtifactIntakeFamily;
  reason?: string;
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) {
    return "";
  }

  return fileName.slice(dot).toLowerCase();
}

const MEDIA_TYPES_BY_EXTENSION: Readonly<Record<string, readonly string[]>> = {
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".webp": ["image/webp"],
  ".txt": ["text/plain"],
  ".md": ["text/markdown"],
  ".json": ["application/json"],
  ".pdf": ["application/pdf"],
  ".doc": ["application/msword"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".rtf": ["application/rtf"],
  ".csv": ["text/csv"],
  ".tsv": ["text/tab-separated-values"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ".yaml": ["application/yaml", "text/yaml"],
  ".yml": ["application/yaml", "text/yaml"],
};

const MARKDOWN_EXTENSIONS = new Set([".md"]);
const JSON_EXTENSIONS = new Set([".json"]);
const PDF_EXTENSIONS = new Set([".pdf"]);
const DOCUMENT_EXTENSIONS = new Set([".doc", ".docx", ".rtf"]);
const SPREADSHEET_EXTENSIONS = new Set([".csv", ".tsv", ".xls", ".xlsx"]);
const TEXT_EXTENSIONS = new Set([".txt", ".yaml", ".yml"]);

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.byteLength >= signature.length
    && signature.every((value, index) => bytes[index] === value);
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function hasContentEvidence(
  extension: string,
  mediaType: string,
  bytes: Uint8Array,
): boolean {
  switch (extension) {
    case ".png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case ".jpg":
    case ".jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case ".webp":
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
        && bytes.byteLength >= 12
        && startsWith(bytes.subarray(8), [0x57, 0x45, 0x42, 0x50]);
    case ".pdf":
      return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case ".doc":
    case ".xls":
      return startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case ".docx":
    case ".xlsx":
      return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case ".rtf":
      return startsWith(bytes, [0x7b, 0x5c, 0x72, 0x74, 0x66]);
    case ".json":
      if (!isUtf8Text(bytes)) return false;
      try {
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        return true;
      } catch {
        return false;
      }
    default:
      return mediaType.startsWith("text/") || mediaType.endsWith("/yaml")
        ? isUtf8Text(bytes)
        : false;
  }
}

function classifyArtifactFamily(mediaType: string, extension: string): ArtifactIntakeFamily {
  if (mediaType === "text/markdown" || MARKDOWN_EXTENSIONS.has(extension)) {
    return "markdown";
  }

  if (mediaType === "application/json" || JSON_EXTENSIONS.has(extension)) {
    return "json";
  }

  if (mediaType === "application/pdf" || PDF_EXTENSIONS.has(extension)) {
    return "pdf";
  }

  if (
    mediaType === "application/msword"
    || mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || mediaType === "application/rtf"
    || DOCUMENT_EXTENSIONS.has(extension)
  ) {
    return "document";
  }

  if (
    mediaType === "text/csv"
    || mediaType === "text/tab-separated-values"
    || mediaType === "application/vnd.ms-excel"
    || mediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || SPREADSHEET_EXTENSIONS.has(extension)
  ) {
    return "spreadsheet";
  }

  if (mediaType.startsWith("image/")) {
    return "image";
  }

  if (
    mediaType.startsWith("text/")
    || mediaType === "application/yaml"
    || mediaType === "text/yaml"
    || TEXT_EXTENSIONS.has(extension)
  ) {
    return "text";
  }

  return "binary";
}

export function classifyArtifactIntakeCandidate(
  candidate: ArtifactIntakeCandidate,
  policy: AcceptedArtifactUploadPolicy,
): ArtifactIntakeClassification {
  if (candidate.fileName.length === 0) {
    return { accepted: false, artifactFamily: "binary", reason: "fileName must be provided." };
  }

  if (candidate.mediaType.length === 0) {
    return { accepted: false, artifactFamily: "binary", reason: "mediaType must be provided." };
  }

  if (candidate.bytesLength <= 0) {
    return { accepted: false, artifactFamily: "binary", reason: "bytes must not be empty." };
  }

  const extension = extensionOf(candidate.fileName);
  const mediaTypeAccepted = policy.acceptedMediaTypes.includes(candidate.mediaType);
  const extensionAccepted = extension.length > 0 && policy.acceptedExtensions.includes(extension);
  const artifactFamily = classifyArtifactFamily(candidate.mediaType, extension);

  if (!mediaTypeAccepted || !extensionAccepted) {
    return {
      accepted: false,
      artifactFamily,
      reason: `Artifact type is not accepted: ${candidate.mediaType}.`,
    };
  }

  if (!MEDIA_TYPES_BY_EXTENSION[extension]?.includes(candidate.mediaType)) {
    return {
      accepted: false,
      artifactFamily,
      reason: "Artifact filename extension and media type do not agree.",
    };
  }

  if (!hasContentEvidence(extension, candidate.mediaType, candidate.bytes)) {
    return {
      accepted: false,
      artifactFamily,
      reason: "Artifact content does not match its declared type.",
    };
  }

  return {
    accepted: true,
    artifactFamily,
  };
}
