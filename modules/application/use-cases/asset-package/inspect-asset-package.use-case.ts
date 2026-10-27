import { capturePackageInspection } from "../../services/asset-package/capture-package-commands";
import type { WorkspaceAssetAccessPort } from "../../ports/asset/workspace-asset-access.port";
import { requireWorkspaceAssetAccess } from "../../services/asset/workspace-asset-access.service";
import type { AssetImplementationArtifactPort } from "../../ports/asset-implementation";
import type {
  AssetPackageInspectorPort,
  AssetPackageRepositoryPort,
} from "../../ports/asset-package";
import type {
  AssetPackageArtifactDescriptor,
  AssetPackageInspectionSummary,
  InspectAssetPackageCommand,
} from "../../../contracts/asset-package";
import { ASSET_PACKAGE_MEDIA_TYPE } from "../../../contracts/asset-package";
import type { AssetPackageResult } from "./asset-package-result";
import { packageFailure, packageSuccess } from "./asset-package-result";

export class InspectAssetPackageUseCase {
  public constructor(
    private readonly dependencies: {
      readonly workspaceAccess: WorkspaceAssetAccessPort;
      readonly inspector: AssetPackageInspectorPort;
      readonly repository: AssetPackageRepositoryPort;
      readonly artifacts: AssetImplementationArtifactPort;
      readonly nextInspectionId: () => string;
      readonly now: () => string;
    },
  ) {}

  public async execute(command: InspectAssetPackageCommand): Promise<AssetPackageResult<AssetPackageInspectionSummary>> {
    try { command = capturePackageInspection(command); }
    catch { return packageFailure("package-inspection-rejected", "Package could not be safely quarantined."); }
    try { await requireWorkspaceAssetAccess(this.dependencies.workspaceAccess, command.workspaceId, "asset-package.inspect", "asset:write"); }
    catch { return packageFailure("package-workspace-forbidden", "Workspace asset access is unavailable or forbidden."); }
    const inspectionId = this.dependencies.nextInspectionId();
    const inspectedAt = this.dependencies.now();
    const inspected = await this.dependencies.inspector.inspect({
      inspectionId,
      workspaceId: command.workspaceId,
      bytes: command.bytes,
      inspectedAt,
    });
    if (!inspected.container || inspected.summary.issues.some((entry) => entry.code === "package.size.exceeded")) {
      return packageFailure("package-inspection-rejected", "Package could not be safely quarantined.");
    }
    const stored = await this.dependencies.artifacts.putImmutable({
      workspaceId: command.workspaceId,
      kind: "package",
      mediaType: ASSET_PACKAGE_MEDIA_TYPE,
      content: command.bytes,
    });
    const artifact: AssetPackageArtifactDescriptor = {
      artifactId: String(stored.artifactId),
      digest: stored.digest,
      mediaType: ASSET_PACKAGE_MEDIA_TYPE,
      sizeBytes: stored.sizeBytes,
    };
    await this.dependencies.repository.saveInspection({
      inspectionId,
      workspaceId: command.workspaceId,
      summary: inspected.summary,
      artifact,
      createdBy: command.actorId,
      createdAt: inspectedAt,
    });
    return packageSuccess(inspected.summary);
  }
}
