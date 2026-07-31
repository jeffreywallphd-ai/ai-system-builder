import type { AssetCompositionRelationship, AssetCompositionRelationshipId, AssetCompositionRelationshipKind, AssetCompositionCompatibilityStatus } from "../../../contracts/asset-composition";
import type { AssetCompositionNodeId } from "../../../contracts/asset-composition";
import type { WorkspaceId } from "../../../contracts/workspace";

export const createAssetCompositionRelationship = (d: { relationshipId: AssetCompositionRelationshipId; targetWorkspaceId: WorkspaceId; sourceNodeId: AssetCompositionNodeId; targetNodeId: AssetCompositionNodeId; kind: AssetCompositionRelationshipKind; compatibilityStatus?: AssetCompositionCompatibilityStatus; now: string }): AssetCompositionRelationship => ({
  relationshipId: d.relationshipId,
  targetWorkspaceId: d.targetWorkspaceId,
  sourceNodeId: d.sourceNodeId,
  targetNodeId: d.targetNodeId,
  kind: d.kind,
  compatibilityStatus: d.compatibilityStatus ?? "unknown",
  diagnostics: [],
  blockers: [],
  createdAt: d.now,
  updatedAt: d.now,
});
