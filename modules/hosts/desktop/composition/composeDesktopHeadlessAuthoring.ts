import { createHash } from "node:crypto";
import { createStructuredHeadlessOperationStore } from "../../../adapters/persistence/system-builder";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import type { DesktopHeadlessAuthoringWireGrant } from "../../../adapters/transport/headless-loopback";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import {
  readHeadlessAuthoringWireResult, type HeadlessHostIncarnationId,
  type HeadlessSemanticBatchRequest, type HeadlessSystemManagementRequest,
} from "../../../contracts/headless";
import type { LocalIdentityProfile } from "../../../contracts/organization";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { SystemBuilderCompositionRoot } from "../../shared/composition/composeSystemBuilder";
import { composeDesktopWorkspaceAuthorization } from "./composeDesktopWorkspaceAuthorization";

type Request = HeadlessSemanticBatchRequest | HeadlessSystemManagementRequest;
const forbidden = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;

/** Compose against the same registered desktop System Builder, without opening a second store. */
export function composeDesktopHeadlessAuthoring(dependencies: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly identity: LocalIdentityProfile;
  readonly platformDocuments: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly workspaces: Pick<WorkspaceRepository, "readWorkspace">;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly systems: Pick<SystemBuilderCompositionRoot, "composeHeadlessAuthoring">;
  readonly isOpen: () => boolean;
}) {
  const { hostIncarnationId, identity, platformDocuments, rootDirectory, workspaces, authorization, systems, isOpen } = dependencies;
  if (platformDocuments.organizationId !== undefined) throw new Error("The desktop authoring scope is unavailable.");
  const service = systems.composeHeadlessAuthoring({
    operations: createStructuredHeadlessOperationStore(platformDocuments, Date.now, {
      async authorize(owner, scope, operation) {
        if (!isOpen() || scope.organizationId !== identity.organizationId || scope.principalId !== identity.principalId) return false;
        try {
          const repository = createLocalWorkspaceRepository({ rootDirectory, documents: owner.forOrganization(scope.organizationId) });
          const workspace = await repository.readWorkspace(scope.workspaceId);
          if (workspace?.workspaceId !== scope.workspaceId || workspace.organizationId !== scope.organizationId ||
              workspace.status !== "active") return false;
          await composeDesktopWorkspaceAuthorization({ documents: owner, localIdentity: identity }).authorizeWorkspaceOperation({
            workspace, operation: `headless.${operation}`, requiredScopes: ["workspace:read", "asset:read", "asset:write"],
          });
          return isOpen();
        } catch { return false; }
      },
    }),
    digest: (value) => createHash("sha256").update(value).digest("hex"),
    access: { async authorize(workspaceId, operation, scope) {
      if (!isOpen()) throw new Error("The desktop connector is closed.");
      const workspace = await workspaces.readWorkspace(workspaceId);
      if (workspace?.workspaceId !== workspaceId || workspace.organizationId !== identity.organizationId || workspace.status !== "active")
        throw new Error("The workspace is unavailable.");
      await authorization.authorizeWorkspaceOperation({
        workspace, operation: `headless.${operation}`,
        requiredScopes: scope === "asset:write" ? ["workspace:read", "asset:read", "asset:write"] : ["workspace:read", "asset:read"],
      });
      if (!isOpen()) throw new Error("The desktop connector is closed.");
    } },
  });

  return {
    hostIncarnationId,
    async execute(request: Request, initial: DesktopHeadlessAuthoringWireGrant,
      currentGrant: () => Promise<DesktopHeadlessAuthoringWireGrant | undefined>) {
      const { operation, input: { workspaceId } } = request;
      const registeredClientId = initial.registeredClientId;
      const matches = (grant: DesktopHeadlessAuthoringWireGrant | undefined, workspace: WorkspaceId) =>
        Boolean(isOpen() && grant && grant.organizationId === identity.organizationId && grant.principalId === identity.principalId &&
          grant.registeredClientId === registeredClientId && grant.workspaceIds.includes(workspace) &&
          grant.authoring?.includes(operation) && grant.isCurrent?.());
      if (!matches(initial, workspaceId)) return forbidden;
      try {
        const result = await service.execute(request, hostIncarnationId, {
          ...identity, registeredClientId,
          isCurrent: (workspace, requested) => workspace === workspaceId && requested === operation && matches(initial, workspace),
          canUse: async (workspace, requested) => workspace === workspaceId && requested === operation &&
            matches(initial, workspace) && matches(await currentGrant(), workspace),
        });
        if (!matches(initial, workspaceId) || !matches(await currentGrant(), workspaceId)) return forbidden;
        return readHeadlessAuthoringWireResult(result.ok ? result : { ok: false, code: result.error.code });
      } catch { return unavailable; }
    },
  };
}
