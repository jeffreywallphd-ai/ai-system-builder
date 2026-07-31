import type { SystemReleaseId } from "../../../contracts/system-build";
import type {
  SystemDataAction,
  SystemDataAuditEntry,
  SystemDataFieldDefinition,
  SystemDataFormDescriptor,
  SystemDataRecord,
} from "../../../contracts/system-data";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface SystemDataResolvedDefinition {
  readonly descriptor: SystemDataFormDescriptor;
  readonly rolesByAction: Readonly<Record<Exclude<SystemDataAction, "audit">, readonly string[]>>;
  readonly unmaskRoles: readonly string[];
}

export interface SystemDataReleaseDefinitionPort {
  resolve(workspaceId: WorkspaceId, releaseId: SystemReleaseId, entityType: string): Promise<SystemDataResolvedDefinition | undefined>;
}

export interface SystemDataRepositoryPort {
  createRecordWithAudit(record: SystemDataRecord, audit: SystemDataAuditEntry): Promise<SystemDataRecord>;
  updateRecordWithAudit(record: SystemDataRecord, audit: SystemDataAuditEntry, expectedRevision: number): Promise<SystemDataRecord>;
  readRecord(workspaceId: WorkspaceId, releaseId: SystemReleaseId, entityType: string, recordId: string): Promise<SystemDataRecord | undefined>;
  listRecords(workspaceId: WorkspaceId, releaseId: SystemReleaseId, entityType: string): Promise<readonly SystemDataRecord[]>;
  appendAudit(entry: SystemDataAuditEntry): Promise<void>;
  listAudit(workspaceId: WorkspaceId, releaseId: SystemReleaseId, entityType: string, limit: number): Promise<readonly SystemDataAuditEntry[]>;
}

export function isSupportedSystemDataFieldType(value: string): value is SystemDataFieldDefinition["type"] {
  return ["text", "number", "enum", "date", "relationship"].includes(value);
}
