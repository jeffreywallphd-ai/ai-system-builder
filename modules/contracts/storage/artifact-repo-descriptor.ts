import {
  normalizeArtifactRepoTarget,
  type ArtifactRepoTarget,
} from "./artifact-repo-target";
import type { StorageObjectChecksum } from "./storage-object-descriptor";

export interface ArtifactRepoDescriptor {
  target: ArtifactRepoTarget;
  mediaType?: string;
  sizeBytes?: number;
  checksum?: StorageObjectChecksum;
}

export function normalizeArtifactRepoDescriptor(
  descriptor: ArtifactRepoDescriptor,
): ArtifactRepoDescriptor {
  return {
    ...descriptor,
    target: normalizeArtifactRepoTarget(descriptor.target),
  };
}
