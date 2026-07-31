import type {
  AssetPackageInspectionRecord,
  AssetPackageRecord,
} from "../../../contracts/asset-package";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface AssetPackageRepositoryPort {
  saveInspection(record: AssetPackageInspectionRecord): Promise<AssetPackageInspectionRecord>;
  readInspection(workspaceId: WorkspaceId, inspectionId: string): Promise<AssetPackageInspectionRecord | undefined>;
  savePackage(record: AssetPackageRecord): Promise<AssetPackageRecord>;
  readPackage(workspaceId: WorkspaceId, recordId: string): Promise<AssetPackageRecord | undefined>;
  updatePackage(record: AssetPackageRecord, expectedRevision: number): Promise<AssetPackageRecord>;
  listPackages(workspaceId: WorkspaceId): Promise<readonly AssetPackageRecord[]>;
}
