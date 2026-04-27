import {
  normalizeArtifactRepoTarget,
  type ArtifactRepoTarget,
} from "./artifact-repo-target";

export interface RetrieveArtifactFromRepoRequest {
  target: ArtifactRepoTarget;
}

export function createRetrieveArtifactFromRepoRequest(
  target: ArtifactRepoTarget,
): RetrieveArtifactFromRepoRequest {
  return {
    target: normalizeArtifactRepoTarget(target),
  };
}
