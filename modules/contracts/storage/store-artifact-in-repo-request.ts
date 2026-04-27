import {
  normalizeArtifactRepoTarget,
  type ArtifactRepoTarget,
} from "./artifact-repo-target";

export interface StoreArtifactInRepoRequest {
  target: ArtifactRepoTarget;
  content: Uint8Array;
  mediaType?: string;
  metadata?: Readonly<Record<string, unknown>>;
  overwrite?: boolean;
}

export function createStoreArtifactInRepoRequest(
  content: Uint8Array,
  options: {
    target: ArtifactRepoTarget;
    mediaType?: string;
    metadata?: Readonly<Record<string, unknown>>;
    overwrite?: boolean;
  },
): StoreArtifactInRepoRequest {
  return {
    target: normalizeArtifactRepoTarget(options.target),
    content,
    mediaType: options.mediaType,
    metadata: options.metadata,
    overwrite: options.overwrite,
  };
}
