import type { RuntimeTaskProgress, RuntimeTaskStatus } from "../runtime";
import { createWorkspaceId, type WorkspaceId } from "../workspace";

import type { DownloadModelRequest } from "./model-management-operations";
import type { ModelInventoryRecord } from "./model-inventory";

export type ModelDownloadPublicModelRecord = Omit<ModelInventoryRecord, "localPath" | "validationReportPath">;

export interface ModelDownloadTaskError {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
}

export interface ModelDownloadTaskActivity {
  readonly requestId: string;
  readonly workspaceId: WorkspaceId;
  readonly modelId: string;
  readonly displayName: string;
  readonly status: RuntimeTaskStatus;
  readonly progress?: RuntimeTaskProgress;
  readonly error?: ModelDownloadTaskError;
  readonly model?: ModelDownloadPublicModelRecord;
  readonly startedAt?: string;
  readonly updatedAt?: string;
  readonly completedAt?: string;
}

export type StartModelDownloadTaskRequest = DownloadModelRequest;

export interface StartModelDownloadTaskResult {
  readonly activity: ModelDownloadTaskActivity;
}

export interface ReadModelDownloadTaskRequest {
  readonly workspaceId: WorkspaceId;
  readonly requestId: string;
}

export interface ReadModelDownloadTaskResult {
  readonly activity: ModelDownloadTaskActivity;
}

export interface ListModelDownloadTasksRequest {
  readonly workspaceId: WorkspaceId;
  readonly includeCompleted?: boolean;
  readonly limit?: number;
}

export interface ListModelDownloadTasksResult {
  readonly activities: readonly ModelDownloadTaskActivity[];
}

export type CancelModelDownloadTaskRequest = ReadModelDownloadTaskRequest;

export interface CancelModelDownloadTaskResult {
  readonly activity: ModelDownloadTaskActivity;
  readonly cancelled: boolean;
}

export function normalizeModelDownloadTaskIdentity<T extends ReadModelDownloadTaskRequest>(request: T): T {
  const requestId = request.requestId.trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) {
    throw new TypeError("Model download task identifier is invalid.");
  }
  return {
    ...request,
    workspaceId: createWorkspaceId(request.workspaceId),
    requestId,
  };
}

export function normalizeListModelDownloadTasksRequest(request: ListModelDownloadTasksRequest): ListModelDownloadTasksRequest {
  const limit = Number.isInteger(request.limit) && (request.limit ?? 0) > 0
    ? Math.min(request.limit!, 100)
    : 50;
  return {
    workspaceId: createWorkspaceId(request.workspaceId),
    includeCompleted: request.includeCompleted === true,
    limit,
  };
}
