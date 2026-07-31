import { normalizeAssetCompositionNodeId, normalizeAssetCompositionNodeRole } from "../../../contracts/asset-composition";
import type { AddProjectionToCompositionPlanCommand, AssetCompositionNode, SelectedAssetProjectionReference } from "../../../contracts/asset-composition";
import type { EffectiveAssetProjectionRecord } from "../../../contracts/effective-asset-projections";

export const createSelectedProjectionReference = (
  projection: EffectiveAssetProjectionRecord,
  selectedAt: string,
): SelectedAssetProjectionReference => ({
  targetWorkspaceId: projection.targetWorkspaceId,
  projectionId: projection.projectionId,
  effectiveAssetReference: projection.effectiveAssetReference,
  projectionStatusAtSelection: projection.status,
  projectionSourceKind: projection.sourceKind,
  displayLabel: projection.target.targetLabel,
  selectedAt,
});

export const createCompositionNodeFromProjection = (d: {
  projection: EffectiveAssetProjectionRecord;
  selectedProjection: SelectedAssetProjectionReference;
  command: AddProjectionToCompositionPlanCommand;
  nodeId: string;
  now: string;
}): AssetCompositionNode => ({
  nodeId: normalizeAssetCompositionNodeId(d.nodeId),
  targetWorkspaceId: d.projection.targetWorkspaceId,
  selectedProjection: d.selectedProjection,
  effectiveAssetReference: d.projection.effectiveAssetReference,
  role: normalizeAssetCompositionNodeRole(d.command.role ?? "supporting-asset"),
  status: "ready-for-planning",
  requiredCapabilities: [],
  providedCapabilities: [],
  diagnostics: [],
  blockers: [],
  label: d.command.label?.trim() || d.projection.target.targetLabel?.trim() || d.projection.source.sourceLabel?.trim() || "Selected projection",
  summary: d.projection.source.sourceLabel?.trim() || undefined,
  createdAt: d.now,
  updatedAt: d.now,
});
