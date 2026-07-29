import type { AssetReference } from "../asset";
import type {
  AssetImplementationDeploymentProfile,
  AssetImplementationFacet,
  AssetImplementationTrustLevel,
} from "../asset-implementation";
import type { WorkspaceId } from "../workspace";
import type {
  SystemBuilderRevisionId,
  SystemBuilderSystemId,
} from "../system-builder";
import type {
  SystemBuildArtifactId,
  SystemBuildId,
  SystemReleaseId,
} from "./system-build-id";

export type SystemBuildStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type SystemBuildAssurance =
  "repeatable" | "independently-reproduced" | "not-verified";
export type SystemBuildArtifactKind =
  | "manifest"
  | "ui-bundle"
  | "logic-bundle"
  | "workflow"
  | "policy"
  | "configuration-schema"
  | "migration-plan"
  | "sbom"
  | "provenance"
  | "evidence"
  | "log";
export type SystemBuildDigest = `sha256:${string}`;

export interface SystemBuildDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly path?: readonly string[];
}

export interface SystemBuildArtifactDescriptor {
  readonly artifactId: SystemBuildArtifactId;
  readonly kind: SystemBuildArtifactKind;
  readonly digest: SystemBuildDigest;
  readonly mediaType: string;
  readonly sizeBytes: number;
}

export interface SystemBuildResolvedImplementation {
  readonly instanceId: string;
  readonly definitionRef: AssetReference;
  readonly releaseId: string;
  readonly releaseVersion: string;
  readonly packageDigest: string;
  readonly trustLevel: AssetImplementationTrustLevel;
  readonly facets: readonly AssetImplementationFacet[];
}

export interface SystemBuildRuntimeResourceBinding {
  readonly instanceId: string;
  readonly bindingKind: "model-record";
  readonly capabilityKind: "text-generation";
  readonly modelRecordId: string;
  readonly modelRevisionDigest: SystemBuildDigest;
}

export interface SystemBuildRuntimeInteractionBinding {
  readonly interactionKind: "conversation-turn";
  readonly composerInstanceId: string;
  readonly historyInstanceId: string;
  readonly transcriptMode: "persisted-only";
}

export interface SystemBuildLockManifest {
  readonly schemaVersion: "1.0";
  readonly systemId: SystemBuilderSystemId;
  readonly systemRevisionId: SystemBuilderRevisionId;
  readonly systemRevisionDigest: SystemBuildDigest;
  readonly deploymentProfile: AssetImplementationDeploymentProfile;
  readonly hostApiVersion: string;
  readonly runtimeAbiVersion?: string;
  readonly toolchainProfile: string;
  readonly policyCompilerVersion: string;
  readonly workflowCompilerVersion: string;
  readonly schemaCompilerVersion: string;
  readonly resolvedImplementations: readonly SystemBuildResolvedImplementation[];
  /**
   * Additive for persisted 1.0 locks. New interactive builds always materialize
   * this list; older locks remain readable and fail closed when a runtime
   * requires a binding that they do not contain.
   */
  readonly runtimeResourceBindings?: readonly SystemBuildRuntimeResourceBinding[];
  readonly runtimeInteractionBindings?: readonly SystemBuildRuntimeInteractionBinding[];
}

export interface SystemBuildRecord {
  readonly buildId: SystemBuildId;
  readonly targetWorkspaceId: WorkspaceId;
  readonly systemId: SystemBuilderSystemId;
  readonly systemRevisionId: SystemBuilderRevisionId;
  readonly status: SystemBuildStatus;
  readonly revision: number;
  readonly lock?: SystemBuildLockManifest;
  readonly lockDigest?: SystemBuildDigest;
  readonly outputArtifacts: readonly SystemBuildArtifactDescriptor[];
  readonly evidenceArtifacts: readonly SystemBuildArtifactDescriptor[];
  readonly diagnostics: readonly SystemBuildDiagnostic[];
  readonly assurance: SystemBuildAssurance;
  readonly cancellationRequested: boolean;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly requestedBy: string;
}

export interface SystemReleaseCompatibility {
  readonly deploymentProfiles: readonly AssetImplementationDeploymentProfile[];
  readonly hostApiVersion: string;
  readonly runtimeAbiVersion?: string;
}

export interface SystemRelease {
  readonly releaseId: SystemReleaseId;
  readonly targetWorkspaceId: WorkspaceId;
  readonly systemId: SystemBuilderSystemId;
  readonly systemRevisionId: SystemBuilderRevisionId;
  readonly sourceBuildId: SystemBuildId;
  readonly lockDigest: SystemBuildDigest;
  readonly releaseDigest: SystemBuildDigest;
  readonly lock: SystemBuildLockManifest;
  readonly artifacts: readonly SystemBuildArtifactDescriptor[];
  readonly compatibility: SystemReleaseCompatibility;
  readonly assurance: SystemBuildAssurance;
  readonly approvedAt: string;
  readonly approvedBy: string;
  readonly createdAt: string;
}

export function normalizeSystemBuildDigest(value: string): SystemBuildDigest {
  const normalized = value.trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized))
    throw new Error("System build digest must be a sha256 digest.");
  return normalized as SystemBuildDigest;
}

export function normalizeSystemBuildArtifactKind(
  value: string,
): SystemBuildArtifactKind {
  const supported: readonly SystemBuildArtifactKind[] = [
    "manifest",
    "ui-bundle",
    "logic-bundle",
    "workflow",
    "policy",
    "configuration-schema",
    "migration-plan",
    "sbom",
    "provenance",
    "evidence",
    "log",
  ];
  const normalized = value.trim().toLowerCase() as SystemBuildArtifactKind;
  if (!supported.includes(normalized))
    throw new Error(`System build artifact kind is unsupported: ${value}.`);
  return normalized;
}
