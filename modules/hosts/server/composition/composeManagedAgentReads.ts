import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import { HEADLESS_CONTRACT_VERSION, type HeadlessHostIncarnationId, type HeadlessReadRequest, type HeadlessReadResult } from "../../../contracts/headless";
import type { OrganizationRequestContext } from "../../../contracts/organization";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { SystemBuilderCompositionRoot } from "../../shared/composition/composeSystemBuilder";

const denied = {ok: false, code: "headless.forbidden"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;

export function composeManagedAgentReads(options: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly workspaces: Pick<WorkspaceRepository, "readWorkspace">;
  readonly contexts: OrganizationRequestContextProviderPort;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly systems: Pick<SystemBuilderCompositionRoot["useCases"], "listTemplates" | "read">;
}) {
  return async (request: HeadlessReadRequest, identity: Pick<OrganizationRequestContext, "principalId" | "organizationId">,
    isCurrent: () => boolean): Promise<HeadlessReadResult> => {
    const current = () => {
      const context = options.contexts.getCurrentOrganizationContext();
      return isCurrent() && context?.principalId === identity.principalId && context.organizationId === identity.organizationId;
    };
    if (!current()) return denied;
    const {operation, input} = request;
    if (operation === "host.describe") {
      // Discovery gives the host identity only. Operator configuration supplies
      // the exact workspace for later requests without enumerating tenant data.
      return {ok: true, operation, value: {version: HEADLESS_CONTRACT_VERSION, hostIncarnationId: options.hostIncarnationId,
        workspaces: [], operations: ["host.describe", "templates.list", "systems.read"]}};
    }
    if (operation !== "templates.list" && operation !== "systems.read")
      return {ok: false, code: "headless.unsupported-operation"};
    if (input.hostIncarnationId !== options.hostIncarnationId) return {ok: false, code: "headless.host-changed"};
    const authorized = async (workspaceId: WorkspaceId) => {
      if (!current()) return false;
      const workspace = await options.workspaces.readWorkspace(workspaceId);
      if (!current() || workspace?.workspaceId !== workspaceId || workspace.organizationId !== identity.organizationId || workspace.status !== "active")
        return false;
      try {
        await options.authorization.authorizeWorkspaceOperation({workspace, operation: `headless.${operation}`,
          requiredScopes: ["workspace:read", "asset:read"]});
        return current();
      } catch { return false; }
    };
    try {
      if (!await authorized(input.workspaceId) || !current()) return denied;
      if (operation === "templates.list") {
        const templates = await options.systems.listTemplates.execute();
        if (!await authorized(input.workspaceId) || !current()) return denied;
        return {ok: true, operation, value: templates.map(({templateId, displayName}) => ({templateId, displayName}))};
      }
      const record = await options.systems.read.execute({workspaceId: input.workspaceId, systemId: input.systemId});
      if (!await authorized(input.workspaceId) || !current()) return denied;
      if (!record.ok || record.value.systemId !== input.systemId || record.value.targetWorkspaceId !== input.workspaceId || record.value.status === "archived")
        return {ok: false, code: "headless.not-found"};
      const {systemId, name, revision, status, currentRevisionId} = record.value;
      return {ok: true, operation, value: {systemId, name, revision, status, currentRevisionId}};
    } catch { return current() ? unavailable : denied; }
  };
}
