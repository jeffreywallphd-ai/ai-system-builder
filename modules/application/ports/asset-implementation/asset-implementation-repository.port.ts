import type {
  AssetImplementationBinding,
  AssetImplementationBindingId,
  AssetImplementationBuild,
  AssetImplementationBuildId,
  AssetImplementationDraft,
  AssetImplementationDraftId,
  AssetImplementationRelease,
  AssetImplementationReleaseId,
  AssetImplementationRevocation,
  AssetSourceSnapshot,
  AssetSourceSnapshotId,
} from "../../../contracts/asset-implementation";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface AssetImplementationRepositoryPort {
  createDraft(
    draft: AssetImplementationDraft,
  ): Promise<AssetImplementationDraft>;
  readDraft(
    workspaceId: WorkspaceId,
    draftId: AssetImplementationDraftId,
  ): Promise<AssetImplementationDraft | undefined>;
  updateDraft(
    draft: AssetImplementationDraft,
    expectedRevision: number,
  ): Promise<AssetImplementationDraft>;
  saveSourceSnapshot(
    snapshot: AssetSourceSnapshot,
  ): Promise<AssetSourceSnapshot>;
  readSourceSnapshot(
    workspaceId: WorkspaceId,
    snapshotId: AssetSourceSnapshotId,
  ): Promise<AssetSourceSnapshot | undefined>;
  saveBuild(build: AssetImplementationBuild): Promise<AssetImplementationBuild>;
  readBuild(
    workspaceId: WorkspaceId,
    buildId: AssetImplementationBuildId,
  ): Promise<AssetImplementationBuild | undefined>;
  saveRelease(
    release: AssetImplementationRelease,
  ): Promise<AssetImplementationRelease>;
  readRelease(
    releaseId: AssetImplementationReleaseId,
    workspaceId?: WorkspaceId,
  ): Promise<AssetImplementationRelease | undefined>;
  listReleases(
    workspaceId?: WorkspaceId,
  ): Promise<readonly AssetImplementationRelease[]>;
  createBinding(
    binding: AssetImplementationBinding,
  ): Promise<AssetImplementationBinding>;
  readBinding(
    bindingId: AssetImplementationBindingId,
    workspaceId?: WorkspaceId,
  ): Promise<AssetImplementationBinding | undefined>;
  updateBinding(
    binding: AssetImplementationBinding,
    expectedRevision: number,
  ): Promise<AssetImplementationBinding>;
  listBindings(
    workspaceId: WorkspaceId,
  ): Promise<readonly AssetImplementationBinding[]>;
  saveRevocation(
    revocation: AssetImplementationRevocation,
  ): Promise<AssetImplementationRevocation>;
  listRevocations(
    releaseIds?: readonly AssetImplementationReleaseId[],
  ): Promise<readonly AssetImplementationRevocation[]>;
}
