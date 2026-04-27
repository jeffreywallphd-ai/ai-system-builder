import type { PublishedBackingView } from "./useArtifactBrowserPublishLogic";

export interface ArtifactBrowserStateBackingMetadata {
  importedSourceBacking?: PublishedBackingView;
  publishedBacking?: PublishedBackingView;
}

export interface ArtifactBrowserStateDetail {
  locator: { storageKey: string };
  metadata?: ArtifactBrowserStateBackingMetadata;
}

export interface ArtifactBrowserStateContent {
  availability: "available" | "unavailable";
  retrieval: "inline" | "deferred";
}

export interface ArtifactBrowserBackingState {
  hasImportedSourceBacking: boolean;
  hasPublishedBacking: boolean;
  hasLocalObjectAvailable: boolean;
  isLocalized: boolean;
  isRemoteOnly: boolean;
}

export function deriveArtifactBackingState(
  detail: ArtifactBrowserStateDetail | undefined,
  content: ArtifactBrowserStateContent | undefined,
): ArtifactBrowserBackingState {
  const hasImportedSourceBacking = Boolean(detail?.metadata?.importedSourceBacking);
  const hasPublishedBacking = Boolean(detail?.metadata?.publishedBacking);
  const hasLocalObjectAvailable = content?.availability === "available";
  const isLocalized = hasImportedSourceBacking && hasLocalObjectAvailable;
  const isRemoteOnly = hasImportedSourceBacking && !hasLocalObjectAvailable;

  return {
    hasImportedSourceBacking,
    hasPublishedBacking,
    hasLocalObjectAvailable,
    isLocalized,
    isRemoteOnly,
  };
}

export function deriveArtifactListStatusLabels(state: ArtifactBrowserBackingState): string[] {
  const labels: string[] = [];
  if (state.isRemoteOnly) {
    labels.push("Remote only");
  }
  if (state.isLocalized) {
    labels.push("Localized");
  }
  if (state.hasPublishedBacking) {
    labels.push("Published");
  }
  if (!state.hasImportedSourceBacking && state.hasLocalObjectAvailable) {
    labels.push("Local");
  }

  return labels;
}
