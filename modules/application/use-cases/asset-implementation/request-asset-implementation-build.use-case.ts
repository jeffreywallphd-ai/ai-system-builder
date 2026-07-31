import {
  normalizeAssetImplementationBuild,
  type AssetImplementationBuild,
  type RequestAssetImplementationBuildCommand,
} from "../../../contracts/asset-implementation";
import type {
  AssetImplementationBuilderPort,
  AssetImplementationRepositoryPort,
} from "../../ports/asset-implementation";
import {
  implementationFailure,
  implementationSuccess,
  type AssetImplementationUseCaseResult,
} from "./asset-implementation-use-case-result";

export class RequestAssetImplementationBuildUseCase {
  public constructor(
    private readonly repository: AssetImplementationRepositoryPort,
    private readonly builder: AssetImplementationBuilderPort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async execute(
    command: RequestAssetImplementationBuildCommand,
  ): Promise<AssetImplementationUseCaseResult<AssetImplementationBuild>> {
    const draft = await this.repository.readDraft(
      command.workspaceId,
      command.draftId,
    );
    const snapshot = await this.repository.readSourceSnapshot(
      command.workspaceId,
      command.sourceSnapshotId,
    );
    if (!draft || !snapshot || snapshot.draftId !== draft.draftId)
      return implementationFailure(
        "implementation.build.source-not-found",
        "The exact implementation source snapshot was not found.",
      );
    try {
      const createdAt = this.now();
      const output = await this.builder.build({
        workspaceId: command.workspaceId,
        sourceSnapshot: snapshot,
        toolchainProfile: command.toolchainProfile,
        requestedFacets: command.requestedFacets,
      });
      const completedAt = this.now();
      const build = normalizeAssetImplementationBuild({
        buildId: command.buildId,
        workspaceId: command.workspaceId,
        draftId: command.draftId,
        sourceSnapshotId: command.sourceSnapshotId,
        toolchainProfile: command.toolchainProfile,
        status: output.succeeded ? "succeeded" : "failed",
        requestedFacets: command.requestedFacets,
        outputArtifacts: output.outputArtifacts,
        evidenceArtifacts: output.evidenceArtifacts,
        diagnostics: output.diagnostics,
        createdAt,
        startedAt: createdAt,
        completedAt,
        requestedBy: command.actorId,
      });
      return implementationSuccess(await this.repository.saveBuild(build));
    } catch {
      return implementationFailure(
        "implementation.build.failed",
        "The isolated implementation build failed.",
      );
    }
  }
}
