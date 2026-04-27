import type {
  PersistenceOperation,
  PersistenceRecordReference,
  PersistenceResult,
} from "../../../contracts/persistence";
import type { ContractBoundaryContext } from "../../../contracts/shared";

export interface PersistenceRecordOperationRequest
  extends ContractBoundaryContext {
  operation: PersistenceOperation;
  record: PersistenceRecordReference;
}

export type LoadPersistenceRecordRequest = PersistenceRecordOperationRequest;

export interface SavePersistenceRecordRequest<TValue = unknown>
  extends PersistenceRecordOperationRequest {
  value: TValue;
}

export type DeletePersistenceRecordRequest = PersistenceRecordOperationRequest;

export interface PersistenceRecordPort {
  loadRecord<TValue = unknown>(
    request: LoadPersistenceRecordRequest,
  ): Promise<PersistenceResult<TValue | null>>;

  saveRecord<TValue = unknown>(
    request: SavePersistenceRecordRequest<TValue>,
  ): Promise<PersistenceResult<TValue>>;

  deleteRecord(
    request: DeletePersistenceRecordRequest,
  ): Promise<PersistenceResult<boolean>>;
}
