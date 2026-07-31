import type { ActiveWorkspaceSelection } from "../../../contracts/workspace";

/**
 * Persisted preference/read-model repository for the active workspace selection.
 * Reading this preference never authorizes access, creates workspaces, gates UI,
 * or supplies implicit workspace context to application services.
 */
export interface WorkspaceSelectionRepository {
  readonly readActiveWorkspaceSelection: () => Promise<ActiveWorkspaceSelection>;
  readonly saveActiveWorkspaceSelection: (selection: ActiveWorkspaceSelection) => Promise<void>;
  readonly clearActiveWorkspaceSelection: () => Promise<void>;
}
