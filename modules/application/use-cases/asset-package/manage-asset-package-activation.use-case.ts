import type { AssetPackageRepositoryPort } from "../../ports/asset-package";
import type { AssetImplementationRepositoryPort } from "../../ports/asset-implementation";
import type {
  AssetPackageRecord,
  SetAssetPackageActivationCommand,
} from "../../../contracts/asset-package";
import type {
  AssetImplementationBinding,
  AssetImplementationBindingStatus,
} from "../../../contracts/asset-implementation";
import type { AssetPackageResult } from "./asset-package-result";
import { packageFailure, packageSuccess } from "./asset-package-result";

export class ActivateAssetPackageUseCase {
  public constructor(
    private readonly packages: AssetPackageRepositoryPort,
    private readonly implementations: AssetImplementationRepositoryPort,
    private readonly now: () => string,
  ) {}

  public async execute(command: SetAssetPackageActivationCommand): Promise<AssetPackageResult<AssetPackageRecord>> {
    const target = await this.packages.readPackage(command.workspaceId, command.recordId);
    if (!target || !["installed", "disabled", "active"].includes(target.status)) {
      return packageFailure("package-not-activatable", "Package is not available for activation.");
    }
    if (target.status === "active") {
      await setPackageBindingStatus(this.implementations, target, "active", this.now());
      return packageSuccess(target);
    }
    const active = (await this.packages.listPackages(command.workspaceId)).find(
      (item) => item.packageId === target.packageId && item.status === "active",
    );
    const now = this.now();
    if (active) {
      await setPackageBindingStatus(this.implementations, active, "disabled", now);
      await this.packages.updatePackage(
        { ...active, status: "disabled", disabledAt: now, revision: active.revision + 1, updatedAt: now },
        active.revision,
      );
    }
    const activated = await this.packages.updatePackage(
        {
          ...target,
          status: "active",
          activatedBy: command.actorId,
          activatedAt: now,
          previousActiveRecordId: active?.recordId,
          revision: target.revision + 1,
          updatedAt: now,
        },
        target.revision,
      );
    await setPackageBindingStatus(this.implementations, activated, "active", now);
    return packageSuccess(activated);
  }
}

export class DisableAssetPackageUseCase {
  public constructor(
    private readonly packages: AssetPackageRepositoryPort,
    private readonly implementations: AssetImplementationRepositoryPort,
    private readonly now: () => string,
  ) {}
  public async execute(command: SetAssetPackageActivationCommand): Promise<AssetPackageResult<AssetPackageRecord>> {
    const target = await this.packages.readPackage(command.workspaceId, command.recordId);
    if (!target) return packageFailure("package-not-found", "Package was not found.");
    if (target.status === "disabled") {
      await setPackageBindingStatus(this.implementations, target, "disabled", this.now());
      return packageSuccess(target);
    }
    if (!["active", "installed"].includes(target.status)) return packageFailure("package-not-disableable", "Package cannot be disabled.");
    const now = this.now();
    await setPackageBindingStatus(this.implementations, target, "disabled", now);
    return packageSuccess(await this.packages.updatePackage({ ...target, status: "disabled", disabledAt: now, revision: target.revision + 1, updatedAt: now }, target.revision));
  }
}

export class RollbackAssetPackageUseCase {
  public constructor(private readonly packages: AssetPackageRepositoryPort, private readonly activate: ActivateAssetPackageUseCase) {}
  public async execute(command: SetAssetPackageActivationCommand): Promise<AssetPackageResult<AssetPackageRecord>> {
    const current = await this.packages.readPackage(command.workspaceId, command.recordId);
    if (!current?.previousActiveRecordId) return packageFailure("package-rollback-unavailable", "No previous active package is available.");
    return this.activate.execute({ ...command, recordId: current.previousActiveRecordId });
  }
}

export class ListAssetPackagesUseCase {
  public constructor(private readonly packages: AssetPackageRepositoryPort) {}
  public execute(workspaceId: SetAssetPackageActivationCommand["workspaceId"]) {
    return this.packages.listPackages(workspaceId);
  }
}

async function setPackageBindingStatus(
  implementations: AssetImplementationRepositoryPort,
  packageRecord: AssetPackageRecord,
  status: AssetImplementationBindingStatus,
  updatedAt: string,
): Promise<void> {
  const releases = await implementations.listReleases(packageRecord.workspaceId);
  const packageReleaseIds = new Set(
    releases
      .filter((release) => release.packageDigest === packageRecord.packageDigest)
      .map((release) => release.releaseId),
  );
  const bindings = await implementations.listBindings(packageRecord.workspaceId);
  for (const binding of bindings) {
    if (
      packageReleaseIds.has(binding.releaseId) &&
      binding.status !== status
    ) {
      await implementations.updateBinding(
        {
          ...binding,
          status,
          revision: binding.revision + 1,
          updatedAt,
        } satisfies AssetImplementationBinding,
        binding.revision,
      );
    }
  }
}
