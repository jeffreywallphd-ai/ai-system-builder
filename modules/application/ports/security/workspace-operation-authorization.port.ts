import type { SecurityScope } from "../../../contracts/security";
import type { WorkspaceRecord } from "../../../contracts/workspace";

export interface WorkspaceOperationAuthorizationRequest {
  readonly workspace: WorkspaceRecord;
  readonly operation: string;
  readonly requiredScopes: readonly SecurityScope[];
}

/** Managed-host authorization below transport boundaries. */
export interface WorkspaceOperationAuthorizationPort {
  authorizeWorkspaceOperation(
    request: WorkspaceOperationAuthorizationRequest,
  ): Promise<void>;
}
