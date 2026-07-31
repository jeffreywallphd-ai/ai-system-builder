import type { StorageObjectChecksum } from "../../../contracts/storage";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { ArtifactFamily } from "../../../domain/artifact";

export interface ArtifactCatalogRecord {
  workspaceId?: WorkspaceId;
  storageKey: string;
  artifactFamily: ArtifactFamily;
  mediaType?: string;
  sizeBytes?: number;
  sourceKind?: "upload" | "generated";
  originalName?: string;
  createdAt?: string;
  checksum?: StorageObjectChecksum;
}
