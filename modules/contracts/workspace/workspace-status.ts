export const WORKSPACE_STATUSES = ["active", "archived", "deleting"] as const;

export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export function isWorkspaceStatus(value: unknown): value is WorkspaceStatus {
  return WORKSPACE_STATUSES.includes(value as WorkspaceStatus);
}

export function normalizeWorkspaceStatus(value: string): WorkspaceStatus {
  const normalized = value.trim().toLowerCase();

  if (!isWorkspaceStatus(normalized)) {
    throw new Error(
      `Workspace status must be one of ${WORKSPACE_STATUSES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
