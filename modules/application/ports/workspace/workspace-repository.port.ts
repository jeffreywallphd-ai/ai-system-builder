import type { WorkspaceId, WorkspaceRecord } from "../../../contracts/workspace";

/**
 * Persistence-only workspace record repository. This port intentionally contains
 * no workspace creation rules, permission checks, UI behavior, resource scoping,
 * system-pack activation behavior, or global active-workspace state.
 *
 * saveWorkspace is the create-or-replace/upsert seam. updateWorkspace is
 * existing-record-only and adapters must not create a missing workspace record
 * from update calls; missing updates should fail safely according to adapter
 * error policy.
 */
export interface WorkspaceRepository {
  readonly listWorkspaces: () => Promise<readonly WorkspaceRecord[]>;
  readonly readWorkspace: (workspaceId: WorkspaceId) => Promise<WorkspaceRecord | undefined>;
  readonly saveWorkspace: (workspace: WorkspaceRecord) => Promise<void>;
  readonly updateWorkspace: (workspace: WorkspaceRecord) => Promise<void>;
  readonly archiveWorkspace: (workspaceId: WorkspaceId, archivedAt: string) => Promise<WorkspaceRecord | undefined>;
}
