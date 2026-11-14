import { createHmac, randomBytes, randomUUID } from "node:crypto";

import type { OpenedPostgresDatabase } from "../../../adapters/persistence/postgres";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createStructuredHeadlessOperationStore } from "../../../adapters/persistence/system-builder";
import type { ManagedSavedStateHandlers } from "../../../adapters/transport/api-express/headless/registerManagedSavedStateRoutes";
import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import { HeadlessCommittedChangesUseCase } from "../../../application/use-cases/system-builder/headless-committed-changes.use-case";
import type { HeadlessHostIncarnationId } from "../../../contracts/headless";
import { systemBuilderFailure } from "../../../contracts/system-builder";
import type { WorkspaceId } from "../../../contracts/workspace";

const denied = () => systemBuilderFailure("headless.forbidden", "Workspace access is unavailable.");

export function composeManagedSavedState(options: {
  readonly documents: StructuredDocumentStore;
  readonly listActiveSystems: NonNullable<OpenedPostgresDatabase["listActiveSystemSummaries"]>;
  readonly workspaces: Pick<WorkspaceRepository, "readWorkspace">;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly contexts: OrganizationRequestContextProviderPort;
}): ManagedSavedStateHandlers {
  const hostIncarnationId = randomUUID() as HeadlessHostIncarnationId;
  const cursorKey = randomBytes(32);
  const feed = createStructuredHeadlessOperationStore(options.documents);
  function prepare(identity: Parameters<ManagedSavedStateHandlers["snapshot"]>[0], workspaceId: WorkspaceId, current: () => boolean) {
    const { organizationId, principalId } = identity;
    const stillCurrent = () => {
      const context = options.contexts.getCurrentOrganizationContext();
      return current() && context?.organizationId === organizationId && context.principalId === principalId;
    };
    if (!stillCurrent() || options.documents.organizationId !== undefined) return undefined;
    const service = new HeadlessCommittedChangesUseCase({
      organizationId, hostIncarnationId, feed, systems: { listRecords: (target) => {
        if (target !== workspaceId || !stillCurrent()) throw new Error("The saved-state scope is unavailable.");
        return options.listActiveSystems(organizationId, target);
      } },
      digest: (body) => createHmac("sha256", cursorKey).update(body).digest("hex"),
      access: { async authorize(target) {
        if (target !== workspaceId || !stillCurrent()) throw new Error("The saved-state owner is unavailable.");
        const workspace = await options.workspaces.readWorkspace(target);
        if (!stillCurrent() || workspace?.workspaceId !== target || workspace.organizationId !== organizationId || workspace.status !== "active")
          throw new Error("The workspace is unavailable.");
        await options.authorization.authorizeWorkspaceOperation({ workspace, operation: "headless.saved-state", requiredScopes: ["workspace:read", "asset:read"] });
      } },
    });
    return { service, reader: { organizationId, scopeId: principalId, canRead: async (target: WorkspaceId) => target === workspaceId && stillCurrent() } };
  }

  return {
    async snapshot(identity, workspaceId, current) {
      const prepared = prepare(identity, workspaceId, current);
      return prepared ? prepared.service.snapshot(workspaceId, prepared.reader) : denied();
    },
    async changes(identity, workspaceId, current, cursor) {
      const prepared = prepare(identity, workspaceId, current);
      return prepared ? prepared.service.changes(workspaceId, cursor, prepared.reader) : denied();
    },
  };
}
