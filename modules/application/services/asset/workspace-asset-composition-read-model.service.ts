import type { AssetReference } from "../../../contracts/asset";
import type {
  AssetCompositionBlocker,
  AssetCompositionCompatibilityStatus,
  AssetCompositionDiagnostic,
  AssetCompositionNode,
  AssetCompositionPlan,
  AssetCompositionPlanStatus,
  AssetCompositionRelationship,
} from "../../../contracts/asset-composition";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { AssetCompositionPlanListQuery, AssetCompositionPlanRepositoryPort } from "../../ports/asset-composition";

export interface WorkspaceAssetCompositionReadModelDependencies {
  readonly compositionPlanRepository: AssetCompositionPlanRepositoryPort;
}

export interface WorkspaceAssetCompositionListRequest {
  readonly targetWorkspaceId: WorkspaceId;
  readonly status?: AssetCompositionPlanStatus;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface WorkspaceAssetCompositionPlanSummary {
  readonly planId: string;
  readonly targetWorkspaceId: WorkspaceId;
  readonly name: string;
  readonly description?: string;
  readonly status: AssetCompositionPlanStatus;
  readonly planningReadiness: string;
  readonly totalNodes: number;
  readonly totalRelationships: number;
  readonly blockerCount: number;
  readonly diagnosticCount: number;
  readonly missingDependencyCount: number;
  readonly staleProjectionCount: number;
  readonly unsupportedCount: number;
  readonly conflictedCount: number;
  readonly updatedAt: string;
  readonly archivedAt?: string;
  readonly needsAttention: boolean;
  readonly attentionLabel?: "Needs attention" | "Blocked" | "Conflicted" | "Refresh needed" | "Missing dependency" | "Unsupported" | "Invalid";
}

export interface WorkspaceAssetCompositionPlanDetail {
  readonly summary: WorkspaceAssetCompositionPlanSummary;
  readonly selectedProjections: readonly {
    projectionId: string;
    targetWorkspaceId: WorkspaceId;
    displayLabel?: string;
    effectiveAssetReference?: AssetReference;
    projectionStatusAtSelection?: string;
  }[];
  readonly nodes: readonly {
    nodeId: string; role: string; status: string; safeLabel?: string; safeSummary?: string; effectiveAssetReference?: AssetReference;
    selectedProjectionId: string; requiredCapabilityCount: number; providedCapabilityCount: number; diagnosticCount: number; blockerCount: number; createdAt: string; updatedAt: string;
  }[];
  readonly relationships: readonly {
    relationshipId: string; sourceNodeId: string; targetNodeId: string; kind: string; compatibilityStatus: AssetCompositionCompatibilityStatus; safeLabel?: string; safeSummary?: string;
    diagnosticCount: number; blockerCount: number; createdAt: string; updatedAt: string;
  }[];
  readonly diagnostics: readonly { code: string; severity: string; message: string }[];
  readonly blockers: readonly { code: string; message: string }[];
  readonly planningSummary: {
    totalNodes: number; totalRelationships: number; planningReadiness: string; missingDependencyCount: number; staleProjectionCount: number; unsupportedCount: number;
  };
  readonly provenanceSummary: { createdAt: string; lastUpdatedAt: string; archivedAt?: string; provenanceEventCount: number; selectedProjectionCount: number; relationshipCount: number };
}

export class WorkspaceAssetCompositionReadModelService {
  public constructor(private readonly dependencies: WorkspaceAssetCompositionReadModelDependencies) {}

  public async listCompositionPlanSummaries(request: WorkspaceAssetCompositionListRequest): Promise<{ summaries: readonly WorkspaceAssetCompositionPlanSummary[]; nextCursor?: string }> {
    const query: AssetCompositionPlanListQuery = { targetWorkspaceId: request.targetWorkspaceId, status: request.status, limit: request.limit, cursor: request.cursor };
    const result = await this.dependencies.compositionPlanRepository.listAssetCompositionPlanRecords(query);
    const summaries = result.records.map((r) => this.toSummary(r));
    return { summaries, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
  }

  public async readCompositionPlanDetail(request: { targetWorkspaceId: WorkspaceId; planId: string }): Promise<WorkspaceAssetCompositionPlanDetail | undefined> {
    const record = await this.dependencies.compositionPlanRepository.readAssetCompositionPlanRecord(request.targetWorkspaceId, request.planId as never);
    if (!record) return undefined;
    return this.toDetail(record);
  }

  public async listPlansForProjection(request: { targetWorkspaceId: WorkspaceId; projectionId: string }): Promise<readonly WorkspaceAssetCompositionPlanSummary[]> {
    const plans = await this.dependencies.compositionPlanRepository.listAssetCompositionPlanRecordsBySelectedProjectionId(request.targetWorkspaceId, request.projectionId as never);
    return plans.map((p) => this.toSummary(p));
  }

  public async listPlansForEffectiveAssetReference(request: { targetWorkspaceId: WorkspaceId; effectiveAssetReference: AssetReference }): Promise<readonly WorkspaceAssetCompositionPlanSummary[]> {
    const plans = await this.dependencies.compositionPlanRepository.listAssetCompositionPlanRecordsByEffectiveAssetReference(request.targetWorkspaceId, request.effectiveAssetReference);
    return plans.map((p) => this.toSummary(p));
  }

  public async listPlansNeedingAttention(request: { targetWorkspaceId: WorkspaceId }): Promise<readonly WorkspaceAssetCompositionPlanSummary[]> {
    const { records } = await this.dependencies.compositionPlanRepository.listAssetCompositionPlanRecords({ targetWorkspaceId: request.targetWorkspaceId });
    return records.map((r) => this.toSummary(r)).filter((r) => r.needsAttention);
  }

  private toDetail(plan: AssetCompositionPlan): WorkspaceAssetCompositionPlanDetail {
    return {
      summary: this.toSummary(plan),
      selectedProjections: plan.selectedProjections.map((p) => ({ projectionId: p.projectionId, targetWorkspaceId: p.targetWorkspaceId, displayLabel: sanitizeText(p.displayLabel), effectiveAssetReference: p.effectiveAssetReference, projectionStatusAtSelection: p.projectionStatusAtSelection })),
      nodes: plan.nodes.map((n) => this.toNodeSummary(n)),
      relationships: plan.relationships.map((r) => this.toRelationshipSummary(r)),
      diagnostics: plan.compatibilityDiagnostics.map((d) => this.toDiagnostic(d)),
      blockers: plan.blockers.map((b) => ({ code: b.code, message: sanitizeText(b.message) ?? "Sanitized composition planning blocker." })),
      planningSummary: {
        totalNodes: plan.planningSummary.totalNodes,
        totalRelationships: plan.planningSummary.totalRelationships,
        planningReadiness: plan.planningSummary.planningReadiness,
        missingDependencyCount: plan.planningSummary.missingDependencyCount,
        staleProjectionCount: plan.planningSummary.staleProjectionCount,
        unsupportedCount: plan.planningSummary.unsupportedCount,
      },
      provenanceSummary: {
        createdAt: plan.createdAt,
        lastUpdatedAt: plan.updatedAt,
        archivedAt: plan.archivedAt,
        provenanceEventCount: plan.provenance.length,
        selectedProjectionCount: plan.selectedProjections.length,
        relationshipCount: plan.relationships.length,
      },
    };
  }

  private toSummary(plan: AssetCompositionPlan): WorkspaceAssetCompositionPlanSummary {
    const conflictedCount = plan.compatibilityDiagnostics.filter((d) => d.code.includes("conflict")).length;
    const needsAttention = this.getNeedsAttention(plan, conflictedCount);
    return {
      planId: plan.planId,
      targetWorkspaceId: plan.targetWorkspaceId,
      name: sanitizeText(plan.name) ?? "Untitled",
      description: sanitizeText(plan.description),
      status: plan.status,
      planningReadiness: plan.planningSummary.planningReadiness,
      totalNodes: plan.planningSummary.totalNodes,
      totalRelationships: plan.planningSummary.totalRelationships,
      blockerCount: plan.blockers.length,
      diagnosticCount: plan.compatibilityDiagnostics.length,
      missingDependencyCount: plan.planningSummary.missingDependencyCount,
      staleProjectionCount: plan.planningSummary.staleProjectionCount,
      unsupportedCount: plan.planningSummary.unsupportedCount,
      conflictedCount,
      updatedAt: plan.updatedAt,
      archivedAt: plan.archivedAt,
      needsAttention,
      attentionLabel: needsAttention ? this.getAttentionLabel(plan, conflictedCount) : undefined,
    };
  }

  private getNeedsAttention(plan: AssetCompositionPlan, conflictedCount: number): boolean {
    if (["blocked", "conflicted", "stale", "unsupported", "invalid"].includes(plan.status)) return true;
    if (plan.blockers.length > 0 || conflictedCount > 0 || plan.planningSummary.missingDependencyCount > 0 || plan.planningSummary.staleProjectionCount > 0 || plan.planningSummary.unsupportedCount > 0) return true;
    if (plan.nodes.some((n) => ["blocked", "conflicted", "missing-projection", "stale-projection", "unsupported", "invalid", "disabled"].includes(n.status))) return true;
    if (plan.relationships.some((r) => ["blocked", "conflicted", "missing-dependency", "stale", "unsupported", "invalid"].includes(r.compatibilityStatus))) return true;
    return false;
  }

  private getAttentionLabel(plan: AssetCompositionPlan, conflictedCount: number): WorkspaceAssetCompositionPlanSummary["attentionLabel"] {
    if (plan.status === "blocked") return "Blocked";
    if (plan.status === "conflicted" || conflictedCount > 0) return "Conflicted";
    if (plan.status === "stale" || plan.planningSummary.staleProjectionCount > 0) return "Refresh needed";
    if (plan.planningSummary.missingDependencyCount > 0) return "Missing dependency";
    if (plan.status === "unsupported" || plan.planningSummary.unsupportedCount > 0) return "Unsupported";
    if (plan.status === "invalid") return "Invalid";
    return "Needs attention";
  }

  private toNodeSummary(node: AssetCompositionNode) { return { nodeId: node.nodeId, role: node.role, status: node.status, safeLabel: sanitizeText(node.label), safeSummary: sanitizeText(node.summary), effectiveAssetReference: node.effectiveAssetReference, selectedProjectionId: node.selectedProjection.projectionId, requiredCapabilityCount: node.requiredCapabilities.length, providedCapabilityCount: node.providedCapabilities.length, diagnosticCount: node.diagnostics.length, blockerCount: node.blockers.length, createdAt: node.createdAt, updatedAt: node.updatedAt }; }
  private toRelationshipSummary(relationship: AssetCompositionRelationship) { return { relationshipId: relationship.relationshipId, sourceNodeId: relationship.sourceNodeId, targetNodeId: relationship.targetNodeId, kind: relationship.kind, compatibilityStatus: relationship.compatibilityStatus, safeLabel: sanitizeText(relationship.label), safeSummary: sanitizeText(relationship.summary), diagnosticCount: relationship.diagnostics.length, blockerCount: relationship.blockers.length, createdAt: relationship.createdAt, updatedAt: relationship.updatedAt }; }
  private toDiagnostic(diagnostic: AssetCompositionDiagnostic) { return { code: diagnostic.code, severity: diagnostic.severity, message: sanitizeText(diagnostic.message) ?? "Sanitized composition planning diagnostic." }; }
}

const sanitizeText = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const stripped = value.replace(/[<>]/g, "").trim();
  return stripped.length > 0 ? stripped : undefined;
};
