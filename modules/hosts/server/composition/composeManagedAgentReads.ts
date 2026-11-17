import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import { ReadHeadlessIngestionStatusUseCase } from "../../../application/use-cases/ingestion-acquisition/headless-ingestion-status.use-case";
import type { ReadHeadlessDatasetMetadataUseCase } from "../../../application/use-cases/dataset-version/headless-dataset-metadata.use-case";
import type {PrepareHeadlessDatasetInputsUseCase} from "../../../application/use-cases/ingestion-acquisition/headless-dataset-preparation.use-case";
import { HEADLESS_CONTRACT_VERSION, isHeadlessDataReadOperation, readHeadlessDatasetPreparationPreview, type HeadlessHostIncarnationId, type HeadlessReadRequest,
  type HeadlessReadResult, type HeadlessSystemManagementRequest } from "../../../contracts/headless";
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
  readonly ingestionTasks?: ConstructorParameters<typeof ReadHeadlessIngestionStatusUseCase>[0];
  readonly getDatasetQueries?: () => Promise<Pick<ReadHeadlessDatasetMetadataUseCase, "execute">>;
  readonly getDatasetInputs?: () => Promise<Pick<PrepareHeadlessDatasetInputsUseCase, "execute">>;
}) {
  return async (request: HeadlessReadRequest, identity: Pick<OrganizationRequestContext, "principalId" | "organizationId"> &
    { readonly purpose?: "agent" | "plan-review" },
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
        workspaces: [], operations: ["host.describe", "templates.list", "systems.read",
          ...(identity.purpose === "plan-review" && options.ingestionTasks ? ["data.ingestion-status" as const] : []),
          ...(identity.purpose === "plan-review" && options.getDatasetQueries ? ["data.dataset-versions", "data.compare-dataset-versions"] as const : []),
          ...(identity.purpose === "plan-review" && options.getDatasetInputs ? ["data.preview-dataset-preparation"] as const : [])]}};
    }
    if (operation !== "templates.list" && operation !== "systems.read" && operation !== "plan.capabilities" &&
        operation !== "data.ingestion-status" && operation !== "data.dataset-versions" && operation !== "data.compare-dataset-versions" &&
        operation !== "data.preview-dataset-preparation")
      return {ok: false, code: "headless.unsupported-operation"};
    if (isHeadlessDataReadOperation(operation) && identity.purpose !== "plan-review") return denied;
    if (input.hostIncarnationId !== options.hostIncarnationId) return {ok: false, code: "headless.host-changed"};
    const authorized = async (workspaceId: WorkspaceId,
      requestedOperation: HeadlessReadRequest["operation"] | HeadlessSystemManagementRequest["operation"] = operation,
      requiresEdit = false) => {
      if (!current()) return false;
      const workspace = await options.workspaces.readWorkspace(workspaceId);
      if (!current() || workspace?.workspaceId !== workspaceId || workspace.organizationId !== identity.organizationId || workspace.status !== "active")
        return false;
      try {
        await options.authorization.authorizeWorkspaceOperation({
          workspace, operation: `headless.${requestedOperation}`,
          requiredScopes: requiresEdit ? ["workspace:read", "asset:read", "asset:write"]
            : isHeadlessDataReadOperation(operation) ? ["workspace:read", "artifact:read"] : ["workspace:read", "asset:read"],
        });
        return current();
      } catch { return false; }
    };
    try {
      if (!await authorized(input.workspaceId) || !current()) return denied;
      if (operation === "data.preview-dataset-preparation") {
        if (!options.getDatasetInputs) return {ok: false, code: "headless.unsupported-operation"};
        const inputs = await options.getDatasetInputs();
        const result = await inputs.execute(request, {hostIncarnationId: options.hostIncarnationId,
          context: {workspaceId: input.workspaceId, organizationId: identity.organizationId, principalId: identity.principalId},
          stillAllowed: () => authorized(input.workspaceId),
        });
        if (!await authorized(input.workspaceId) || !current()) return denied;
        if (!result.ok) return result;
        const value = readHeadlessDatasetPreparationPreview(result.prepared.preview, input);
        return value ? {ok: true, operation, value} : unavailable;
      }
      if (operation === "data.dataset-versions" || operation === "data.compare-dataset-versions") {
        if (!options.getDatasetQueries) return {ok: false, code: "headless.unsupported-operation"};
        const queries = await options.getDatasetQueries();
        const result = await queries.execute(request, {
          context: {workspaceId: input.workspaceId, organizationId: identity.organizationId, principalId: identity.principalId},
          stillAllowed: () => authorized(input.workspaceId),
        });
        return await authorized(input.workspaceId) && current() ? result : denied;
      }
      if (operation === "data.ingestion-status") {
        if (!options.ingestionTasks) return {ok: false, code: "headless.unsupported-operation"};
        const result = await new ReadHeadlessIngestionStatusUseCase(options.ingestionTasks).execute(request, {
          context: {workspaceId: input.workspaceId, organizationId: identity.organizationId, principalId: identity.principalId},
          stillAllowed: () => authorized(input.workspaceId),
        });
        if (!await authorized(input.workspaceId) || !current()) return denied;
        return result.ok ? {ok: true, operation, value: result.value} : result;
      }
      if (operation === "plan.capabilities") {
        const actions: HeadlessSystemManagementRequest["operation"][] = [];
        for (const action of ["systems.create", "systems.rename", "systems.clone"] as const) {
          if (await authorized(input.workspaceId, action, true)) actions.push(action);
        }
        if (!await authorized(input.workspaceId) || !current()) return denied;
        if (actions.length && !await authorized(input.workspaceId, "plan.capabilities", true)) return denied;
        if (!current()) return denied;
        return {ok:true, operation, value:{workspaceId:input.workspaceId, actions, approval:"required"}};
      }
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
