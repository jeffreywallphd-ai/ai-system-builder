import {
  normalizeArtifactRepoTarget,
  type ArtifactRepoTarget,
} from "./artifact-repo-target";

export interface HasArtifactInRepoRequest {
  target: ArtifactRepoTarget;
}

export function createHasArtifactInRepoRequest(
  target: ArtifactRepoTarget,
): HasArtifactInRepoRequest {
  return {
    target: normalizeArtifactRepoTarget(target),
  };
}
