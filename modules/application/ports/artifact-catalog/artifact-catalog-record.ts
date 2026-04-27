import type { StorageObjectChecksum } from "../../../contracts/storage";
import type { ArtifactFamily } from "../../../domain/artifact";

export interface ArtifactCatalogRecord {
  storageKey: string;
  artifactFamily: ArtifactFamily;
  mediaType?: string;
  sizeBytes?: number;
  sourceKind?: "upload";
  originalName?: string;
  createdAt?: string;
  checksum?: StorageObjectChecksum;
}
