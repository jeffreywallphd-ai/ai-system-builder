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
  repositoryCreation?: ArtifactRepositoryCreationPolicy;
}

export interface ArtifactRepositoryCreationPolicy {
  readonly approved: true;
  readonly visibility: "private" | "public";
}

export function createStoreArtifactInRepoRequest(
  content: Uint8Array,
  options: {
    target: ArtifactRepoTarget;
    mediaType?: string;
    metadata?: Readonly<Record<string, unknown>>;
    overwrite?: boolean;
    repositoryCreation?: ArtifactRepositoryCreationPolicy;
  },
): StoreArtifactInRepoRequest {
  const repositoryCreation = normalizeRepositoryCreationPolicy(options.repositoryCreation);
  return {
    target: normalizeArtifactRepoTarget(options.target),
    content,
    mediaType: options.mediaType,
    metadata: options.metadata,
    overwrite: options.overwrite,
    ...(repositoryCreation ? { repositoryCreation } : {}),
  };
}

function normalizeRepositoryCreationPolicy(
  value: ArtifactRepositoryCreationPolicy | undefined,
): ArtifactRepositoryCreationPolicy | undefined {
  if (!value) return undefined;
  if (value.approved !== true) {
    throw new Error("Repository creation requires explicit approval.");
  }
  if (value.visibility !== "private" && value.visibility !== "public") {
    throw new Error("Repository creation visibility must be private or public.");
  }
  return { approved: true, visibility: value.visibility };
}
