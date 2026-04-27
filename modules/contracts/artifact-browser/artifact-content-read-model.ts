import {
  normalizeArtifactBrowserLocator,
  type ArtifactBrowserLocator,
} from "./artifact-browser-locator";

export const ARTIFACT_CONTENT_AVAILABILITIES = ["available", "unavailable"] as const;

export type ArtifactContentAvailability =
  (typeof ARTIFACT_CONTENT_AVAILABILITIES)[number];

export const ARTIFACT_CONTENT_RETRIEVAL_KINDS = ["inline", "deferred"] as const;

export type ArtifactContentRetrievalKind =
  (typeof ARTIFACT_CONTENT_RETRIEVAL_KINDS)[number];

export interface ArtifactContentReadModel {
  locator: ArtifactBrowserLocator;
  mediaType?: string;
  sizeBytes?: number;
  availability: ArtifactContentAvailability;
  retrieval: ArtifactContentRetrievalKind;
}

export interface ArtifactContentReadSuccessValue {
  content: ArtifactContentReadModel;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeArtifactContentAvailability(
  value: ArtifactContentAvailability,
): ArtifactContentAvailability {
  if ((ARTIFACT_CONTENT_AVAILABILITIES as readonly string[]).includes(value)) {
    return value;
  }

  throw new Error(
    `Artifact content availability must be one of ${ARTIFACT_CONTENT_AVAILABILITIES.join(", ")}. Received "${value}".`,
  );
}

function normalizeArtifactContentRetrievalKind(
  value: ArtifactContentRetrievalKind,
): ArtifactContentRetrievalKind {
  if ((ARTIFACT_CONTENT_RETRIEVAL_KINDS as readonly string[]).includes(value)) {
    return value;
  }

  throw new Error(
    `Artifact content retrieval kind must be one of ${ARTIFACT_CONTENT_RETRIEVAL_KINDS.join(", ")}. Received "${value}".`,
  );
}

export function normalizeArtifactContentReadModel(
  model: ArtifactContentReadModel,
): ArtifactContentReadModel {
  return {
    ...model,
    locator: normalizeArtifactBrowserLocator(model.locator),
    mediaType: normalizeOptionalText(model.mediaType),
    availability: normalizeArtifactContentAvailability(model.availability),
    retrieval: normalizeArtifactContentRetrievalKind(model.retrieval),
  };
}

export function normalizeArtifactContentReadSuccessValue(
  value: ArtifactContentReadSuccessValue,
): ArtifactContentReadSuccessValue {
  return {
    content: normalizeArtifactContentReadModel(value.content),
  };
}
