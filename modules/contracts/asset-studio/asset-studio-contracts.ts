import type { AssetReference } from "../asset";
import type { AssetImplementationArtifactDescriptor, AssetImplementationDraftId, AssetSourceSnapshotId, Sha256Digest } from "../asset-implementation";
import type { WorkspaceId } from "../workspace";

export type AssetStudioWorkflowStatus = "proposed" | "approved" | "rejected" | "snapshotted" | "cancelled";
export type AssetStudioAuthoringMode = "manual" | "coding-model";

export interface AssetStudioSourceFile {
  readonly path: string;
  readonly content: string;
}

export interface AssetStudioPatchProposal {
  readonly summary: string;
  readonly plan: readonly string[];
  readonly files: readonly AssetStudioSourceFile[];
  readonly dependencies: readonly string[];
  readonly requestedCapabilities: readonly string[];
  readonly model?: { readonly provider: string; readonly modelId: string };
}

export interface AssetStudioDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface AssetStudioWorkflowRecord {
  readonly workflowId: string;
  readonly workspaceId: WorkspaceId;
  readonly implementationDraftId: AssetImplementationDraftId;
  readonly definitionRef: AssetReference;
  readonly mode: AssetStudioAuthoringMode;
  readonly status: AssetStudioWorkflowStatus;
  readonly intentDigest: Sha256Digest;
  readonly proposalArtifact: AssetImplementationArtifactDescriptor;
  readonly proposalDigest: Sha256Digest;
  readonly planStepCount: number;
  readonly fileCount: number;
  readonly dependencyCount: number;
  readonly requestedCapabilities: readonly string[];
  readonly diagnostics: readonly AssetStudioDiagnostic[];
  readonly sourceSnapshotId?: AssetSourceSnapshotId;
  readonly revision: number;
  readonly createdBy: string;
  readonly reviewedBy?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProposeAssetStudioChangeCommand {
  readonly workflowId: string;
  readonly workspaceId: WorkspaceId;
  readonly implementationDraftId: AssetImplementationDraftId;
  readonly definitionRef: AssetReference;
  readonly mode: AssetStudioAuthoringMode;
  readonly intent: string;
  readonly manualProposal?: AssetStudioPatchProposal;
  readonly context: readonly { readonly id: string; readonly kind: "contract" | "template" | "source" | "test"; readonly content: string }[];
  readonly allowedDependencies: readonly string[];
  readonly allowedCapabilities: readonly string[];
  readonly actorId: string;
}

export interface StartAssetStudioCommand {
  readonly workspaceId: WorkspaceId;
  readonly definitionRef: AssetReference;
  readonly displayName: string;
  readonly actorId: string;
}

export interface ReviewAssetStudioProposalCommand {
  readonly workspaceId: WorkspaceId;
  readonly workflowId: string;
  readonly expectedRevision: number;
  readonly decision: "approve" | "reject";
  readonly approvedDependencies: readonly string[];
  readonly approvedCapabilities: readonly string[];
  readonly actorId: string;
}

export interface AssetStudioProposalView {
  readonly record: AssetStudioWorkflowRecord;
  readonly proposal: AssetStudioPatchProposal;
}

export type AssetStudioResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly diagnostics?: readonly AssetStudioDiagnostic[] } };

export const ASSET_STUDIO_LIMITS = {
  maxIntentCharacters: 4_000,
  maxContextItems: 24,
  maxContextCharacters: 120_000,
  maxFiles: 64,
  maxFileCharacters: 200_000,
  maxTotalSourceCharacters: 1_000_000,
  maxPlanSteps: 32,
  maxDependencies: 32,
  maxCapabilities: 32,
} as const;
