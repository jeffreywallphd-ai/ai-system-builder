import type { WorkspaceAssetAccessPort } from "../../ports/asset/workspace-asset-access.port";
import type { AuthoredAssetRepositoryPort, AssetDraftRepositoryPort, AssetRevisionRepositoryPort, AssetOverrideRepositoryPort } from "../../ports/asset-authoring";
import { requireWorkspaceAssetAccess } from "./workspace-asset-access.service";

/** Only the eight public, explicitly workspace-scoped reads; no mutation or by-ID escape. */
export interface WorkspaceAssetAuthoringReaders {
  readonly authoredAssetRepository: Pick<AuthoredAssetRepositoryPort, "listAuthoredAssetRecords" | "readAuthoredAssetRecordByWorkspace">;
  readonly assetDraftRepository: Pick<AssetDraftRepositoryPort, "listAssetDraftRecords" | "readAssetDraftRecord">;
  readonly assetRevisionRepository: Pick<AssetRevisionRepositoryPort, "listAssetRevisionRecords" | "readAssetRevisionRecord">;
  readonly assetOverrideRepository: Pick<AssetOverrideRepositoryPort, "listAssetOverrideRecords" | "readAssetOverrideRecord">;
}

export function createWorkspaceAssetAuthoringReaders(dependencies: {
  readonly workspaceAccess: WorkspaceAssetAccessPort;
  readonly authoredAssetRepository: AuthoredAssetRepositoryPort;
  readonly assetDraftRepository: AssetDraftRepositoryPort;
  readonly assetRevisionRepository: AssetRevisionRepositoryPort;
  readonly assetOverrideRepository: AssetOverrideRepositoryPort;
}): WorkspaceAssetAuthoringReaders {
  const access = async (workspaceId: Parameters<WorkspaceAssetAccessPort["authorize"]>[0], operation: string) =>
    requireWorkspaceAssetAccess(dependencies.workspaceAccess, workspaceId, `asset-authoring.${operation}`, "asset:read");
  return {
    authoredAssetRepository: {
      async listAuthoredAssetRecords(query) {
        const captured = structuredClone(query);
        await access(captured.workspaceId, "list-authored-assets");
        return dependencies.authoredAssetRepository.listAuthoredAssetRecords(captured);
      },
      async readAuthoredAssetRecordByWorkspace(workspaceId, authoredAssetId) {
        await access(workspaceId, "read-authored-asset");
        return dependencies.authoredAssetRepository.readAuthoredAssetRecordByWorkspace(workspaceId, authoredAssetId);
      },
    },
    assetDraftRepository: {
      async listAssetDraftRecords(query) {
        const captured = structuredClone(query);
        await access(captured.workspaceId, "list-drafts");
        return dependencies.assetDraftRepository.listAssetDraftRecords(captured);
      },
      async readAssetDraftRecord(workspaceId, draftId) {
        await access(workspaceId, "read-draft");
        return dependencies.assetDraftRepository.readAssetDraftRecord(workspaceId, draftId);
      },
    },
    assetRevisionRepository: {
      async listAssetRevisionRecords(query) {
        const captured = structuredClone(query);
        await access(captured.workspaceId, "list-revisions");
        return dependencies.assetRevisionRepository.listAssetRevisionRecords(captured);
      },
      async readAssetRevisionRecord(workspaceId, authoredAssetId, revisionId) {
        await access(workspaceId, "read-revision");
        return dependencies.assetRevisionRepository.readAssetRevisionRecord(workspaceId, authoredAssetId, revisionId);
      },
    },
    assetOverrideRepository: {
      async listAssetOverrideRecords(query) {
        const captured = structuredClone(query);
        await access(captured.targetWorkspaceId, "list-overrides");
        return dependencies.assetOverrideRepository.listAssetOverrideRecords(captured);
      },
      async readAssetOverrideRecord(workspaceId, overrideId) {
        await access(workspaceId, "read-override");
        return dependencies.assetOverrideRepository.readAssetOverrideRecord(workspaceId, overrideId);
      },
    },
  };
}
