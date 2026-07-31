export const WORKSPACE_ACTOR_KINDS = [
  "local-user",
  "system",
  "external-user",
] as const;

export type WorkspaceActorKind = (typeof WORKSPACE_ACTOR_KINDS)[number];

/**
 * Passive owner/admin/member attribution metadata. actorId must be a safe
 * reference string, not an auth token, session id, secret, credential blob, or
 * user account contract. external-user is reserved for future collaboration
 * vocabulary only; it does not imply remote auth behavior.
 */
export interface WorkspaceActorReference {
  readonly actorKind: WorkspaceActorKind;
  readonly actorId: string;
  readonly displayName?: string;
}

export type WorkspaceActorRef = WorkspaceActorReference;

export function isWorkspaceActorKind(
  value: unknown,
): value is WorkspaceActorKind {
  return WORKSPACE_ACTOR_KINDS.includes(value as WorkspaceActorKind);
}
