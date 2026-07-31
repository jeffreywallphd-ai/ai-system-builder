import type {
  AssetImplementationBinding,
  DisableAssetImplementationBindingCommand,
} from "../../../contracts/asset-implementation";
import type { AssetImplementationRepositoryPort } from "../../ports/asset-implementation";
import {
  implementationFailure,
  implementationSuccess,
  type AssetImplementationUseCaseResult,
} from "./asset-implementation-use-case-result";

export class DisableAssetImplementationBindingUseCase {
  public constructor(
    private readonly repository: AssetImplementationRepositoryPort,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async execute(
    command: DisableAssetImplementationBindingCommand,
  ): Promise<AssetImplementationUseCaseResult<AssetImplementationBinding>> {
    const binding = await this.repository.readBinding(
      command.bindingId,
      command.workspaceId,
    );
    if (!binding)
      return implementationFailure(
        "implementation.binding.not-found",
        "Implementation binding was not found.",
      );
    if (binding.revision !== command.expectedRevision)
      return implementationFailure(
        "implementation.binding.conflict",
        "Implementation binding revision changed.",
      );
    if (binding.status === "disabled") return implementationSuccess(binding);
    try {
      return implementationSuccess(
        await this.repository.updateBinding(
          {
            ...binding,
            status: "disabled",
            revision: binding.revision + 1,
            updatedAt: this.now(),
            approvedBy: command.actorId,
          },
          command.expectedRevision,
        ),
      );
    } catch {
      return implementationFailure(
        "implementation.binding.conflict",
        "Implementation binding revision changed.",
      );
    }
  }
}
