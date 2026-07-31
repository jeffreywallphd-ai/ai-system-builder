import type { SystemReleaseId } from "../system-build";
import type { WorkspaceId } from "../workspace";

export type SystemDataAction = "create" | "read" | "update" | "list" | "audit";
export type SystemDataFieldType = "text" | "number" | "enum" | "date" | "relationship";
export type SystemDataValue = string | number | boolean | null;
export type SystemDataValues = Readonly<Record<string, SystemDataValue>>;

export interface SystemDataPrincipal {
  readonly actorId: string;
  readonly roles: readonly string[];
  readonly authenticated: boolean;
}

export interface SystemDataFieldDefinition {
  readonly name: string;
  readonly label: string;
  readonly type: SystemDataFieldType;
  readonly required: boolean;
  readonly enumValues?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly maximumLength?: number;
  readonly relationshipEntity?: string;
  readonly protected?: boolean;
}

export interface SystemDataFormDescriptor {
  readonly schemaVersion: "1.0";
  readonly targetWorkspaceId: WorkspaceId;
  readonly releaseId: SystemReleaseId;
  readonly entityType: string;
  readonly title: string;
  readonly fields: readonly SystemDataFieldDefinition[];
  readonly maximumPageSize: number;
}

export interface SystemDataRecord {
  readonly recordId: string;
  readonly targetWorkspaceId: WorkspaceId;
  readonly releaseId: SystemReleaseId;
  readonly entityType: string;
  readonly revision: number;
  readonly values: SystemDataValues;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface SystemDataRecordPage {
  readonly items: readonly SystemDataRecord[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export type SystemDataAuditOutcome = "allowed" | "denied" | "validation-failed" | "conflict";

export interface SystemDataAuditEntry {
  readonly auditId: string;
  readonly targetWorkspaceId: WorkspaceId;
  readonly releaseId: SystemReleaseId;
  readonly entityType: string;
  readonly action: SystemDataAction;
  readonly outcome: SystemDataAuditOutcome;
  readonly actorId: string;
  readonly recordId?: string;
  readonly changedFields: readonly string[];
  readonly occurredAt: string;
}
