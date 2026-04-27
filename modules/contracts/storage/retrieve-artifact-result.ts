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

export interface RetrieveArtifactValue<
  TContent = Uint8Array,
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
> {
  descriptor: StorageObjectDescriptor<TMetadata>;
  content: TContent;
}

export type RetrieveArtifactResult<
  TContent = Uint8Array,
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
> = ContractResult<RetrieveArtifactValue<TContent, TMetadata>, TDetails>;

export function createRetrieveArtifactSuccessResult<
  TContent,
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
>(
  descriptor: StorageObjectDescriptor<TMetadata>,
  content: TContent,
  context?: ContractBoundaryContext,
): RetrieveArtifactResult<TContent, ContractErrorDetails, TMetadata> {
  return createSuccessResult(
    {
      descriptor: normalizeStorageObjectDescriptor(descriptor),
      content,
    },
    context,
  );
}

export function createRetrieveArtifactFailureResult<
  TContent = Uint8Array,
  TDetails extends ContractErrorDetails = ContractErrorDetails,
>(
  error: ContractError<TDetails>,
  context?: ContractBoundaryContext,
): RetrieveArtifactResult<TContent, TDetails> {
  return createFailureResult(error, context);
}
