const EXTENSION_TO_MEDIA_TYPE = new Map<string, string>([
  [".md", "text/markdown"],
  [".txt", "text/plain"],
  [".json", "application/json"],
  [".pdf", "application/pdf"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".rtf", "application/rtf"],
  [".csv", "text/csv"],
  [".tsv", "text/tab-separated-values"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".yaml", "application/yaml"],
  [".yml", "application/yaml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

function extensionOf(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  if (lastDot < 0 || lastDot === fileName.length - 1) {
    return "";
  }

  return fileName.slice(lastDot).toLowerCase();
}

export function resolveArtifactUploadMediaType(input: {
  fileName: string;
  browserMediaType: string;
}): string {
  const browserMediaType = input.browserMediaType.trim().toLowerCase();
  if (browserMediaType.length > 0) {
    return browserMediaType;
  }

  return EXTENSION_TO_MEDIA_TYPE.get(extensionOf(input.fileName)) ?? "application/octet-stream";
}
