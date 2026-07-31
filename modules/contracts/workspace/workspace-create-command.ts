import type { WorkspaceActorReference } from "./workspace-actor-reference";
import type { WorkspaceSettings } from "./workspace-record";

/**
 * Command DTO for future workspace creation use cases. It intentionally accepts
 * no caller-provided workspace id, filesystem path, embedded pack manifest,
 * asset definitions, members/invites, credentials, or activation behavior.
 */
export interface CreateWorkspaceCommand {
  readonly displayName: string;
  readonly description?: string;
  readonly includeSystemFoundationAssets?: boolean;
  readonly ownerActorRef?: WorkspaceActorReference;
  readonly createdByActorRef?: WorkspaceActorReference;
  readonly initialSettings?: WorkspaceSettings;
}
