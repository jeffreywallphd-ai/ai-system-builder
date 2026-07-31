import {
  normalizeAssetImplementationRelease,
  type AssetImplementationRelease,
  type PublishAssetImplementationReleaseCommand,
} from "../../../contracts/asset-implementation";
import type {
  AssetDefinitionVersionReaderPort,
  AssetImplementationRepositoryPort,
} from "../../ports/asset-implementation";
import { validateAssetImplementationRelease } from "../../services/asset-implementation";
import {
  implementationFailure,
  implementationSuccess,
  type AssetImplementationUseCaseResult,
} from "./asset-implementation-use-case-result";

export class PublishAssetImplementationReleaseUseCase {
  public constructor(
    private readonly repository: AssetImplementationRepositoryPort,
    private readonly definitions: AssetDefinitionVersionReaderPort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async execute(
    command: PublishAssetImplementationReleaseCommand,
  ): Promise<AssetImplementationUseCaseResult<AssetImplementationRelease>> {
    if (command.trustLevel === "system-trusted" && command.actorId !== "system")
      return implementationFailure(
        "implementation.release.system-trust-denied",
        "Only the system installer may publish system-trusted implementations.",
      );
    const definition = await this.definitions.readExactDefinition(
      command.definitionRef,
    );
    if (!definition)
      return implementationFailure(
        "implementation.definition.not-found",
        "The exact asset definition was not found.",
      );

    const timestamp = this.now();
    let release: AssetImplementationRelease;
    try {
      release = normalizeAssetImplementationRelease({
        releaseId: command.releaseId,
        ...(command.workspaceId ? { workspaceId: command.workspaceId } : {}),
        definitionRef: command.definitionRef,
        version: command.version,
        status: "published",
        trustLevel: command.trustLevel,
        ...(command.sourceSnapshotId
          ? { sourceSnapshotId: command.sourceSnapshotId }
          : {}),
        ...(command.sourceBuildId
          ? { sourceBuildId: command.sourceBuildId }
          : {}),
        facets: command.facets,
        packageDigest: command.packageDigest,
        evidenceArtifacts: [],
        createdAt: timestamp,
        publishedAt: timestamp,
        publishedBy: command.actorId,
      });
    } catch {
      return implementationFailure(
        "implementation.release.invalid",
        "The implementation release is invalid.",
      );
    }
    const build =
      command.sourceBuildId && command.workspaceId
        ? await this.repository.readBuild(
            command.workspaceId,
            command.sourceBuildId,
          )
        : undefined;
    const validation = validateAssetImplementationRelease(release, build);
    if (!validation.valid || !validation.release)
      return implementationFailure(
        validation.diagnostics[0]?.code ?? "implementation.release.invalid",
        validation.diagnostics[0]?.message ??
          "The implementation release is invalid.",
      );
    try {
      return implementationSuccess(
        await this.repository.saveRelease(validation.release),
      );
    } catch {
      return implementationFailure(
        "implementation.release.conflict",
        "An immutable implementation release already exists with this identity.",
      );
    }
  }
}
