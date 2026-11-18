import type {PreviewHeadlessContextInputsUseCase} from "../../../application/use-cases/context-management/headless-context-preview.use-case";
import type {ReadHeadlessContextTaskUseCase} from "../../../application/use-cases/context-management";
import type {ReadHeadlessContextSavedUseCase} from "../../../application/use-cases/context-management";
import type {ReadHeadlessContextRebuildUseCase} from "../../../application/use-cases/context-management";
import type {PreviewHeadlessContextQueryUseCase} from "../../../application/use-cases/context-management";
import {isHeadlessContextReadOperation, readHeadlessContextModels, readHeadlessContextPreview} from "../../../contracts/headless";
import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import { ReadHeadlessIngestionStatusUseCase } from "../../../application/use-cases/ingestion-acquisition/headless-ingestion-status.use-case";
import type { ReadHeadlessDatasetMetadataUseCase } from "../../../application/use-cases/dataset-version/headless-dataset-metadata.use-case";
import type {PrepareHeadlessDatasetInputsUseCase} from "../../../application/use-cases/ingestion-acquisition/headless-dataset-preparation.use-case";
import type {ReadHeadlessDatasetTaskStatusUseCase} from "../../../application/use-cases/ingestion-acquisition/headless-dataset-task-status.use-case";
import type {ReadHeadlessDatasetTaskReviewUseCase} from "../../../application/use-cases/ingestion-acquisition/headless-dataset-task-review.use-case";
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
  readonly getContextInputs?: () => Promise<Pick<PreviewHeadlessContextInputsUseCase, "execute">>;
  readonly getContextTask?: () => Promise<Pick<ReadHeadlessContextTaskUseCase, "execute">>;
  readonly getContextSaved?: () => Promise<Pick<ReadHeadlessContextSavedUseCase, "execute">>;
  readonly getContextRebuildInputs?: () => Promise<Pick<ReadHeadlessContextRebuildUseCase, "execute">>;
  readonly getContextQueryPreview?: () => Promise<Pick<PreviewHeadlessContextQueryUseCase, "execute">>;
  readonly getDatasetInputs?: () => Promise<Pick<PrepareHeadlessDatasetInputsUseCase, "execute">>;
  readonly getDatasetTaskStatus?: () => Promise<Pick<ReadHeadlessDatasetTaskStatusUseCase, "execute">>;
  readonly getDatasetTaskReview?: () => Promise<Pick<ReadHeadlessDatasetTaskReviewUseCase, "execute">>;
}) {
  return async (request: HeadlessReadRequest, identity: Pick<OrganizationRequestContext, "principalId" | "organizationId"> &
    { readonly purpose?: "agent" | "plan-review"; readonly registeredClientId?: string },
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
        workspaces: [], operations: [
          ...(identity.purpose === "plan-review" && options.getContextInputs ? ["context.models", "context.preview-generation"] as const : []),
          ...(identity.purpose === "plan-review" && options.getContextTask ? ["context.task"] as const : []),"host.describe", "templates.list", "systems.read",
          ...(identity.purpose === "plan-review" && options.getContextSaved ? ["context.saved"] as const : []),
          ...(identity.purpose === "plan-review" && options.getContextRebuildInputs ? ["context.preview-rebuild"] as const : []),
          ...(identity.purpose === "plan-review" && options.getContextQueryPreview ? ["context.preview-query"] as const : []),
          ...(identity.purpose === "plan-review" && options.ingestionTasks ? ["data.ingestion-status" as const] : []),
          ...(identity.purpose === "plan-review" && options.getDatasetQueries ? ["data.dataset-versions", "data.compare-dataset-versions"] as const : []),
          ...(identity.purpose === "plan-review" && options.getDatasetInputs ? ["data.preview-dataset-preparation"] as const : []),
          ...(identity.purpose === "plan-review" && options.getDatasetTaskStatus ? ["data.dataset-task-status"] as const : []),
          ...(identity.purpose === "plan-review" && options.getDatasetTaskReview ? ["data.dataset-task-review"] as const : [])]}};
    }
    if (operation !== "context.preview-query" && operation !== "context.preview-rebuild" && operation !== "context.saved" && operation !== "context.task" && operation !== "context.models" && operation !== "context.preview-generation" && operation !== "templates.list" && operation !== "systems.read" && operation !== "plan.capabilities" &&
        operation !== "data.ingestion-status" && operation !== "data.dataset-versions" && operation !== "data.compare-dataset-versions" &&
        operation !== "data.preview-dataset-preparation" && operation !== "data.dataset-task-status" && operation !== "data.dataset-task-review")
      return {ok: false, code: "headless.unsupported-operation"};
    if ((isHeadlessDataReadOperation(operation) || isHeadlessContextReadOperation(operation) || operation === "context.task" || operation === "context.saved" || operation === "context.preview-query" || operation === "context.preview-rebuild") && identity.purpose !== "plan-review") return denied;
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
            : operation === "context.models" ? ["workspace:read", "model:read"]
            : operation === "context.preview-generation" || operation === "context.preview-query" || operation === "context.preview-rebuild" ? ["workspace:read", "artifact:read", "model:read"]
            : operation === "context.task" || operation === "context.saved" ? ["workspace:read", "artifact:read"]
            : isHeadlessDataReadOperation(operation) ? ["workspace:read", "artifact:read"] : ["workspace:read", "asset:read"],
        });
        return current();
      } catch { return false; }
    };
    try {
      if (!await authorized(input.workspaceId) || !current()) return denied;
      if (operation === "context.preview-query") {
        if (!options.getContextQueryPreview) return {ok: false, code: "headless.unsupported-operation"};
        if (!identity.registeredClientId) return denied;
        const query = await options.getContextQueryPreview();
        if (!current() || !await authorized(input.workspaceId)) return denied;
        const result = await query.execute({version: HEADLESS_CONTRACT_VERSION, operation, input}, {context: {
          workspaceId: input.workspaceId, organizationId: identity.organizationId, principalId: identity.principalId},
          clientId: identity.registeredClientId, isCurrent: current,
          stillAllowed: async () => current() && await authorized(input.workspaceId)});
        return current() && await authorized(input.workspaceId) && current() ? result : denied;
      }
      if (operation === "context.preview-rebuild") {
        if (!options.getContextRebuildInputs) return {ok: false, code: "headless.unsupported-operation"};
        if (!identity.registeredClientId) return denied;
        const rebuild = await options.getContextRebuildInputs();
        if (!current() || !await authorized(input.workspaceId)) return denied;
        const result = await rebuild.execute({version: HEADLESS_CONTRACT_VERSION, operation, input}, {context: {
          workspaceId: input.workspaceId, organizationId: identity.organizationId, principalId: identity.principalId},
          clientId: identity.registeredClientId, isCurrent: current,
          stillAllowed: async () => current() && await authorized(input.workspaceId)});
        return current() && await authorized(input.workspaceId) ? result : denied;
      }
      if (operation === "context.saved") {
        if (!options.getContextSaved) return {ok: false, code: "headless.unsupported-operation"};
        if (!identity.registeredClientId) return denied;
        const saved = await options.getContextSaved();
        if (!current() || !await authorized(input.workspaceId)) return denied;
        const result = await saved.execute({version: HEADLESS_CONTRACT_VERSION, operation, input}, {context: {
          workspaceId: input.workspaceId, organizationId: identity.organizationId, principalId: identity.principalId},
          clientId: identity.registeredClientId, stillAllowed: async () => current() && await authorized(input.workspaceId)});
        return current() && await authorized(input.workspaceId) ? result : denied;
      }
      if (operation === "context.task") {
        if (!options.getContextTask) return {ok: false, code: "headless.unsupported-operation"};
        if (!identity.registeredClientId) return denied;
        const task = await options.getContextTask();
        if (!current() || !await authorized(input.workspaceId)) return denied;
        const result = await task.execute({version: HEADLESS_CONTRACT_VERSION, operation, input}, {context: {
          workspaceId: input.workspaceId, organizationId: identity.organizationId, principalId: identity.principalId},
          clientId: identity.registeredClientId, stillAllowed: async () => current() && await authorized(input.workspaceId)});
        return current() && await authorized(input.workspaceId) ? result : denied;
      }
      if (operation === "context.models" || operation === "context.preview-generation") {
        if (!options.getContextInputs) return {ok: false, code: "headless.unsupported-operation"};
        const inputs = await options.getContextInputs();
        const result = await inputs.execute(request, {hostIncarnationId: options.hostIncarnationId,
          context: {workspaceId: input.workspaceId, organizationId: identity.organizationId, principalId: identity.principalId},
          stillAllowed: () => authorized(input.workspaceId)});
        if (!current() || !await authorized(input.workspaceId)) return denied;
        if (!result.ok) return result;
        if (operation === "context.models" && result.operation === operation) {
          const value = readHeadlessContextModels(result.value, input.workspaceId);
          return value ? {ok: true, operation, value} : unavailable;
        }
        if (operation === "context.preview-generation" && result.operation === operation) {
          const value = readHeadlessContextPreview(result.prepared.preview, input);
          return value ? {ok: true, operation, value} : unavailable;
        }
        return unavailable;
      }
      if (operation === "data.dataset-task-review") {
        if (!options.getDatasetTaskReview) return {ok: false, code: "headless.unsupported-operation"};
        if (!identity.registeredClientId) return denied;
        const review = await options.getDatasetTaskReview();
        const result = await review.execute({version: HEADLESS_CONTRACT_VERSION, operation, input}, {context: {workspaceId: input.workspaceId,
          organizationId: identity.organizationId, principalId: identity.principalId}, clientId: identity.registeredClientId,
          stillAllowed: async () => current() && await authorized(input.workspaceId)});
        return current() && await authorized(input.workspaceId) ? result : denied;
      }
      if (operation === "data.dataset-task-status") {
        if (!options.getDatasetTaskStatus) return {ok: false, code: "headless.unsupported-operation"};
        if (!identity.registeredClientId) return denied;
        const status = await options.getDatasetTaskStatus();
        const result = await status.execute({version: HEADLESS_CONTRACT_VERSION, operation, input}, {context: {workspaceId: input.workspaceId,
          organizationId: identity.organizationId, principalId: identity.principalId}, clientId: identity.registeredClientId,
          stillAllowed: async () => current() && await authorized(input.workspaceId)});
        return current() && await authorized(input.workspaceId) ? result : denied;
      }
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
