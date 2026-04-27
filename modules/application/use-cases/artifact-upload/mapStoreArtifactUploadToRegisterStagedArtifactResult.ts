import {
  createRegisterStagedArtifactFailureResult,
  createRegisterStagedArtifactSuccessResult,
  createStagedArtifactDescriptorFromStorageObjectDescriptor,
  type RegisterStagedArtifactResult,
  type IngestionSourceKind,
  type StagedArtifactMetadata,
} from "../../../contracts/ingestion";
import type { StorageObjectDescriptor } from "../../../contracts/storage";
import type {
  ContractBoundaryContext,
  ContractError,
  ContractErrorDetails,
} from "../../../contracts/shared";

export function mapStoreArtifactUploadToRegisterStagedArtifactResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
>(
  result:
    | {
      ok: true;
      descriptor: StorageObjectDescriptor<TMetadata>;
      sourceKind: IngestionSourceKind;
      originalName?: string;
      id?: string;
      createdAt?: string;
    }
    | {
      ok: false;
      error: ContractError<TDetails>;
    },
  context?: ContractBoundaryContext,
): RegisterStagedArtifactResult<TDetails, TMetadata> {
  if (result.ok) {
    return createRegisterStagedArtifactSuccessResult(
      createStagedArtifactDescriptorFromStorageObjectDescriptor(result.descriptor, {
        sourceKind: result.sourceKind,
        originalName: result.originalName,
        id: result.id,
        createdAt: result.createdAt,
      }),
      context,
    );
  }

  return createRegisterStagedArtifactFailureResult(result.error, context);
}
