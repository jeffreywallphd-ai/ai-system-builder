export const WORKSPACE_ROLES = ["owner", "admin", "member"] as const;

/**
 * Passive collaboration metadata only. Phase 6 does not introduce permission
 * evaluation, invite flows, remote auth, sync, or multi-user runtime behavior.
 */
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return WORKSPACE_ROLES.includes(value as WorkspaceRole);
}

export function normalizeWorkspaceRole(value: string): WorkspaceRole {
  const normalized = value.trim().toLowerCase();

  if (!isWorkspaceRole(normalized)) {
    throw new Error(
      `Workspace role must be one of ${WORKSPACE_ROLES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
