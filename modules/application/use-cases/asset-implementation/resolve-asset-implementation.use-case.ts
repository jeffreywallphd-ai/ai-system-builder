import type {
  AssetImplementationResolutionRequest,
  AssetImplementationResolutionResult,
} from "../../../contracts/asset-implementation";
import type { AssetImplementationRepositoryPort } from "../../ports/asset-implementation";
import type { AssetPackageRepositoryPort } from "../../ports/asset-package";
import {
  assertSafeAssetImplementationReadModel,
  resolveAssetImplementation,
} from "../../services/asset-implementation";

export class ResolveAssetImplementationUseCase {
  public constructor(
    private readonly repository: AssetImplementationRepositoryPort,
    private readonly packages?: Pick<AssetPackageRepositoryPort, "listPackages">,
  ) {}

  public async execute(
    request: AssetImplementationResolutionRequest,
  ): Promise<AssetImplementationResolutionResult> {
    const bindings = await this.repository.listBindings(request.workspaceId);
    const releases = await this.repository.listReleases(request.workspaceId);
    const revocations = await this.repository.listRevocations(
      releases.map((release) => release.releaseId),
    );
    const activePackageDigests = this.packages
      ? new Set(
          (await this.packages.listPackages(request.workspaceId))
            .filter((record) => record.status === "active")
            .map((record) => record.packageDigest),
        )
      : new Set<string>();
    const releaseById = new Map(
      releases.map((release) => [release.releaseId, release]),
    );
    const eligibleBindings = bindings.filter((binding) => {
      if (!String(binding.bindingId).startsWith("package.")) return true;
      const release = releaseById.get(binding.releaseId);
      return Boolean(
        release && activePackageDigests.has(release.packageDigest),
      );
    });
    const result = resolveAssetImplementation(
      request,
      eligibleBindings,
      releases,
      revocations,
    );
    assertSafeAssetImplementationReadModel(result);
    return result;
  }
}
