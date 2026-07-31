import type { WorkspaceId } from "./workspace-id";

/**
 * Persistable selection preference/read model only. Empty selection is valid,
 * selection does not grant authorization, and workspace-scoped use cases still
 * receive explicit workspace context.
 */
export interface ActiveWorkspaceSelection {
  readonly workspaceId?: WorkspaceId;
  readonly selectedAt?: string;
}
