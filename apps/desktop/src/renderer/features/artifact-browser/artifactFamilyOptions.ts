import type { DesktopArtifactFamily } from "../../lib/desktopApi";

export const ARTIFACT_BROWSER_FAMILY_OPTIONS: readonly DesktopArtifactFamily[] = [
  "image",
  "document",
  "text",
  "structured-text",
  "tabular",
  "binary",
] as const;
