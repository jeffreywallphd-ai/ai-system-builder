import type { SystemReleaseId } from "../system-build";
import type { WorkspaceId } from "../workspace";
import type { SystemDataPrincipal, SystemDataValues } from "./system-data-models";

export interface SystemDataContext {
  readonly workspaceId: WorkspaceId;
  readonly releaseId: SystemReleaseId;
  readonly entityType: string;
  readonly principal: SystemDataPrincipal;
}

export interface DescribeSystemDataFormQuery extends SystemDataContext {}

export interface CreateSystemDataRecordCommand extends SystemDataContext {
  readonly recordId: string;
  readonly values: SystemDataValues;
}

export interface ReadSystemDataRecordQuery extends SystemDataContext {
  readonly recordId: string;
}

export interface UpdateSystemDataRecordCommand extends SystemDataContext {
  readonly recordId: string;
  readonly expectedRevision: number;
  readonly values: SystemDataValues;
}

export interface ListSystemDataRecordsQuery extends SystemDataContext {
  readonly limit?: number;
  readonly offset?: number;
}

export interface ListSystemDataAuditQuery extends SystemDataContext {
  readonly limit?: number;
}
