import {
  normalizeAssetId,
  normalizeAssetReferenceKind,
  type AssetReference,
} from "../asset";
import { createWorkspaceId } from "../workspace";
import { createOrganizationId } from "../organization";
import {
  normalizeAssetImplementationArtifactId,
  normalizeAssetImplementationBindingId,
  normalizeAssetImplementationBuildId,
  normalizeAssetImplementationDraftId,
  normalizeAssetImplementationFacetId,
  normalizeAssetImplementationReleaseId,
  normalizeAssetImplementationRevocationId,
  normalizeAssetSourceSnapshotId,
} from "./asset-implementation-identity";
import {
  normalizeAssetImplementationArtifactKind,
  normalizeSha256Digest,
  type AssetImplementationArtifactDescriptor,
} from "./asset-implementation-artifact";
import {
  normalizeAssetImplementationBindingStatus,
  normalizeAssetImplementationBuildStatus,
  normalizeAssetImplementationDeploymentProfile,
  normalizeAssetImplementationDraftStatus,
  normalizeAssetImplementationFacetKind,
  normalizeAssetImplementationReleaseStatus,
  normalizeAssetImplementationRuntimeKind,
  normalizeAssetImplementationTrustLevel,
} from "./asset-implementation-enums";
import type {
  AssetImplementationBinding,
  AssetImplementationBuild,
  AssetImplementationCompatibility,
  AssetImplementationDiagnostic,
  AssetImplementationDraft,
  AssetImplementationFacet,
  AssetImplementationRelease,
  AssetImplementationRevocation,
  AssetSourceSnapshot,
} from "./asset-implementation-models";
import type { AssetImplementationResolutionRequest } from "./asset-implementation-resolution";

const SAFE_TEXT_PATTERN = /^[^\u0000-\u001f\u007f]{1,512}$/;
const SAFE_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const VERSION_RANGE_PATTERN = /^(?:\^|~|>=|<=|>|<|=|\s|\d|\.|-|\*|x)+$/i;

function text(value: unknown, label: string, maximum = 512): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length > maximum ||
    !SAFE_TEXT_PATTERN.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function key(value: unknown, label: string): string {
  const normalized = text(value, label, 160);
  if (!SAFE_KEY_PATTERN.test(normalized) || normalized.includes(".."))
    throw new Error(`${label} is invalid.`);
  return normalized;
}

function timestamp(value: unknown, label: string): string {
  const normalized = text(value, label, 64);
  if (!Number.isFinite(Date.parse(normalized)))
    throw new Error(`${label} is invalid.`);
  return normalized;
}

function semver(value: unknown, label: string): string {
  const normalized = text(value, label, 80);
  if (!SEMVER_PATTERN.test(normalized))
    throw new Error(`${label} must be semantic version syntax.`);
  return normalized;
}

function range(value: unknown, label: string): string {
  const normalized = text(value, label, 120);
  if (!VERSION_RANGE_PATTERN.test(normalized))
    throw new Error(`${label} is invalid.`);
  return normalized;
}

function normalizeReference(value: AssetReference): AssetReference {
  const kind = normalizeAssetReferenceKind(value.kind);
  const id = normalizeAssetId(key(value.id, "Asset definition reference id"));
  const version =
    value.version === undefined
      ? undefined
      : semver(value.version, "Asset definition reference version");
  if (kind !== "asset-definition-version" || !version)
    throw new Error(
      "Implementation records require an exact asset-definition-version reference.",
    );
  return { kind, id, version };
}

export function normalizeAssetImplementationArtifactDescriptor(
  value: AssetImplementationArtifactDescriptor,
): AssetImplementationArtifactDescriptor {
  if (!Number.isSafeInteger(value.sizeBytes) || value.sizeBytes < 0)
    throw new Error("Artifact size is invalid.");
  return {
    artifactId: normalizeAssetImplementationArtifactId(value.artifactId),
    kind: normalizeAssetImplementationArtifactKind(value.kind),
    digest: normalizeSha256Digest(value.digest),
    mediaType: text(value.mediaType, "Artifact media type", 160),
    sizeBytes: value.sizeBytes,
  };
}

export function normalizeAssetImplementationCompatibility(
  value: AssetImplementationCompatibility,
): AssetImplementationCompatibility {
  const deploymentProfiles = [
    ...new Set(
      value.deploymentProfiles.map(
        normalizeAssetImplementationDeploymentProfile,
      ),
    ),
  ].sort();
  if (deploymentProfiles.length === 0)
    throw new Error("At least one deployment profile is required.");
  return {
    definitionVersion: semver(value.definitionVersion, "Definition version"),
    hostApiRange: range(value.hostApiRange, "Host API range"),
    ...(value.runtimeAbiRange
      ? { runtimeAbiRange: range(value.runtimeAbiRange, "Runtime ABI range") }
      : {}),
    deploymentProfiles,
  };
}

export function normalizeAssetImplementationFacet(
  value: AssetImplementationFacet,
): AssetImplementationFacet {
  const runtimeKind = normalizeAssetImplementationRuntimeKind(
    value.runtimeKind,
  );
  const artifact = value.artifact
    ? normalizeAssetImplementationArtifactDescriptor(value.artifact)
    : undefined;
  if (runtimeKind === "trusted-built-in" && artifact)
    throw new Error(
      "Trusted built-in facets must use a closed entry key, not an artifact payload.",
    );
  if (
    runtimeKind !== "trusted-built-in" &&
    !artifact &&
    runtimeKind !== "declarative-engine"
  )
    throw new Error(
      "Sandboxed implementation facets require an artifact descriptor.",
    );
  return {
    facetId: normalizeAssetImplementationFacetId(value.facetId),
    kind: normalizeAssetImplementationFacetKind(value.kind),
    runtimeKind,
    entryKey: key(value.entryKey, "Facet entry key"),
    ...(artifact ? { artifact } : {}),
    requiredCapabilities: [
      ...new Set(
        value.requiredCapabilities.map((item) =>
          key(item, "Required capability"),
        ),
      ),
    ].sort(),
    compatibility: normalizeAssetImplementationCompatibility(
      value.compatibility,
    ),
  };
}

function diagnostic(
  value: AssetImplementationDiagnostic,
): AssetImplementationDiagnostic {
  if (!["info", "warning", "error"].includes(value.severity))
    throw new Error("Diagnostic severity is invalid.");
  return {
    severity: value.severity,
    code: key(value.code, "Diagnostic code"),
    message: text(value.message, "Diagnostic message", 1000),
  };
}

export function normalizeAssetImplementationDraft(
  value: AssetImplementationDraft,
): AssetImplementationDraft {
  if (!Number.isSafeInteger(value.revision) || value.revision < 1)
    throw new Error("Draft revision is invalid.");
  return {
    ...value,
    draftId: normalizeAssetImplementationDraftId(value.draftId),
    workspaceId: createWorkspaceId(value.workspaceId),
    definitionRef: normalizeReference(value.definitionRef),
    displayName: text(value.displayName, "Display name", 160),
    status: normalizeAssetImplementationDraftStatus(value.status),
    ...(value.sourceSnapshotId
      ? {
          sourceSnapshotId: normalizeAssetSourceSnapshotId(
            value.sourceSnapshotId,
          ),
        }
      : {}),
    createdAt: timestamp(value.createdAt, "Created at"),
    updatedAt: timestamp(value.updatedAt, "Updated at"),
    createdBy: key(value.createdBy, "Created by"),
  };
}

export function normalizeAssetSourceSnapshot(
  value: AssetSourceSnapshot,
): AssetSourceSnapshot {
  return {
    ...value,
    snapshotId: normalizeAssetSourceSnapshotId(value.snapshotId),
    workspaceId: createWorkspaceId(value.workspaceId),
    draftId: normalizeAssetImplementationDraftId(value.draftId),
    artifact: normalizeAssetImplementationArtifactDescriptor(value.artifact),
    createdAt: timestamp(value.createdAt, "Created at"),
    createdBy: key(value.createdBy, "Created by"),
  };
}

export function normalizeAssetImplementationBuild(
  value: AssetImplementationBuild,
): AssetImplementationBuild {
  return {
    ...value,
    buildId: normalizeAssetImplementationBuildId(value.buildId),
    workspaceId: createWorkspaceId(value.workspaceId),
    draftId: normalizeAssetImplementationDraftId(value.draftId),
    sourceSnapshotId: normalizeAssetSourceSnapshotId(value.sourceSnapshotId),
    toolchainProfile: key(value.toolchainProfile, "Toolchain profile"),
    status: normalizeAssetImplementationBuildStatus(value.status),
    requestedFacets: [
      ...new Set(
        value.requestedFacets.map(normalizeAssetImplementationFacetKind),
      ),
    ],
    outputArtifacts: value.outputArtifacts.map(
      normalizeAssetImplementationArtifactDescriptor,
    ),
    evidenceArtifacts: value.evidenceArtifacts.map(
      normalizeAssetImplementationArtifactDescriptor,
    ),
    diagnostics: value.diagnostics.map(diagnostic),
    createdAt: timestamp(value.createdAt, "Created at"),
    ...(value.startedAt
      ? { startedAt: timestamp(value.startedAt, "Started at") }
      : {}),
    ...(value.completedAt
      ? { completedAt: timestamp(value.completedAt, "Completed at") }
      : {}),
    requestedBy: key(value.requestedBy, "Requested by"),
  };
}

export function normalizeAssetImplementationRelease(
  value: AssetImplementationRelease,
): AssetImplementationRelease {
  const facets = value.facets.map(normalizeAssetImplementationFacet);
  if (facets.length === 0)
    throw new Error("Implementation release requires at least one facet.");
  const definitionRef = normalizeReference(value.definitionRef);
  if (
    facets.some(
      (facet) =>
        facet.compatibility.definitionVersion !== definitionRef.version,
    )
  )
    throw new Error("Every facet must target the exact definition version.");
  return {
    ...value,
    releaseId: normalizeAssetImplementationReleaseId(value.releaseId),
    ...(value.workspaceId
      ? { workspaceId: createWorkspaceId(value.workspaceId) }
      : {}),
    ...(value.organizationId
      ? { organizationId: createOrganizationId(value.organizationId) }
      : {}),
    definitionRef,
    version: semver(value.version, "Implementation version"),
    status: normalizeAssetImplementationReleaseStatus(value.status),
    trustLevel: normalizeAssetImplementationTrustLevel(value.trustLevel),
    ...(value.sourceSnapshotId
      ? {
          sourceSnapshotId: normalizeAssetSourceSnapshotId(
            value.sourceSnapshotId,
          ),
        }
      : {}),
    ...(value.sourceBuildId
      ? {
          sourceBuildId: normalizeAssetImplementationBuildId(
            value.sourceBuildId,
          ),
        }
      : {}),
    facets,
    packageDigest: normalizeSha256Digest(value.packageDigest),
    evidenceArtifacts: value.evidenceArtifacts.map(
      normalizeAssetImplementationArtifactDescriptor,
    ),
    createdAt: timestamp(value.createdAt, "Created at"),
    publishedAt: timestamp(value.publishedAt, "Published at"),
    publishedBy: key(value.publishedBy, "Published by"),
  };
}

export function normalizeAssetImplementationBinding(
  value: AssetImplementationBinding,
): AssetImplementationBinding {
  if (
    !Number.isSafeInteger(value.priority) ||
    value.priority < 0 ||
    value.priority > 1000
  )
    throw new Error("Binding priority is invalid.");
  if (!Number.isSafeInteger(value.revision) || value.revision < 1)
    throw new Error("Binding revision is invalid.");
  return {
    ...value,
    bindingId: normalizeAssetImplementationBindingId(value.bindingId),
    ...(value.workspaceId
      ? { workspaceId: createWorkspaceId(value.workspaceId) }
      : {}),
    ...(value.organizationId
      ? { organizationId: createOrganizationId(value.organizationId) }
      : {}),
    definitionRef: normalizeReference(value.definitionRef),
    releaseId: normalizeAssetImplementationReleaseId(value.releaseId),
    status: normalizeAssetImplementationBindingStatus(value.status),
    createdAt: timestamp(value.createdAt, "Created at"),
    updatedAt: timestamp(value.updatedAt, "Updated at"),
    approvedBy: key(value.approvedBy, "Approved by"),
  };
}

export function normalizeAssetImplementationRevocation(
  value: AssetImplementationRevocation,
): AssetImplementationRevocation {
  return {
    ...value,
    revocationId: normalizeAssetImplementationRevocationId(value.revocationId),
    releaseId: normalizeAssetImplementationReleaseId(value.releaseId),
    ...(value.organizationId
      ? { organizationId: createOrganizationId(value.organizationId) }
      : {}),
    reasonCode: key(value.reasonCode, "Reason code"),
    message: text(value.message, "Revocation message", 1000),
    revokedAt: timestamp(value.revokedAt, "Revoked at"),
    revokedBy: key(value.revokedBy, "Revoked by"),
  };
}

export function normalizeAssetImplementationResolutionRequest(
  value: AssetImplementationResolutionRequest,
): AssetImplementationResolutionRequest {
  return {
    workspaceId: createWorkspaceId(value.workspaceId),
    definitionRef: normalizeReference(value.definitionRef),
    requiredFacets: [
      ...new Set(
        value.requiredFacets.map(normalizeAssetImplementationFacetKind),
      ),
    ],
    deploymentProfile: normalizeAssetImplementationDeploymentProfile(
      value.deploymentProfile,
    ),
    availableCapabilities: [
      ...new Set(
        value.availableCapabilities.map((item) =>
          key(item, "Available capability"),
        ),
      ),
    ].sort(),
    permittedTrustLevels: [
      ...new Set(
        value.permittedTrustLevels.map(normalizeAssetImplementationTrustLevel),
      ),
    ],
    ...(value.lockedReleaseId
      ? {
          lockedReleaseId: normalizeAssetImplementationReleaseId(
            value.lockedReleaseId,
          ),
        }
      : {}),
    hostApiVersion: semver(value.hostApiVersion, "Host API version"),
    ...(value.runtimeAbiVersion
      ? {
          runtimeAbiVersion: semver(
            value.runtimeAbiVersion,
            "Runtime ABI version",
          ),
        }
      : {}),
  };
}
