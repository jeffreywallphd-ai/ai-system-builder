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

export interface HasArtifactValue<
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
> {
  exists: boolean;
  descriptor?: StorageObjectDescriptor<TMetadata>;
}

export type HasArtifactResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
> = ContractResult<HasArtifactValue<TMetadata>, TDetails>;

export function createHasArtifactSuccessResult<
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
>(
  exists: boolean,
  options?: {
    descriptor?: StorageObjectDescriptor<TMetadata>;
    requestId?: string;
    correlationId?: string;
  },
): HasArtifactResult<ContractErrorDetails, TMetadata> {
  return createSuccessResult(
    {
      exists,
      descriptor: options?.descriptor
        ? normalizeStorageObjectDescriptor(options.descriptor)
        : undefined,
    },
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );
}

export function createHasArtifactFailureResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
>(
  error: ContractError<TDetails>,
  context?: ContractBoundaryContext,
): HasArtifactResult<TDetails> {
  return createFailureResult(error, context);
}
