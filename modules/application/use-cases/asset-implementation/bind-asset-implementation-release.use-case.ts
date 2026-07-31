import {
  normalizeAssetImplementationBinding,
  type AssetImplementationBinding,
  type BindAssetImplementationReleaseCommand,
} from "../../../contracts/asset-implementation";
import type { AssetImplementationRepositoryPort } from "../../ports/asset-implementation";
import {
  implementationFailure,
  implementationSuccess,
  type AssetImplementationUseCaseResult,
} from "./asset-implementation-use-case-result";

export class BindAssetImplementationReleaseUseCase {
  public constructor(
    private readonly repository: AssetImplementationRepositoryPort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async execute(
    command: BindAssetImplementationReleaseCommand,
  ): Promise<AssetImplementationUseCaseResult<AssetImplementationBinding>> {
    const release = await this.repository.readRelease(
      command.releaseId,
      command.workspaceId,
    );
    if (!release)
      return implementationFailure(
        "implementation.release.not-found",
        "Implementation release was not found.",
      );
    if (
      release.definitionRef.id !== command.definitionRef.id ||
      release.definitionRef.version !== command.definitionRef.version
    )
      return implementationFailure(
        "implementation.binding.definition-mismatch",
        "The binding definition does not match the implementation release.",
      );
    try {
      const timestamp = this.now();
      const binding = normalizeAssetImplementationBinding({
        bindingId: command.bindingId,
        ...(command.workspaceId ? { workspaceId: command.workspaceId } : {}),
        definitionRef: command.definitionRef,
        releaseId: command.releaseId,
        status: "active",
        priority: command.priority ?? 100,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        approvedBy: command.actorId,
      });
      return implementationSuccess(
        await this.repository.createBinding(binding),
      );
    } catch {
      return implementationFailure(
        "implementation.binding.conflict",
        "The implementation binding is invalid or already exists.",
      );
    }
  }
}
