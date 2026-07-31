import type { AssetReference } from "../../../contracts/asset";
import type {
  EffectiveAssetProjectionBlocker,
  EffectiveAssetProjectionDiagnostic,
  EffectiveAssetProjectionRecord,
  EffectiveAssetProjectionStatus,
  SafeEffectiveAssetProjectedFieldPatch,
} from "../../../contracts/effective-asset-projections";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { EffectiveAssetProjectionListQuery, EffectiveAssetProjectionRepositoryPort } from "../../ports/effective-asset-projections";
import { EffectiveAssetProjectionReadinessService, defaultEffectiveAssetProjectionReadinessService } from "../../use-cases/effective-asset-projections/effective-asset-projection-readiness.service";

export interface WorkspaceEffectiveAssetProjectionReadModelDependencies {
  readonly projectionRepository: EffectiveAssetProjectionRepositoryPort;
  readonly readinessService?: EffectiveAssetProjectionReadinessService;
}

export interface WorkspaceEffectiveAssetProjectionSummary {
  readonly projectionId: string;
  readonly targetWorkspaceId: WorkspaceId;
  readonly effectiveAssetReference: AssetReference;
  readonly sourceAssetReference?: AssetReference;
  readonly sourceKind: string;
  readonly status: EffectiveAssetProjectionStatus;
  readonly policy: string;
  readonly readinessLabel: "projection-consumable" | "draft-preview-only" | "blocked-for-planning" | "refresh-required" | "disabled" | "conflicted";
  readonly isProjectionConsumable: boolean;
  readonly isBlockedForPlanning: boolean;
  readonly requiresRefresh: boolean;
  readonly isDraftPreviewOnly: boolean;
  readonly hasConflicts: boolean;
  readonly isDisabled: boolean;
  readonly projectedFields: SafeEffectiveAssetProjectedFieldPatch;
  readonly projectedFieldsApplied: boolean;
  readonly diagnostics: readonly EffectiveAssetProjectionDiagnostic[];
  readonly blockers: readonly EffectiveAssetProjectionBlocker[];
  readonly provenance: {
    readonly kind: string;
    readonly targetWorkspaceId: WorkspaceId;
    readonly sourceWorkspaceId?: WorkspaceId;
    readonly sourceAssetReference?: AssetReference;
    readonly effectiveAssetReference?: AssetReference;
    readonly authoredAssetId?: string;
    readonly draftId?: string;
    readonly revisionId?: string;
    readonly overrideId?: string;
    readonly sourceRelationshipId?: string;
    readonly operationAt: string;
  };
  readonly projectionRevisionId?: string;
  readonly projectionSnapshotId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly materializedAt?: string;
  readonly invalidatedAt?: string;
  readonly stale: boolean;
}

export class WorkspaceEffectiveAssetProjectionReadModelService {
  private readonly readiness: EffectiveAssetProjectionReadinessService;
  public constructor(private readonly dependencies: WorkspaceEffectiveAssetProjectionReadModelDependencies) {
    this.readiness = dependencies.readinessService ?? defaultEffectiveAssetProjectionReadinessService;
  }

  public async listByWorkspace(query: EffectiveAssetProjectionListQuery): Promise<{ summaries: readonly WorkspaceEffectiveAssetProjectionSummary[]; nextCursor?: string }> {
    const result = await this.dependencies.projectionRepository.listEffectiveAssetProjectionRecords(query);
    return {
      summaries: result.records.map((record) => this.toSummary(record)).sort((a, b) => `${a.updatedAt}:${a.projectionId}`.localeCompare(`${b.updatedAt}:${b.projectionId}`)),
      ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
    };
  }

  public async readByProjectionId(targetWorkspaceId: WorkspaceId, projectionId: string): Promise<WorkspaceEffectiveAssetProjectionSummary | undefined> {
    const record = await this.dependencies.projectionRepository.readEffectiveAssetProjectionRecord(targetWorkspaceId, projectionId as never);
    return record ? this.toSummary(record) : undefined;
  }

  public async readByEffectiveAssetReference(targetWorkspaceId: WorkspaceId, effectiveAssetReference: AssetReference): Promise<WorkspaceEffectiveAssetProjectionSummary | undefined> {
    const record = await this.dependencies.projectionRepository.readEffectiveAssetProjectionRecordByEffectiveAssetReference(targetWorkspaceId, effectiveAssetReference);
    return record ? this.toSummary(record) : undefined;
  }

  private toSummary(record: EffectiveAssetProjectionRecord): WorkspaceEffectiveAssetProjectionSummary {
    const isProjectionConsumable = this.readiness.isProjectionConsumable(record.status);
    const requiresRefresh = record.status === "stale" || Boolean(record.invalidatedAt);
    const isDraftPreviewOnly = record.status === "draft-only";
    const hasConflicts = record.status === "conflicted";
    const isDisabled = record.status === "disabled";
    const isBlockedForPlanning = this.readiness.isBlockedForDownstreamPlanning(record.status);
    const safeProjectedFields = isProjectionConsumable ? record.projectedFields : {};
    const safeDiagnostics = record.diagnostics.map((d) => ({ code: d.code, message: d.message }));
    const safeBlockers = record.blockers.map((b) => ({ code: b.code, message: b.message }));

    const readinessLabel = isDisabled
      ? "disabled"
      : hasConflicts
        ? "conflicted"
        : requiresRefresh
          ? "refresh-required"
          : isDraftPreviewOnly
            ? "draft-preview-only"
            : isProjectionConsumable
              ? "projection-consumable"
              : "blocked-for-planning";

    return {
      projectionId: record.projectionId,
      targetWorkspaceId: record.targetWorkspaceId,
      effectiveAssetReference: record.effectiveAssetReference,
      sourceAssetReference: record.sourceAssetReference,
      sourceKind: record.sourceKind,
      status: record.status,
      policy: record.policy,
      readinessLabel,
      isProjectionConsumable,
      isBlockedForPlanning,
      requiresRefresh,
      isDraftPreviewOnly,
      hasConflicts,
      isDisabled,
      projectedFields: safeProjectedFields,
      projectedFieldsApplied: isProjectionConsumable,
      diagnostics: safeDiagnostics,
      blockers: safeBlockers,
      provenance: {
        kind: record.provenance.kind,
        targetWorkspaceId: record.provenance.targetWorkspaceId,
        sourceWorkspaceId: record.provenance.sourceWorkspaceId,
        sourceAssetReference: record.provenance.sourceAssetReference ? { ...record.provenance.sourceAssetReference } : undefined,
        effectiveAssetReference: record.provenance.effectiveAssetReference ? { ...record.provenance.effectiveAssetReference } : undefined,
        authoredAssetId: record.provenance.authoredAssetId,
        draftId: record.provenance.draftId,
        revisionId: record.provenance.revisionId,
        overrideId: record.provenance.overrideId,
        sourceRelationshipId: record.provenance.sourceRelationshipId,
        operationAt: record.provenance.operationAt,
      },
      projectionRevisionId: record.projectionRevisionId,
      projectionSnapshotId: record.projectionSnapshotId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      materializedAt: record.materializedAt,
      invalidatedAt: record.invalidatedAt,
      stale: requiresRefresh,
    };
  }
}
