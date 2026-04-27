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

const MARKDOWN_EXTENSIONS = new Set([".md"]);
const JSON_EXTENSIONS = new Set([".json"]);
const PDF_EXTENSIONS = new Set([".pdf"]);
const DOCUMENT_EXTENSIONS = new Set([".doc", ".docx", ".rtf"]);
const SPREADSHEET_EXTENSIONS = new Set([".csv", ".tsv", ".xls", ".xlsx"]);
const TEXT_EXTENSIONS = new Set([".txt", ".yaml", ".yml"]);

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

  if (!mediaTypeAccepted && !extensionAccepted) {
    return {
      accepted: false,
      artifactFamily,
      reason: `Artifact type is not accepted: ${candidate.mediaType}.`,
    };
  }

  return {
    accepted: true,
    artifactFamily,
  };
}
