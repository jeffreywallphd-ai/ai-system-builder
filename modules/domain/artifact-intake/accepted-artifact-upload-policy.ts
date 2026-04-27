export interface AcceptedArtifactUploadPolicy {
  acceptedMediaTypes: readonly string[];
  acceptedExtensions: readonly string[];
}

export function normalizeAcceptedArtifactUploadPolicy(
  policy: AcceptedArtifactUploadPolicy,
): AcceptedArtifactUploadPolicy {
  return {
    acceptedMediaTypes: Array.from(new Set(policy.acceptedMediaTypes.map((value) => value.trim().toLowerCase()))),
    acceptedExtensions: Array.from(
      new Set(
        policy.acceptedExtensions.map((value) => {
          const normalized = value.trim().toLowerCase();
          return normalized.startsWith(".") ? normalized : `.${normalized}`;
        }),
      ),
    ),
  };
}

export function createDefaultAcceptedArtifactUploadPolicy(): AcceptedArtifactUploadPolicy {
  return normalizeAcceptedArtifactUploadPolicy({
    acceptedMediaTypes: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "text/plain",
      "text/markdown",
      "text/csv",
      "text/tab-separated-values",
      "application/json",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/rtf",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/yaml",
      "text/yaml",
    ],
    acceptedExtensions: [
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
      ".txt",
      ".md",
      ".json",
      ".pdf",
      ".doc",
      ".docx",
      ".rtf",
      ".csv",
      ".tsv",
      ".xls",
      ".xlsx",
      ".yaml",
      ".yml",
    ],
  });
}
