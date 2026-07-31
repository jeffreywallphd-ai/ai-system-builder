import type { AssetImplementationReleaseSummary } from "../../../contracts/asset-implementation";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { AssetImplementationRepositoryPort } from "../../ports/asset-implementation";
import {
  assertSafeAssetImplementationReadModel,
  toAssetImplementationReleaseSummary,
} from "../../services/asset-implementation";

export class ListAssetImplementationReleasesUseCase {
  public constructor(
    private readonly repository: AssetImplementationRepositoryPort,
  ) {}

  public async execute(
    workspaceId: WorkspaceId,
  ): Promise<readonly AssetImplementationReleaseSummary[]> {
    const releases = await this.repository.listReleases(workspaceId);
    const revocations = await this.repository.listRevocations(
      releases.map((release) => release.releaseId),
    );
    const result = releases.map((release) =>
      toAssetImplementationReleaseSummary(release, revocations),
    );
    assertSafeAssetImplementationReadModel(result);
    return result;
  }
}
