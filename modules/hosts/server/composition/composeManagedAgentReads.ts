import type {PreviewHeadlessContextInputsUseCase} from "../../../application/use-cases/context-management/headless-context-preview.use-case";
import type {ReadHeadlessContextTaskUseCase} from "../../../application/use-cases/context-management";
import type {ReadHeadlessContextSavedUseCase} from "../../../application/use-cases/context-management";
import type {ReadHeadlessContextRebuildUseCase} from "../../../application/use-cases/context-management";
import type {PreviewHeadlessContextQueryUseCase} from "../../../application/use-cases/context-management";
import {isHeadlessContextReadOperation, readHeadlessContextModels, readHeadlessContextPreview} from "../../../contracts/headless";
import {isHeadlessModelReadOperation, readHeadlessModelMetadataRequest, readHeadlessModelInventory, readHeadlessModelRecord} from "../../../contracts/headless";
import type {ReadHeadlessModelMetadataUseCase} from "../../../application/use-cases/model";
import type {PreviewHeadlessModelSourceUseCase} from "../../../application/use-cases/model";
import {readHeadlessModelSourcePreviewRequest} from "../../../contracts/headless";
import {readVerifiedHeadlessModelSourcePreview} from "../../shared/composition/headlessModelSourcePreview";
import {isHeadlessReadCurrent} from "../../shared/composition/headlessReadCurrent";
import {readHeadlessModelTaskRequest, readHeadlessModelTaskValue, isHeadlessModelTaskReadOperation,
  readHeadlessModelDownloadReviewRequest, readHeadlessModelDownloadReviewResult} from "../../../contracts/headless";
import type {OwnedHeadlessModelTaskReader, OwnedHeadlessModelCompletionReader} from "../../shared/composition/headlessModelDownloadTasks";
import type {OwnedHeadlessTrainingTaskReader, OwnedHeadlessTrainingCompletionReader} from "../../shared/composition/headlessModelTrainingTasks";
import {copyHeadlessModelPlanData} from "../../shared/composition/headlessModelDownloadReview";
import {readHeadlessTrainingTaskReadRequest, readHeadlessTrainingTaskReadResult, readHeadlessTrainingCompletionRequest, readHeadlessTrainingCompletionResult} from "../../../contracts/headless";
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
  readonly getModelMetadata?: () => Promise<Pick<ReadHeadlessModelMetadataUseCase, "execute">>;
  readonly readModelTask?: OwnedHeadlessModelTaskReader;
  readonly readModelCompletion?: OwnedHeadlessModelCompletionReader;
  readonly readTrainingTask?: OwnedHeadlessTrainingTaskReader;
  readonly readTrainingReview?: OwnedHeadlessTrainingCompletionReader;
  readonly getModelSource?: () => Promise<Pick<PreviewHeadlessModelSourceUseCase, "execute">>;
  readonly getContextTask?: () => Promise<Pick<ReadHeadlessContextTaskUseCase, "execute">>;
  readonly getContextSaved?: () => Promise<Pick<ReadHeadlessContextSavedUseCase, "execute">>;
  readonly getContextRebuildInputs?: () => Promise<Pick<ReadHeadlessContextRebuildUseCase, "execute">>;
  readonly getContextQueryPreview?: () => Promise<Pick<PreviewHeadlessContextQueryUseCase, "execute">>;
  readonly getDatasetInputs?: () => Promise<Pick<PrepareHeadlessDatasetInputsUseCase, "execute">>;
  readonly getDatasetTaskStatus?: () => Promise<Pick<ReadHeadlessDatasetTaskStatusUseCase, "execute">>;
  readonly getDatasetTaskReview?: () => Promise<Pick<ReadHeadlessDatasetTaskReviewUseCase, "execute">>;
}) {
  const readModelTask = options.readModelTask;
  const readModelCompletion = options.readModelCompletion;
  const trainingReader = options.readTrainingTask;
  const readTrainingTask = trainingReader?.bind(options);
  const completionReader = options.readTrainingReview;
  const readTrainingReview = completionReader?.bind(options);
  return async (request: HeadlessReadRequest, suppliedIdentity: Pick<OrganizationRequestContext, "principalId" | "organizationId"> &
    { readonly purpose?: "agent" | "plan-review"; readonly registeredClientId?: string; readonly modelSourceRead?: true },
    isCurrent: () => boolean): Promise<HeadlessReadResult> => {
    const identity = {organizationId: suppliedIdentity.organizationId, principalId: suppliedIdentity.principalId,
      purpose: suppliedIdentity.purpose, registeredClientId: suppliedIdentity.registeredClientId, modelSourceRead: suppliedIdentity.modelSourceRead};
    const sameIdentity = () => suppliedIdentity.organizationId === identity.organizationId && suppliedIdentity.principalId === identity.principalId &&
      suppliedIdentity.purpose === identity.purpose && suppliedIdentity.registeredClientId === identity.registeredClientId && suppliedIdentity.modelSourceRead === identity.modelSourceRead;
    const current = () => {
      if (!sameIdentity() || !isHeadlessReadCurrent(isCurrent)) return false;
      const context = options.contexts.getCurrentOrganizationContext();
      return sameIdentity() && context?.principalId === identity.principalId && context.organizationId === identity.organizationId;
    };
    if (!current()) return denied;
    const trainingRequest = request.operation === "models.review-training"
      ? readHeadlessTrainingCompletionRequest(copyHeadlessModelPlanData(request), options.hostIncarnationId) : request.operation === "models.training-task"
      ? readHeadlessTrainingTaskReadRequest(copyHeadlessModelPlanData(request), options.hostIncarnationId) : undefined;
    if (trainingRequest && !trainingRequest.ok) return trainingRequest;
    const taskRequest = request.operation === "models.task" ? readHeadlessModelTaskRequest(request, options.hostIncarnationId) : undefined;
    if (taskRequest && !taskRequest.ok) return taskRequest;
    const reviewRequest = request.operation === "models.review-download" ? readHeadlessModelDownloadReviewRequest(request, options.hostIncarnationId) : undefined;
    if (reviewRequest && !reviewRequest.ok) return reviewRequest;
    const modelRequest = isHeadlessModelReadOperation(request.operation) ? readHeadlessModelMetadataRequest(request, options.hostIncarnationId) : undefined;
    const sourceRequest = request.operation === "models.preview-source" ? readHeadlessModelSourcePreviewRequest(request, options.hostIncarnationId) : undefined;
    if (sourceRequest && !sourceRequest.ok) return sourceRequest;
    if (sourceRequest?.ok) {Object.freeze(sourceRequest.request.input); Object.freeze(sourceRequest.request);}
    if (modelRequest && !modelRequest.ok) return modelRequest;
    if (modelRequest?.ok) {
      Object.freeze(modelRequest.request.input);
      Object.freeze(modelRequest.request);
    }
    const capturedRequest = trainingRequest?.ok ? trainingRequest.request : reviewRequest?.ok ? reviewRequest.request : taskRequest?.ok ? taskRequest.request : sourceRequest?.ok ? sourceRequest.request : modelRequest?.ok ? modelRequest.request : request;
    const {operation, input} = capturedRequest;
    if (operation === "host.describe") {
      // Discovery gives the host identity only. Operator configuration supplies
      // the exact workspace for later requests without enumerating tenant data.
      return {ok: true, operation, value: {version: HEADLESS_CONTRACT_VERSION, hostIncarnationId: options.hostIncarnationId,
        workspaces: [], operations: [
          ...(identity.purpose === "plan-review" && options.getModelMetadata ? ["models.inventory", "models.record"] as const : []),
          ...(identity.purpose === "plan-review" && readModelTask ? ["models.task"] as const : []),
          ...(identity.purpose === "plan-review" && readTrainingTask ? ["models.training-task"] as const : []),
          ...(identity.purpose === "plan-review" && readTrainingReview ? ["models.review-training"] as const : []),
          ...(identity.purpose === "plan-review" && readModelCompletion ? ["models.review-download"] as const : []),
          ...(identity.purpose === "plan-review" && identity.modelSourceRead === true && options.getModelSource ? ["models.preview-source"] as const : []),
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
    if (operation !== "models.review-training" && operation !== "models.training-task" && operation !== "models.task" && operation !== "models.review-download" && operation !== "models.preview-source" && operation !== "models.inventory" && operation !== "models.record" && operation !== "context.preview-query" && operation !== "context.preview-rebuild" && operation !== "context.saved" && operation !== "context.task" && operation !== "context.models" && operation !== "context.preview-generation" && operation !== "templates.list" && operation !== "systems.read" && operation !== "plan.capabilities" &&
        operation !== "data.ingestion-status" && operation !== "data.dataset-versions" && operation !== "data.compare-dataset-versions" &&
        operation !== "data.preview-dataset-preparation" && operation !== "data.dataset-task-status" && operation !== "data.dataset-task-review")
      return {ok: false, code: "headless.unsupported-operation"};
    if ((isHeadlessModelTaskReadOperation(operation) || operation === "models.preview-source" || isHeadlessModelReadOperation(operation) || isHeadlessDataReadOperation(operation) || isHeadlessContextReadOperation(operation) || operation === "context.task" || operation === "context.saved" || operation === "context.preview-query" || operation === "context.preview-rebuild") && identity.purpose !== "plan-review") return denied;
    if (operation === "models.preview-source" && identity.modelSourceRead !== true) return denied;
    if (input.hostIncarnationId !== options.hostIncarnationId) return {ok: false, code: "headless.host-changed"};
    const authorized = async (workspaceId: WorkspaceId,
      requestedOperation: HeadlessReadRequest["operation"] | HeadlessSystemManagementRequest["operation"] = operation,
      requiresEdit = false, queryModel = false) => {
      if (!current()) return false;
      const workspace = await options.workspaces.readWorkspace(workspaceId);
      if (!current() || workspace?.workspaceId !== workspaceId || workspace.organizationId !== identity.organizationId || workspace.status !== "active")
        return false;
      try {
        await options.authorization.authorizeWorkspaceOperation({
          workspace, operation: `headless.${requestedOperation}`,
          requiredScopes: operation === "models.preview-source" ? ["workspace:read", "model:read", "provider-credential:use"] : queryModel ? ["workspace:read", "artifact:read", "model:read"] : requiresEdit ? ["workspace:read", "asset:read", "asset:write"]
            : operation === "context.models" || isHeadlessModelTaskReadOperation(operation) || isHeadlessModelReadOperation(operation) ? ["workspace:read", "model:read"]
            : operation === "context.preview-generation" || operation === "context.preview-query" || operation === "context.preview-rebuild" ? ["workspace:read", "artifact:read", "model:read"]
            : operation === "context.task" || operation === "context.saved" ? ["workspace:read", "artifact:read"]
            : isHeadlessDataReadOperation(operation) ? ["workspace:read", "artifact:read"] : ["workspace:read", "asset:read"],
        });
        return current();
      } catch { return false; }
    };
    try {
      if (!await authorized(input.workspaceId) || !current()) return denied;
      if (operation === "models.training-task" || operation === "models.review-training") {
        const reader = operation === "models.review-training" ? readTrainingReview : readTrainingTask;
        const decode = operation === "models.review-training" ? readHeadlessTrainingCompletionResult : readHeadlessTrainingTaskReadResult;
        if (!reader) return {ok: false, code: "headless.unsupported-operation"};
        if (!identity.registeredClientId) return denied;
        let live = true;
        const trainingCurrent = () => (live = live && current());
        const allowed = async () => (live = trainingCurrent() && await authorized(input.workspaceId) && trainingCurrent());
        if (!await allowed()) return denied;
        const result = decode(copyHeadlessModelPlanData(await reader({
          scope: Object.freeze({organizationId: identity.organizationId, principalId: identity.principalId,
            workspaceId: input.workspaceId, registeredClientId: identity.registeredClientId}),
          selection: input.selection, isCurrent: trainingCurrent})), input);
        return await allowed() ? result : denied;
      }
      if (operation === "models.review-download") {
        if (!readModelCompletion) return {ok: false, code: "headless.unsupported-operation"};
        if (!identity.registeredClientId) return denied;
        const result = readHeadlessModelDownloadReviewResult(await readModelCompletion({scope: Object.freeze({
          organizationId: identity.organizationId, principalId: identity.principalId, workspaceId: input.workspaceId,
          registeredClientId: identity.registeredClientId}), selection: input.selection, isCurrent: current}), input);
        return current() && await authorized(input.workspaceId) && current() ? result : denied;
      }
      if (operation === "models.task") {
        if (!readModelTask) return {ok: false, code: "headless.unsupported-operation"};
        if (!identity.registeredClientId) return denied;
        const result = await readModelTask({scope: Object.freeze({organizationId: identity.organizationId,
          principalId: identity.principalId, workspaceId: input.workspaceId, registeredClientId: identity.registeredClientId}),
          selection: input.selection, isCurrent: current});
        if (!current() || !await authorized(input.workspaceId) || !current()) return denied;
        if (!result.ok) return result.code === "headless.forbidden" ? denied : unavailable;
        const value = readHeadlessModelTaskValue(result.value, input);
        return value ? {ok: true, operation, value} : unavailable;
      }
      if (operation === "models.preview-source") {
        if (identity.modelSourceRead !== true) return denied;
        if (!options.getModelSource) return {ok: false, code: "headless.unsupported-operation"};
        if (!identity.registeredClientId) return denied;
        const owner = await options.getModelSource();
        const allowed = async () => current() && await authorized(input.workspaceId) && current();
        if (!await allowed() || !current()) return denied;
        const result = await owner.execute(capturedRequest, {hostIncarnationId: options.hostIncarnationId,
          context: {organizationId: identity.organizationId, principalId: identity.principalId, workspaceId: input.workspaceId},
          clientId: identity.registeredClientId, modelSourceRead: true, stillAllowed: allowed, isCurrent: current});
        if (!await allowed() || !current()) return denied;
        if (!result.ok) return result.code === "headless.forbidden" ? denied : unavailable;
        if (result.operation !== operation || capturedRequest.operation !== operation) return unavailable;
        const value = readVerifiedHeadlessModelSourcePreview(result.value, capturedRequest.input);
        return value ? {ok: true, operation, value} : unavailable;
      }
      if (operation === "models.inventory" || operation === "models.record") {
        if (!options.getModelMetadata) return {ok: false, code: "headless.unsupported-operation"};
        const metadata = await options.getModelMetadata();
        const allowed = async () => current() && await authorized(input.workspaceId) && current();
        if (!await allowed() || !current()) return denied;
        const result = await metadata.execute(capturedRequest, {hostIncarnationId: options.hostIncarnationId,
          context: {workspaceId: input.workspaceId, organizationId: identity.organizationId, principalId: identity.principalId},
          stillAllowed: allowed, isCurrent: current});
        if (!await allowed() || !current()) return denied;
        if (!result.ok) return result.code === "headless.forbidden" ? denied
          : result.code === "headless.not-found" ? {ok: false, code: "headless.not-found"} : unavailable;
        if (operation === "models.inventory" && result.operation === operation) {
          const value = readHeadlessModelInventory(result.value, input);
          return value ? {ok: true, operation, value} : unavailable;
        }
        if (operation === "models.record" && result.operation === operation && capturedRequest.operation === operation) {
          const value = readHeadlessModelRecord(result.value, capturedRequest.input);
          return value ? {ok: true, operation, value} : unavailable;
        }
        return unavailable;
      }
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
          clientId: identity.registeredClientId, isCurrent: current,
          queryStillAllowed: async () => current() && await authorized(input.workspaceId, operation, false, true), stillAllowed: async () => current() && await authorized(input.workspaceId)});
        const queryResult = result.ok && "query" in result.value;
        return current() && await authorized(input.workspaceId, operation, false, queryResult) && current() ? result : denied;
      }
      if (operation === "context.models" || operation === "context.preview-generation") {
        if (!options.getContextInputs) return {ok: false, code: "headless.unsupported-operation"};
        const inputs = await options.getContextInputs();
        const result = await inputs.execute(capturedRequest, {hostIncarnationId: options.hostIncarnationId,
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
        const result = await inputs.execute(capturedRequest, {hostIncarnationId: options.hostIncarnationId,
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
        const result = await queries.execute(capturedRequest, {
          context: {workspaceId: input.workspaceId, organizationId: identity.organizationId, principalId: identity.principalId},
          stillAllowed: () => authorized(input.workspaceId),
        });
        return await authorized(input.workspaceId) && current() ? result : denied;
      }
      if (operation === "data.ingestion-status") {
        if (!options.ingestionTasks) return {ok: false, code: "headless.unsupported-operation"};
        const result = await new ReadHeadlessIngestionStatusUseCase(options.ingestionTasks).execute(capturedRequest, {
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
