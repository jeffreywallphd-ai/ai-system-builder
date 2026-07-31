import type { AssetAuthoringProvenance } from "../../../contracts/asset-authoring";
import type { WorkspaceId } from "../../../contracts/workspace";

const create = (kind: AssetAuthoringProvenance["kind"], targetWorkspaceId: WorkspaceId, operationAt: string, sourceWorkspaceId?: WorkspaceId): AssetAuthoringProvenance => ({ kind, targetWorkspaceId, sourceWorkspaceId, operationAt });

export const createAuthoredFromScratchProvenance = (targetWorkspaceId: WorkspaceId, operationAt: string) => create("authored-from-scratch", targetWorkspaceId, operationAt);
export const createRevisedAuthoredAssetProvenance = (targetWorkspaceId: WorkspaceId, operationAt: string) => create("revised-authored-asset", targetWorkspaceId, operationAt);
export const createEditedAuthoredAssetProvenance = (targetWorkspaceId: WorkspaceId, operationAt: string) => create("edited-authored-asset", targetWorkspaceId, operationAt);
export const createDerivedFromWorkspaceLocalAssetProvenance = (targetWorkspaceId: WorkspaceId, operationAt: string, sourceWorkspaceId?: WorkspaceId) => create("derived-from-workspace-local-asset", targetWorkspaceId, operationAt, sourceWorkspaceId);
export const createCustomizedLinkedUserLibraryAssetProvenance = (targetWorkspaceId: WorkspaceId, operationAt: string, sourceWorkspaceId?: WorkspaceId) => create("customized-linked-user-library-asset", targetWorkspaceId, operationAt, sourceWorkspaceId);
export const createCustomizedDetachedUserLibraryCopyProvenance = (targetWorkspaceId: WorkspaceId, operationAt: string, sourceWorkspaceId?: WorkspaceId) => create("customized-detached-user-library-copy", targetWorkspaceId, operationAt, sourceWorkspaceId);
export const createCustomizedWorkspaceImportProvenance = (targetWorkspaceId: WorkspaceId, operationAt: string, sourceWorkspaceId?: WorkspaceId) => create("customized-workspace-import", targetWorkspaceId, operationAt, sourceWorkspaceId);
export const createSystemDerivedOverrideProvenance = (targetWorkspaceId: WorkspaceId, operationAt: string, sourceWorkspaceId?: WorkspaceId) => create("system-derived-override", targetWorkspaceId, operationAt, sourceWorkspaceId);
