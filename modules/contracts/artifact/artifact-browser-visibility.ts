export interface ArtifactBrowserVisibilityInput {
  readonly storageKey: string;
  readonly mediaType?: string;
  readonly originalName?: string;
}

/** Shared visibility rule for browser listings and their count projections. */
export function isArtifactBrowserVisible(source: ArtifactBrowserVisibilityInput): boolean {
  const mediaType = source.mediaType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const storageKey = source.storageKey.replace(/\\/g, "/").toLowerCase();
  const originalName = source.originalName?.trim().toLowerCase() ?? "";
  return !(mediaType.endsWith("+json") || storageKey.endsWith("+json") || originalName.endsWith("+json") || storageKey.includes("/system-builds/"));
}

export function isUploadedBrowserArtifact(source: ArtifactBrowserVisibilityInput & {readonly sourceKind?: string}): boolean {
  const segments = source.storageKey.replace(/\\/g, "/").split("/");
  return isArtifactBrowserVisible(source) && source.sourceKind !== "generated" && source.sourceKind !== "runtime" && !segments.includes("generated") && (source.sourceKind === "upload" || segments.includes("uploads"));
}
