import {
  type ContractBoundaryContext,
  type ContractError,
  type ContractErrorDetails,
  type ContractResult,
  createFailureResult,
  createSuccessResult,
} from "../shared";
import {
  normalizeStorageObjectDescriptor,
  type StorageObjectDescriptor,
  type StorageObjectMetadata,
} from "./storage-object-descriptor";

export type StoreArtifactResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
> = ContractResult<StorageObjectDescriptor<TMetadata>, TDetails>;

export function createStoreArtifactSuccessResult<
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
>(
  descriptor: StorageObjectDescriptor<TMetadata>,
  context?: ContractBoundaryContext,
): StoreArtifactResult<ContractErrorDetails, TMetadata> {
  return createSuccessResult(normalizeStorageObjectDescriptor(descriptor), context);
}

export function createStoreArtifactFailureResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
>(
  error: ContractError<TDetails>,
  context?: ContractBoundaryContext,
): StoreArtifactResult<TDetails> {
  return createFailureResult(error, context);
}
