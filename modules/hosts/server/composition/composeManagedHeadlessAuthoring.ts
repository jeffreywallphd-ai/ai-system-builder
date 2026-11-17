import { createHash } from "node:crypto";

import { createStructuredOrganizationRepositories } from "../../../adapters/persistence/organization";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createStructuredHeadlessOperationStore } from "../../../adapters/persistence/system-builder";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import { AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy } from "../../../application/services/security";
import type { TenantPlacementConfig } from "../../../contracts/config";
import {
  isDesktopHeadlessClientId, parseHeadlessSemanticBatchRequest, parseHeadlessSystemManagementRequest,
  readHeadlessAuthoringWireResult, type HeadlessAuthoringWireResult, type HeadlessHostIncarnationId,
} from "../../../contracts/headless";
import type { OrganizationRequestContext } from "../../../contracts/organization";
import type { SecurityScope } from "../../../contracts/security";
import type { WorkspaceId, WorkspaceRecord } from "../../../contracts/workspace";
import type { SystemBuilderCompositionRoot } from "../../shared/composition/composeSystemBuilder";

const denied = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.operation-unconfirmed" } as const;
const readScopes = ["workspace:read", "asset:read"] as const satisfies readonly SecurityScope[];
const writeScopes = [...readScopes, "asset:write"] as const satisfies readonly SecurityScope[];

/** This registration is supplied by the host after verifying the request's agent purpose. */
export type ManagedHeadlessAuthoringRegistration = Pick<OrganizationRequestContext, "organizationId" | "principalId"> & {
  readonly purpose: "agent";
  readonly registeredClientId: string;
  readonly isCurrent: () => boolean;
};

export function composeManagedHeadlessAuthoring(options: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly platform: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly workspaces: Pick<WorkspaceRepository, "readWorkspace">;
  readonly contexts: OrganizationRequestContextProviderPort;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly placement: TenantPlacementConfig;
  readonly systems: Pick<SystemBuilderCompositionRoot, "composeHeadlessAuthoring">;
}) {
  const { hostIncarnationId, platform, rootDirectory, workspaces, contexts, authorization, placement, systems } = options;
  if (platform.organizationId !== undefined || !platform.runInOwnedTransaction)
    throw new Error("Managed authoring requires the platform transaction owner.");

  return {
    async execute(raw: unknown, registration: ManagedHeadlessAuthoringRegistration, isOpen: () => boolean): Promise<HeadlessAuthoringWireResult> {
      const { organizationId, principalId, registeredClientId } = registration;
      const current = () => {
        const context = contexts.getCurrentOrganizationContext();
        return isOpen() && registration.isCurrent() && context?.organizationId === organizationId && context.principalId === principalId;
      };
      if (registration.purpose !== "agent" || !isDesktopHeadlessClientId(registeredClientId) || !current()) return denied;
      const semantic = parseHeadlessSemanticBatchRequest(raw, hostIncarnationId);
      const management = semantic.ok ? undefined : parseHeadlessSystemManagementRequest(raw, hostIncarnationId);
      const request = semantic.ok ? semantic.request : management?.ok ? management.request : undefined;
      if (!request) return readHeadlessAuthoringWireResult({ ok: false,
        code: !semantic.ok && semantic.code !== "headless.invalid-request" ? semantic.code :
          management && !management.ok ? management.code : "headless.invalid-request",
      });
      const { operation, input: { workspaceId } } = request;
      const isExactWorkspace = (workspace: WorkspaceRecord | undefined): workspace is WorkspaceRecord =>
        workspace?.workspaceId === workspaceId && workspace.organizationId === organizationId && workspace.status === "active";
      const requiredScopes = operation === "systems.preview-edits" ? readScopes : writeScopes;
      const bound = (workspace: WorkspaceId, requested: string) => workspace === workspaceId && requested === operation && current();
      const operationKey = `headless.${operation}`;
      async function authorize(target: WorkspaceId, requested: string): Promise<void> {
        if (!bound(target, requested)) throw new Error("The managed agent request is retired.");
        const workspace = await workspaces.readWorkspace(target);
        if (!isExactWorkspace(workspace) || !current()) throw new Error("Workspace access is unavailable.");
        await authorization.authorizeWorkspaceOperation({workspace, operation: operationKey, requiredScopes});
        if (!current()) throw new Error("The managed agent request is retired.");
      }

      try {
        const service = systems.composeHeadlessAuthoring({
          digest: value => createHash("sha256").update(value).digest("hex"),
          access: { authorize },
          operations: createStructuredHeadlessOperationStore(platform, Date.now, {
            async authorize(owner, scope, requested) {
              if (scope.organizationId !== organizationId || scope.principalId !== principalId ||
                  scope.registeredClientId !== registeredClientId || !bound(scope.workspaceId, requested)) return false;
              const repository = createLocalWorkspaceRepository({rootDirectory, documents: owner.forOrganization(organizationId)});
              const workspace = await repository.readWorkspace(workspaceId);
              if (!isExactWorkspace(workspace) || !current()) return false;
              const policy = createOrganizationAuthorizationPolicy({ ...createStructuredOrganizationRepositories(owner), tenantPlacement: placement });
              const scoped = new AuthorizeWorkspaceOperationService({ organizationContext: contexts, authorizer: {
                async execute(input) {
                  const decision = await policy.authorize(input);
                  if (!decision.allowed) throw new Error("Workspace access is unavailable.");
                },
              } });
              try {
                await scoped.authorizeWorkspaceOperation({workspace, operation: operationKey, requiredScopes});
                return current();
              } catch { return false; }
            },
          }),
        });
        const result = await service.execute(request, hostIncarnationId, { organizationId, principalId, registeredClientId,
          isCurrent: bound, canUse: async (workspace, requested) => bound(workspace, requested),
        });
        if (!current()) return denied;
        if (result.ok) {
          try { await authorize(workspaceId, operation); }
          catch { return denied; }
        }
        if (!current()) return denied;
        return readHeadlessAuthoringWireResult(result.ok ? result : { ok: false, code: result.error.code });
      } catch {
        return current() ? unavailable : denied;
      }
    },
  };
}
