import type { WorkspaceId } from "./workspace-id";

export interface WorkspaceRequestContext {
  readonly workspaceId: WorkspaceId;
}

export interface WorkspaceScopedRequestContext {
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly workspaceId: WorkspaceId;
}
