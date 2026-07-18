import {
  normalizeAssetFamily,
  normalizeAssetId,
  normalizeAssetReferenceKind,
  normalizeAssetType,
  normalizeAssetVersion,
  type AssetReference,
} from "../asset";
import { normalizeAssetDraftId } from "../asset-authoring";
import {
  ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
  normalizeAssetImplementationArtifactDescriptor,
  normalizeAssetImplementationBackingResourcePath,
  normalizeAssetImplementationBackingResourceRole,
  normalizeAssetImplementationDraftId,
  normalizeAssetSourceSnapshotId,
} from "../asset-implementation";
import { createWorkspaceId } from "../workspace";
import { ASSET_STUDIO_LIMITS } from "./asset-studio-contracts";
import {
  ASSET_STUDIO_ASSET_DRAFT_STATUSES,
  type AssetStudioAssetDraftId,
  type AssetStudioAssetDraftRecord,
  type AssetStudioSemanticDefinitionInput,
} from "./asset-studio-asset-drafts";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const SAFE_ACTOR = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/;

export function normalizeAssetStudioAssetDraftId(
  value: string,
): AssetStudioAssetDraftId {
  if (!SAFE_ID.test(value) || value.includes("..")) {
    throw new Error("Asset Studio draft id is invalid.");
  }
  return value as AssetStudioAssetDraftId;
}

export function normalizeAssetStudioExactDefinitionReference(
  value: AssetReference,
): AssetReference {
  if (
    normalizeAssetReferenceKind(value.kind) !== "asset-definition-version" ||
    value.version === undefined
  ) {
    throw new Error(
      "Asset Studio drafts require an exact definition reference.",
    );
  }
  return {
    kind: "asset-definition-version",
    id: normalizeAssetId(String(value.id)),
    version: normalizeAssetVersion(value.version),
  };
}

export function normalizeAssetStudioSemanticDefinitionInput(
  value: AssetStudioSemanticDefinitionInput,
): AssetStudioSemanticDefinitionInput {
  const displayName = requiredText(value.displayName, "Display name", 160);
  const description = requiredText(value.description, "Description", 4_000);
  const serialized = JSON.stringify(value);
  if (
    !serialized ||
    serialized.length > ASSET_STUDIO_LIMITS.maxContextCharacters
  ) {
    throw new Error("Semantic definition content exceeds the bounded limit.");
  }
  const cloned = JSON.parse(serialized) as AssetStudioSemanticDefinitionInput;
  return {
    ...cloned,
    assetType: normalizeAssetType(value.assetType),
    assetFamily: normalizeAssetFamily(value.assetFamily),
    displayName,
    description,
  };
}

export function normalizeAssetStudioAssetDraftRecord(
  value: AssetStudioAssetDraftRecord,
): AssetStudioAssetDraftRecord {
  if (!ASSET_STUDIO_ASSET_DRAFT_STATUSES.includes(value.status)) {
    throw new Error("Asset Studio draft status is invalid.");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new Error("Asset Studio draft revision is invalid.");
  }
  const artifact = normalizeAssetImplementationArtifactDescriptor(
    value.source.artifact,
  );
  if (
    artifact.kind !== "source" ||
    artifact.mediaType !== ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE
  ) {
    throw new Error("Asset Studio source artifact is invalid.");
  }
  const files = value.source.files.map((file) => {
    if (
      typeof file.mediaType !== "string" ||
      !file.mediaType.includes("/") ||
      !Number.isSafeInteger(file.sizeCharacters) ||
      file.sizeCharacters < 0 ||
      typeof file.editable !== "boolean"
    ) {
      throw new Error("Asset Studio source descriptor is invalid.");
    }
    return {
      path: normalizeAssetImplementationBackingResourcePath(file.path),
      role: normalizeAssetImplementationBackingResourceRole(file.role),
      mediaType: file.mediaType.trim(),
      sizeCharacters: file.sizeCharacters,
      editable: file.editable,
    };
  });
  if (
    files.length < 1 ||
    files.length > ASSET_STUDIO_LIMITS.maxFiles ||
    new Set(files.map((file) => file.path.toLowerCase())).size !==
      files.length ||
    !Number.isSafeInteger(value.source.totalCharacters) ||
    value.source.totalCharacters < 0 ||
    value.source.totalCharacters >
      ASSET_STUDIO_LIMITS.maxTotalSourceCharacters ||
    files.reduce((total, file) => total + file.sizeCharacters, 0) !==
      value.source.totalCharacters
  ) {
    throw new Error("Asset Studio source summary is invalid.");
  }
  const definitionRef = normalizeAssetStudioExactDefinitionReference(
    value.definitionRef,
  );
  const createdAt = timestamp(value.createdAt, "Created at");
  const updatedAt = timestamp(value.updatedAt, "Updated at");
  const createdBy = actor(value.createdBy);
  const provenance = {
    kind: "studio-from-scratch" as const,
    ...(value.provenance.sourceLegacyDraftId
      ? {
          sourceLegacyDraftId: normalizeAssetDraftId(
            value.provenance.sourceLegacyDraftId,
          ),
        }
      : {}),
    createdAt: timestamp(value.provenance.createdAt, "Provenance created at"),
    createdBy: actor(value.provenance.createdBy),
  };
  const review = value.review
    ? {
        sourceSnapshotId: normalizeAssetSourceSnapshotId(
          value.review.sourceSnapshotId,
        ),
        sourceArtifact: normalizeAssetImplementationArtifactDescriptor(
          value.review.sourceArtifact,
        ),
        materializedFromRevision: positiveRevision(
          value.review.materializedFromRevision,
          "Materialized revision",
        ),
        materializedAt: timestamp(
          value.review.materializedAt,
          "Materialized at",
        ),
        materializedBy: actor(value.review.materializedBy),
      }
    : undefined;
  const publication = value.publication
    ? {
        definitionRef: normalizeAssetStudioExactDefinitionReference(
          value.publication.definitionRef,
        ),
        implementationDraftId: normalizeAssetImplementationDraftId(
          value.publication.implementationDraftId,
        ),
        sourceSnapshotId: normalizeAssetSourceSnapshotId(
          value.publication.sourceSnapshotId,
        ),
        publishedAt: timestamp(value.publication.publishedAt, "Published at"),
        publishedBy: actor(value.publication.publishedBy),
      }
    : undefined;
  if (
    (value.status === "reviewed" && !review) ||
    (value.status === "published" && (!review || !publication)) ||
    (publication &&
      (publication.definitionRef.id !== definitionRef.id ||
        publication.definitionRef.version !== definitionRef.version))
  ) {
    throw new Error("Asset Studio draft lifecycle evidence is inconsistent.");
  }
  return {
    draftId: normalizeAssetStudioAssetDraftId(value.draftId),
    workspaceId: createWorkspaceId(value.workspaceId),
    definitionRef,
    semanticDefinition: normalizeAssetStudioSemanticDefinitionInput(
      value.semanticDefinition,
    ),
    implementationDraftId: normalizeAssetImplementationDraftId(
      value.implementationDraftId,
    ),
    source: {
      artifact,
      files,
      totalCharacters: value.source.totalCharacters,
    },
    status: value.status,
    revision: value.revision,
    provenance,
    ...(review ? { review } : {}),
    ...(publication ? { publication } : {}),
    createdAt,
    updatedAt,
    createdBy,
  };
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 1 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  const normalized = requiredText(value, label, 64);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function actor(value: string): string {
  if (!SAFE_ACTOR.test(value)) throw new Error("Actor id is invalid.");
  return value;
}

function positiveRevision(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}
