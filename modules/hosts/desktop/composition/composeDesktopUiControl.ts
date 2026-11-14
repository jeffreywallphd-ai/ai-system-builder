import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createUiControlAuthority } from "../../../application/services/ui-control/ui-control-authority.service";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { HeadlessHostIncarnationId } from "../../../contracts/headless";
import type { LocalIdentityProfile } from "../../../contracts/organization";
import type { WorkspaceId } from "../../../contracts/workspace";
import { composeDesktopWorkspaceAuthorization } from "./composeDesktopWorkspaceAuthorization";

export function composeDesktopUiControl({
  hostIncarnationId, identity, documents, rootDirectory, isOpen,
}: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly identity: LocalIdentityProfile;
  readonly documents: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly isOpen: () => boolean;
}) {
  async function canObserve(workspaceId: WorkspaceId): Promise<boolean> {
    if (!isOpen() || documents.organizationId !== undefined) return false;
    try {
      // This read transaction orders workspace and membership against committed
      // changes in the same database. No prompt or lease may return a result that
      // was denied in this committed view.
      const allowed = await documents.runInTransaction(async transaction => {
        const workspaces = createLocalWorkspaceRepository({
          rootDirectory, documents: transaction.forOrganization(identity.organizationId),
        });
        const workspace = await workspaces.readWorkspace(workspaceId);
        if (workspace?.workspaceId !== workspaceId || workspace.organizationId !== identity.organizationId ||
            workspace.status !== "active") return false;
        await composeDesktopWorkspaceAuthorization({ documents: transaction, localIdentity: identity })
          .authorizeWorkspaceOperation({
            operation: "headless.window.observe", workspace, requiredScopes: ["workspace:read", "asset:read"],
          });
        return true;
      });
      return allowed && isOpen();
    } catch { return false; }
  }
  const authority = createUiControlAuthority({
    hostIncarnationId, now: () => performance.now(), issueId: randomUUID,
    authorize: async (target, agent, interactive) => agent.principalId === identity.principalId &&
      interactive.principalId === identity.principalId && agent.organizationId === identity.organizationId &&
      interactive.organizationId === identity.organizationId && await canObserve(target.workspaceId),
  });
  return { hostIncarnationId, identity, authority, canObserve };
}

export type DesktopUiControlOwner = ReturnType<typeof composeDesktopUiControl>;
