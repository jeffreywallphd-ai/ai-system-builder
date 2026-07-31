import type {
  EffectiveAssetProjectionProvenance,
  EffectiveAssetProjectionProvenanceKind,
  EffectiveAssetProjectionSource,
  EffectiveAssetProjectionSourceKind,
} from "../../../contracts/effective-asset-projections";
import type { WorkspaceId } from "../../../contracts/workspace";

const PROVENANCE_KIND_BY_SOURCE_KIND: Record<EffectiveAssetProjectionSourceKind, EffectiveAssetProjectionProvenanceKind> = {
  "system-foundation": "projected-from-system-foundation",
  "workspace-local": "projected-from-workspace-local-asset",
  "user-library-linked": "projected-from-user-library-link",
  "user-library-copied": "projected-from-detached-user-library-copy",
  "workspace-imported": "projected-from-workspace-import",
  "workspace-authored": "projected-from-authored-asset-revision",
  "workspace-authored-draft": "projected-from-authored-draft-preview",
  "workspace-authored-revision": "projected-from-authored-asset-revision",
  "workspace-customized": "projected-from-active-override",
  "linked-with-workspace-override": "projected-from-active-override",
  "copied-with-workspace-override": "projected-from-active-override",
  "imported-with-workspace-override": "projected-from-active-override",
  "system-derived-override": "projected-from-active-override",
};

export const createProjectionProvenance = (targetWorkspaceId: WorkspaceId, source: EffectiveAssetProjectionSource, operationAt: string): EffectiveAssetProjectionProvenance => ({
  kind: PROVENANCE_KIND_BY_SOURCE_KIND[source.sourceKind],
  targetWorkspaceId,
  sourceWorkspaceId: source.sourceWorkspaceId,
  sourceAssetReference: source.sourceAssetReference,
  effectiveAssetReference: source.effectiveAssetReference,
  userLibraryAssetId: source.userLibraryAssetId,
  authoredAssetId: source.authoredAssetId,
  revisionId: source.revisionId,
  draftId: source.draftId,
  overrideId: source.overrideId,
  sourceRelationshipId: source.sourceRelationshipId,
  operationAt,
});
