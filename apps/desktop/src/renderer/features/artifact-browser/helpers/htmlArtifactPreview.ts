export const HTML_ARTIFACT_PREVIEW_MAX_CHARS = 50_000;

export function decodeHtmlArtifactPreview(bytes: Uint8Array, maxChars = HTML_ARTIFACT_PREVIEW_MAX_CHARS): string {
  return new TextDecoder().decode(bytes).slice(0, maxChars);
}
