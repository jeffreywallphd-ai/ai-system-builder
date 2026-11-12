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
  resolve(workspaceId: WorkspaceId, releaseId: SystemReleaseId, entityType: string,
    options?: { readonly formInstanceId: string }): Promise<SystemDataResolvedDefinition | undefined>;
}

/** Host-only creation proof. Record updates must retain it; public record views omit it. */
export type PersistedSystemDataRecord = SystemDataRecord & {
  readonly creationSource?: "published-form-v1";
};

export interface SystemDataRepositoryPort {
  createRecordWithAudit(record: PersistedSystemDataRecord, audit: SystemDataAuditEntry): Promise<PersistedSystemDataRecord>;
  updateRecordWithAudit(record: PersistedSystemDataRecord, audit: SystemDataAuditEntry, expectedRevision: number): Promise<PersistedSystemDataRecord>;
  readRecord(workspaceId: WorkspaceId, releaseId: SystemReleaseId, entityType: string, recordId: string): Promise<PersistedSystemDataRecord | undefined>;
  listRecords(workspaceId: WorkspaceId, releaseId: SystemReleaseId, entityType: string): Promise<readonly PersistedSystemDataRecord[]>;
  appendAudit(entry: SystemDataAuditEntry): Promise<void>;
  listAudit(workspaceId: WorkspaceId, releaseId: SystemReleaseId, entityType: string, limit: number): Promise<readonly SystemDataAuditEntry[]>;
}

export function isSupportedSystemDataFieldType(value: string): value is SystemDataFieldDefinition["type"] {
  return ["text", "number", "enum", "date", "relationship"].includes(value);
}
