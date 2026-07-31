export interface ArtifactStorageGroupingItem {
  storageKey: string;
  sourceKind?: "upload" | "generated" | string;
}

function storageKeyHasSegment(storageKey: string, segment: string): boolean {
  return storageKey.replace(/\\/g, "/").split("/").includes(segment);
}

export function isUploadedArtifact(item: ArtifactStorageGroupingItem): boolean {
  return item.sourceKind === "upload" || storageKeyHasSegment(item.storageKey, "uploads");
}

export function isGeneratedArtifact(item: ArtifactStorageGroupingItem): boolean {
  return item.sourceKind === "generated" || storageKeyHasSegment(item.storageKey, "generated");
}
