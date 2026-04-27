const PERSISTENCE_RECORD_TYPE_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PERSISTENCE_RECORD_TYPE_PATTERN =
  /^(?:[a-z0-9]+(?:-[a-z0-9]+)*)(?:\.(?:[a-z0-9]+(?:-[a-z0-9]+)*))*$/;

export const PERSISTENCE_RECORD_TYPE_FORMAT_DESCRIPTION =
  "lowercase dot-separated segments; each segment allows a-z, 0-9, and internal hyphen";

export type PersistenceRecordType = Lowercase<string>;
export type PersistenceRecordId = string;

export interface PersistenceRecordReference {
  recordType: PersistenceRecordType;
  id: PersistenceRecordId;
}

function invalidRecordTypeMessage(recordType: string): string {
  return `Persistence record type must use ${PERSISTENCE_RECORD_TYPE_FORMAT_DESCRIPTION}. Received "${recordType}".`;
}

function invalidRecordIdMessage(id: string): string {
  return `Persistence record id must be a non-empty string. Received "${id}".`;
}

export function isPersistenceRecordType(
  recordType: string,
): recordType is PersistenceRecordType {
  return PERSISTENCE_RECORD_TYPE_PATTERN.test(recordType);
}

export function normalizePersistenceRecordType(
  recordType: string,
): PersistenceRecordType {
  const normalizedSegments = recordType
    .split(".")
    .map((segment) => segment.trim().toLowerCase());

  if (normalizedSegments.length < 1) {
    throw new Error(invalidRecordTypeMessage(recordType));
  }

  for (const segment of normalizedSegments) {
    if (!PERSISTENCE_RECORD_TYPE_SEGMENT_PATTERN.test(segment)) {
      throw new Error(invalidRecordTypeMessage(recordType));
    }
  }

  const normalizedRecordType = normalizedSegments.join(".");

  if (!isPersistenceRecordType(normalizedRecordType)) {
    throw new Error(invalidRecordTypeMessage(recordType));
  }

  return normalizedRecordType;
}

export function normalizePersistenceRecordId(id: string): PersistenceRecordId {
  const normalizedId = id.trim();

  if (normalizedId.length < 1) {
    throw new Error(invalidRecordIdMessage(id));
  }

  return normalizedId;
}

export function createPersistenceRecordReference(
  recordType: string,
  id: string,
): PersistenceRecordReference {
  return {
    recordType: normalizePersistenceRecordType(recordType),
    id: normalizePersistenceRecordId(id),
  };
}

