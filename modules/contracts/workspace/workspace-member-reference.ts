import type { WorkspaceActorReference } from "./workspace-actor-reference";
import type { WorkspaceRole } from "./workspace-role";

export const WORKSPACE_MEMBER_STATUSES = ["active", "removed"] as const;

export type WorkspaceMemberStatus = (typeof WORKSPACE_MEMBER_STATUSES)[number];

/**
 * Passive member metadata only. This contract intentionally excludes invite
 * tokens, invite URLs, ACL policies, permission evaluation, sync state, and
 * remote-auth/session fields.
 */
export interface WorkspaceMemberReference {
  readonly actor: WorkspaceActorReference;
  readonly role: WorkspaceRole;
  readonly status?: WorkspaceMemberStatus;
  readonly addedAt?: string;
}

export function isWorkspaceMemberStatus(
  value: unknown,
): value is WorkspaceMemberStatus {
  return WORKSPACE_MEMBER_STATUSES.includes(value as WorkspaceMemberStatus);
}
