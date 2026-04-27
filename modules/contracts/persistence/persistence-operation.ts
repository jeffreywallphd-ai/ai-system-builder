import {
  OPERATION_IDENTITY_FORMAT_DESCRIPTION,
  createOperationIdentity,
  isOperationIdentity,
  normalizeOperationIdentity,
  type OperationIdentity,
} from "../shared";
import {
  normalizePersistenceRecordType,
  type PersistenceRecordReference,
  type PersistenceRecordType,
} from "./persistence-record-reference";

export type PersistenceOperation = OperationIdentity;

export function isPersistenceOperation(
  value: string,
): value is PersistenceOperation {
  return isOperationIdentity(value);
}

export function normalizePersistenceOperation(
  operation: string,
): PersistenceOperation {
  return normalizeOperationIdentity(operation);
}

export function createPersistenceOperation(
  firstSegment: string,
  secondSegment: string,
  ...remainingSegments: readonly string[]
): PersistenceOperation {
  return createOperationIdentity(firstSegment, secondSegment, ...remainingSegments);
}

export function createPersistenceOperationForRecord(
  recordType: string,
  actionSegment: string,
  ...remainingSegments: readonly string[]
): PersistenceOperation {
  const normalizedRecordType = normalizePersistenceRecordType(recordType);

  return normalizeOperationIdentity(
    [normalizedRecordType, actionSegment, ...remainingSegments].join("."),
  );
}

export function isPersistenceOperationForRecordType(
  operation: PersistenceOperation,
  recordType: PersistenceRecordType,
): boolean {
  return operation.startsWith(`${recordType}.`);
}

export function isPersistenceOperationForRecord(
  operation: PersistenceOperation,
  record: PersistenceRecordReference,
): boolean {
  return isPersistenceOperationForRecordType(operation, record.recordType);
}

export function assertPersistenceOperationMatchesRecord(
  operation: PersistenceOperation,
  record: PersistenceRecordReference,
): void {
  if (isPersistenceOperationForRecord(operation, record)) {
    return;
  }

  throw new Error(
    `Persistence operation "${operation}" must target record type "${record.recordType}" using ${OPERATION_IDENTITY_FORMAT_DESCRIPTION}.`,
  );
}
