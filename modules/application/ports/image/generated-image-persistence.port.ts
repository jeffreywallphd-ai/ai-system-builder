import type { ImageGenerationOutput } from "../../../contracts/image-generation";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface PersistGeneratedImageInput {
  workspaceId: WorkspaceId;
  output: ImageGenerationOutput;
  requestId: string;
}

import type { StorageObjectChecksum } from "../../../contracts/storage";

export interface PersistGeneratedImageResult {
  artifactId: string;
  storageKey: string;
  mediaType: string;
  sizeBytes: number;
  checksum: StorageObjectChecksum;
  originalFileName: string;
}

export interface GeneratedImagePersistencePort {
  persistGeneratedImage(input: PersistGeneratedImageInput): Promise<PersistGeneratedImageResult>;
}
