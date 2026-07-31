import type {
  AssetPackageContainerV1,
  AssetPackageInspectionSummary,
} from "../../../contracts/asset-package";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface InspectedAssetPackageEntry {
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface InspectedAssetPackage {
  readonly summary: AssetPackageInspectionSummary;
  readonly container?: AssetPackageContainerV1;
  readonly entries: readonly InspectedAssetPackageEntry[];
}

export interface AssetPackageInspectorPort {
  inspect(input: {
    readonly inspectionId: string;
    readonly workspaceId: WorkspaceId;
    readonly bytes: Uint8Array;
    readonly inspectedAt: string;
  }): Promise<InspectedAssetPackage>;
}
