import {
  normalizeAssetImplementationRevocation,
  type AssetImplementationRevocation,
  type RevokeAssetImplementationReleaseCommand,
} from "../../../contracts/asset-implementation";
import type { AssetImplementationRepositoryPort } from "../../ports/asset-implementation";
import {
  implementationFailure,
  implementationSuccess,
  type AssetImplementationUseCaseResult,
} from "./asset-implementation-use-case-result";

export class RevokeAssetImplementationReleaseUseCase {
  public constructor(
    private readonly repository: AssetImplementationRepositoryPort,
    private readonly createId: () => string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async execute(
    command: RevokeAssetImplementationReleaseCommand,
  ): Promise<AssetImplementationUseCaseResult<AssetImplementationRevocation>> {
    const release = await this.repository.readRelease(command.releaseId);
    if (!release)
      return implementationFailure(
        "implementation.release.not-found",
        "Implementation release was not found.",
      );
    try {
      const revocation = normalizeAssetImplementationRevocation({
        revocationId: this.createId() as never,
        releaseId: command.releaseId,
        reasonCode: command.reasonCode,
        message: command.message,
        revokedAt: this.now(),
        revokedBy: command.actorId,
      });
      return implementationSuccess(
        await this.repository.saveRevocation(revocation),
      );
    } catch {
      return implementationFailure(
        "implementation.revocation.invalid",
        "The revocation record is invalid or already exists.",
      );
    }
  }
}
