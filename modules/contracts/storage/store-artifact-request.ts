import type { ContractBoundaryContext } from "../shared";
import {
  normalizeStorageObjectDescriptorInput,
  type StorageObjectDescriptorInput,
  type StorageObjectMetadata,
} from "./storage-object-descriptor";

export interface StoreArtifactRequest<
  TContent = Uint8Array,
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
> extends ContractBoundaryContext {
  descriptor: StorageObjectDescriptorInput<TMetadata>;
  content: TContent;
  overwrite?: boolean;
}

export function createStoreArtifactRequest<
  TContent,
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
>(
  content: TContent,
  options?: {
    descriptor?: StorageObjectDescriptorInput<TMetadata>;
    overwrite?: boolean;
    requestId?: string;
    correlationId?: string;
  },
): StoreArtifactRequest<TContent, TMetadata> {
  return {
    descriptor: normalizeStorageObjectDescriptorInput(options?.descriptor),
    content,
    overwrite: options?.overwrite,
    requestId: options?.requestId,
    correlationId: options?.correlationId,
  };
}
