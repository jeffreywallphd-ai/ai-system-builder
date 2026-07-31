import {
  normalizeAssetSourceSnapshot,
  type AssetSourceSnapshot,
  type SnapshotAssetImplementationSourceCommand,
} from "../../../contracts/asset-implementation";
import type {
  AssetImplementationArtifactPort,
  AssetImplementationRepositoryPort,
} from "../../ports/asset-implementation";
import {
  implementationFailure,
  implementationSuccess,
  type AssetImplementationUseCaseResult,
} from "./asset-implementation-use-case-result";

export class SnapshotAssetImplementationSourceUseCase {
  public constructor(
    private readonly repository: AssetImplementationRepositoryPort,
    private readonly artifacts: AssetImplementationArtifactPort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async execute<TContent>(
    command: SnapshotAssetImplementationSourceCommand<TContent>,
  ): Promise<AssetImplementationUseCaseResult<AssetSourceSnapshot>> {
    const draft = await this.repository.readDraft(
      command.workspaceId,
      command.draftId,
    );
    if (!draft)
      return implementationFailure(
        "implementation.draft.not-found",
        "Implementation draft was not found.",
      );
    if (draft.status === "published" || draft.status === "archived")
      return implementationFailure(
        "implementation.draft.closed",
        "Closed implementation drafts cannot accept source snapshots.",
      );
    try {
      const artifact = await this.artifacts.putImmutable({
        workspaceId: command.workspaceId,
        kind: "source",
        content: command.content,
        mediaType: command.mediaType,
      });
      const snapshot = normalizeAssetSourceSnapshot({
        snapshotId: command.snapshotId,
        workspaceId: command.workspaceId,
        draftId: command.draftId,
        artifact,
        createdAt: this.now(),
        createdBy: command.actorId,
      });
      await this.repository.saveSourceSnapshot(snapshot);
      await this.repository.updateDraft(
        {
          ...draft,
          status: "source-snapshotted",
          sourceSnapshotId: snapshot.snapshotId,
          revision: draft.revision + 1,
          updatedAt: snapshot.createdAt,
        },
        draft.revision,
      );
      return implementationSuccess(snapshot);
    } catch {
      return implementationFailure(
        "implementation.source.snapshot-failed",
        "The source snapshot could not be stored.",
      );
    }
  }
}
