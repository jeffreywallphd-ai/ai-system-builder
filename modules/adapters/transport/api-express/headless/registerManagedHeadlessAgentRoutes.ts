import { raw, type Application, type Request, type Response } from "express";
import {createHash} from "node:crypto";
import {types} from "node:util";
import {readHeadlessTrainingTaskReadRequest, readHeadlessTrainingTaskReadResult, readHeadlessTrainingCompletionRequest, readHeadlessTrainingCompletionResult} from "../../../../contracts/headless";
import {readHeadlessModelTaskRequest, readHeadlessModelTaskValue, readHeadlessModelTaskCancellationRequest,
  isHeadlessModelTaskReadOperation, readHeadlessModelDownloadReviewRequest, readHeadlessModelDownloadReviewResult,
  readHeadlessModelTaskCancellationResult, type HeadlessModelTaskCancellationRequest,
  type HeadlessModelTaskCancellationResult} from "../../../../contracts/headless";

import {readHeadlessContextQueryPreviewValue, readHeadlessContextRebuildValue} from "../../../../contracts/headless";
import {
  HEADLESS_CONTRACT_VERSION, parseHeadlessReadRequest, parseHeadlessSemanticBatchRequest, parseHeadlessSystemManagementRequest,
  readHeadlessIngestionStatusValue,
  isHeadlessDataReadOperation, isHeadlessContextReadOperation, readHeadlessContextModels, readHeadlessContextPreview, readHeadlessDatasetVersionBatch, readHeadlessDatasetComparison,
  readHeadlessDatasetPreparationPreview,
  readHeadlessDatasetTaskStatusValue,
  readHeadlessDatasetTaskReviewValue,
  readHeadlessContextTaskValue,
  readHeadlessContextSavedValue,
  isHeadlessModelReadOperation, readHeadlessModelMetadataRequest, readHeadlessModelInventory, readHeadlessModelRecord,
  readHeadlessModelSourcePreviewRequest, readHeadlessModelSourcePreviewValue,
  readHeadlessAuthoringWireResult, type HeadlessHostIncarnationId, type HeadlessReadOperation,
  isUiControlId, readHeadlessWindowRequest, type HeadlessWindowRequest, type HeadlessWindowResult,
  type HeadlessReadRequest, type HeadlessReadResult, type HeadlessSemanticBatchRequest, type HeadlessSystemManagementRequest,
  HEADLESS_PLAN_REVIEW_MAX_REQUEST_BYTES, readHeadlessPlanReviewAgentRequest, readHeadlessPlanReviewAgentResult,
  type HeadlessPlanReviewAgentRequest, type HeadlessPlanReviewAgentResult,
  readHeadlessPlanStepRequest, readHeadlessPlanStepResult, type HeadlessPlanStepRequest, type HeadlessPlanStepResult,
  readHeadlessLocalFileImportRequest, readHeadlessLocalFileImportResult,
  type HeadlessLocalFileImportRequest, type HeadlessLocalFileImportResult,
  readHeadlessProviderFileImportRequest, readHeadlessProviderFileImportResult,
  type HeadlessProviderFileImportRequest, type HeadlessProviderFileImportResult,
} from "../../../../contracts/headless";
import { isManagedWindowOperation, MANAGED_HEADLESS_AGENT_SESSION_HEADER,
  readManagedWindowResult } from "../../../../contracts/headless";
import { copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord } from "../../../../contracts/shared";
import {isHeadlessWorkflowReadOperation, readHeadlessWorkflowReadResult} from "../../../../contracts/headless";
import { SYSTEM_BUILDER_TEMPLATE_IDS, isSystemBuilderStatus, isSystemBuilderSystemId, normalizeSystemBuilderRevisionId } from "../../../../contracts/system-builder";
import { isWorkspaceId } from "../../../../contracts/workspace";
import { MANAGED_HEADLESS_AGENT_PATHS } from "../security/apiRouteSecurityPolicy";
import { getExpressAuthContext } from "../security/expressAuthContext";
import { getExpressOrganizationContext } from "../security/expressOrganizationContext";

const MAX_REQUEST_BYTES = 8 * 1_024;
const MAX_RESPONSE_BYTES = 128 * 1_024;
const MAX_ACTIVE_REQUESTS = 8;
const DEADLINE_MS = 12_000;
const availableReads: readonly HeadlessReadOperation[] = ["host.describe", "templates.list", "systems.read"];
const readFailures: ReadonlySet<string> = new Set([
  "headless.invalid-request", "headless.unsupported-version", "headless.unsupported-operation", "headless.host-changed",
  "headless.forbidden", "headless.unavailable", "headless.not-found", "headless.result-too-large", "headless.stale",
  "headless.source-not-ready",
]);
type Authoring = HeadlessSemanticBatchRequest | HeadlessSystemManagementRequest;
type AuthAdmission = {
  readonly auth: ReturnType<typeof getExpressAuthContext>;
  readonly organization: ReturnType<typeof getExpressOrganizationContext>;
  readonly organizationHeader: Request["headers"]["x-organization-id"];
};

/** Compose only after TLS, bearer authentication and the central organization policy. */
export type ManagedAgentRouteHandlers<Agent> = {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly identify: (request: AuthAdmission, kind: keyof typeof MANAGED_HEADLESS_AGENT_PATHS) => Agent | undefined;
  readonly isCurrent: (agent: Agent) => boolean;
  readonly read: (input: HeadlessReadRequest, agent: Agent, current: () => boolean) => Promise<HeadlessReadResult>;
  readonly allowWorkflowReads?: boolean;
  readonly author: (input: Authoring, agent: Agent, current: () => boolean) => Promise<unknown>;
  readonly planReview?: (input: HeadlessPlanReviewAgentRequest, agent: Agent, current: () => boolean) => Promise<HeadlessPlanReviewAgentResult>;
  readonly allowLocalFileSave?: boolean;
  readonly allowProviderFileSave?: boolean;
  readonly allowLocalDatasetPreparation?: boolean;
  readonly allowDatasetResultSave?: boolean;
  readonly allowContextPackGeneration?: boolean;
  readonly allowContextRagGeneration?: boolean;
  readonly allowContextResultSave?: boolean;
  readonly allowContextQuery?: boolean;
  readonly allowModelSourceRead?: boolean;
  readonly allowModelDownload?: boolean;
  readonly allowModelReferenceSave?: boolean;
  readonly modelTaskControl?: (input: HeadlessModelTaskCancellationRequest, agent: Agent,
    current: () => boolean) => Promise<HeadlessModelTaskCancellationResult>;
  readonly planStep?: (input: HeadlessPlanStepRequest, agent: Agent, current: () => boolean) => Promise<{
    readonly result: HeadlessPlanStepResult;
    readonly publishIfCurrent?: (publish: () => boolean) => Promise<boolean>;
  }>;
  readonly localFilePreview?: (input: HeadlessLocalFileImportRequest, agent: Agent, current: () => boolean) => Promise<{
    readonly result: HeadlessLocalFileImportResult;
    readonly publishIfCurrent?: (publish: () => boolean) => Promise<boolean>;
  }>;
  readonly providerFilePreview?: (input: HeadlessProviderFileImportRequest, agent: Agent, current: () => boolean) => Promise<{
    readonly result: HeadlessProviderFileImportResult;
    readonly publishIfCurrent?: (publish: () => boolean) => Promise<boolean>;
  }>;
  readonly window?: {
    readonly deliveryEnabled?: boolean;
    readonly execute: (input: HeadlessWindowRequest, agent: Agent, session: string, current: () => boolean) => Promise<HeadlessWindowResult>;
    readonly canPublish: (input: HeadlessWindowRequest, result: HeadlessWindowResult, agent: Agent, session: string) => boolean;
  };
};

export function registerManagedHeadlessAgentRoutes<Agent extends object>(
  app: Pick<Application, "post">,
  getHandlers: () => ManagedAgentRouteHandlers<Agent> | undefined,
): () => void {
  let open = true;
  const active = new Set<Response>();
  const parse = raw({ limit: MAX_REQUEST_BYTES, type: () => true, inflate: false });
  for (const kind of Object.keys(MANAGED_HEADLESS_AGENT_PATHS) as Array<keyof typeof MANAGED_HEADLESS_AGENT_PATHS>) {
    const path = MANAGED_HEADLESS_AGENT_PATHS[kind];
    const parseRequest = kind === "plan-review"
      ? raw({ limit: HEADLESS_PLAN_REVIEW_MAX_REQUEST_BYTES, type: () => true, inflate: false })
      : parse;
    app.post(path, (request, response) => {
      response.set({"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"});
      if (request.method !== "POST" || request.originalUrl !== path) return failure(response, 400, "headless.invalid-request");
      const handlers = getHandlers();
      if (!open || !handlers) return failure(response, 404, "headless.unavailable");
      if (kind === "window" && !handlers.window) return failure(response, 404, "headless.unavailable");
      if (kind === "plan-review" && !handlers.planReview) return failure(response, 404, "headless.unavailable");
      if (kind === "plan-step" && !handlers.planStep) return failure(response, 404, "headless.unavailable");
      if (kind === "local-file-preview" && !handlers.localFilePreview) return failure(response, 404, "headless.unavailable");
      if (kind === "provider-file-preview" && !handlers.providerFilePreview) return failure(response, 404, "headless.unavailable");
      if (kind === "model-task-control" && !handlers.modelTaskControl) return failure(response, 400, "headless.unsupported-operation");
      const checkCurrent = handlers.isCurrent;
      const agent = handlers.identify({
        auth: getExpressAuthContext(request), organization: getExpressOrganizationContext(request),
        organizationHeader: request.headers["x-organization-id"],
      }, kind);
      // Retain the original synchronous authority function across body/handler waits.
      const agentIsCurrent = () => {
        try {
          if (typeof checkCurrent !== "function") return false;
          const value: unknown = checkCurrent.call(handlers, agent!);
          if (types.isPromise(value)) void Promise.prototype.then.call(value, undefined, () => {});
          return value === true;
        } catch {return false;}
      };
      if (!agent || !agentIsCurrent()) return failure(response, 403, "headless.forbidden");
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? ""))
        return failure(response, 415, "headless.invalid-request");
      if (active.size >= MAX_ACTIVE_REQUESTS) return failure(response, 503, "headless.unavailable");
      active.add(response);
      const started = performance.now();
      const current = () => open && !response.destroyed && active.has(response) &&
        performance.now() - started < DEADLINE_MS && agentIsCurrent();
      const timer = setTimeout(() => response.destroy(), DEADLINE_MS);
      const retireBody = () => { clearTimeout(timer); active.delete(response); };
      response.once("close", retireBody);
      parseRequest(request, response, (error?: { status?: number }) => {
        response.removeListener("close", retireBody);
        const result = error
          ? Promise.resolve(failure(response, error.status === 413 ? 413 : 400, "headless.invalid-request"))
          : respond(kind, request, response, handlers, agent, current);
        void result.catch(() => failure(response, 503, "headless.unavailable")).finally(() => {
          clearTimeout(timer);
          active.delete(response);
        });
      });
    });
  }
  return () => {
    open = false;
    for (const response of active) response.destroy();
  };
}

async function respond<Agent>(
  kind: keyof typeof MANAGED_HEADLESS_AGENT_PATHS, incoming: Request, response: Response, handlers: ManagedAgentRouteHandlers<Agent>, agent: Agent,
  current: () => boolean,
) {
  if (!current()) return failure(response, 403, "headless.forbidden");
  const value = parseBody(incoming.body, kind === "plan-review" ? HEADLESS_PLAN_REVIEW_MAX_REQUEST_BYTES : MAX_REQUEST_BYTES, kind === "plan-step");
  if (!value) return failure(response, 400, "headless.invalid-request");
  if (kind === "plan-review") {
    const parsed = readHeadlessPlanReviewAgentRequest(value, handlers.hostIncarnationId,
      { allowLocalFileSave: handlers.allowLocalFileSave === true, allowProviderFileSave: handlers.allowProviderFileSave === true,
        allowLocalDatasetPreparation: handlers.allowLocalDatasetPreparation === true,
        allowDatasetResultSave: handlers.allowDatasetResultSave === true,
        allowContextPackGeneration: handlers.allowContextPackGeneration === true,
        allowContextRagGeneration: handlers.allowContextRagGeneration === true,
        allowContextResultSave: handlers.allowContextResultSave === true, allowContextQuery: handlers.allowContextQuery === true,
        allowModelDownload: handlers.allowModelDownload === true,
        allowModelReferenceSave: handlers.allowModelReferenceSave === true });
    if (!parsed.ok) return failure(response, requestErrorStatus(parsed.code), parsed.code);
    if (!handlers.planReview) return failure(response, 404, "headless.unavailable");
    const input = parsed.request;
    const outcome = await handlers.planReview(input, agent, current);
    if (!current()) return failure(response, 403, "headless.forbidden");
    const result = readHeadlessPlanReviewAgentResult(outcome, input.target.fingerprint,
      input.operation === "plan.submit" ? input.proposal.requests.length : undefined);
    if (!result.ok) return failure(response, requestErrorStatus(result.code), result.code);
    if (result.value.expiresAt <= Date.now()) return failure(response, 410, "headless.plan-expired");
    return send(response, result);
  }
  if (kind === "model-task-control") {
    const parsed = readHeadlessModelTaskCancellationRequest(value, handlers.hostIncarnationId);
    if (!parsed.ok) return failure(response, requestErrorStatus(parsed.code), parsed.code);
    if (!handlers.modelTaskControl) return failure(response, 400, "headless.unsupported-operation");
    const target = parsed.request.input;
    let outcome: unknown;
    try {outcome = await handlers.modelTaskControl(parsed.request, agent, current);}
    catch {outcome = {ok: false, code: "headless.operation-unconfirmed"};}
    if (!current()) return failure(response, 403, "headless.forbidden");
    const decoded = readHeadlessModelTaskCancellationResult(outcome, target);
    // Validation/configuration errors are definitive only before handler entry.
    const result = !decoded.ok && ["headless.invalid-request", "headless.unsupported-operation", "headless.host-changed"].includes(decoded.code)
      ? {ok: false, code: "headless.operation-unconfirmed"} as const : decoded;
    return result.ok ? send(response, result) : failure(response, requestErrorStatus(result.code), result.code);
  }
  if (kind === "plan-step") {
    const parsed = readHeadlessPlanStepRequest(value, handlers.hostIncarnationId);
    if (!parsed.ok) return failure(response, requestErrorStatus(parsed.code), parsed.code);
    if (!handlers.planStep) return failure(response, 404, "headless.unavailable");
    const outcome = await handlers.planStep(parsed.request, agent, current);
    if (!current()) return failure(response, 403, "headless.forbidden");
    const result = readHeadlessPlanStepResult(outcome.result, parsed.request.input,
      { allowLocalFileSave: handlers.allowLocalFileSave === true, allowProviderFileSave: handlers.allowProviderFileSave === true,
        allowLocalDatasetPreparation: handlers.allowLocalDatasetPreparation === true,
        allowDatasetResultSave: handlers.allowDatasetResultSave === true,
        allowContextPackGeneration: handlers.allowContextPackGeneration === true,
        allowContextRagGeneration: handlers.allowContextRagGeneration === true,
        allowContextResultSave: handlers.allowContextResultSave === true, allowContextQuery: handlers.allowContextQuery === true,
        allowModelDownload: handlers.allowModelDownload === true,
        allowModelReferenceSave: handlers.allowModelReferenceSave === true });
    if (!result.ok) return failure(response, requestErrorStatus(result.code), result.code);
    const sent = await outcome.publishIfCurrent?.(() => {
      if (!current() || response.headersSent || result.value.expiresAt <= Date.now()) return false;
      send(response, result);
      return response.statusCode === 200 && response.headersSent;
    });
    if (!sent) return failure(response, 403, "headless.forbidden");
    return;
  }
  if (kind === "local-file-preview" || kind === "provider-file-preview") {
    const input = kind === "provider-file-preview"
      ? readHeadlessProviderFileImportRequest(value, handlers.hostIncarnationId)
      : readHeadlessLocalFileImportRequest(value, handlers.hostIncarnationId);
    if (!input.ok) return failure(response, requestErrorStatus(input.code), input.code);
    const outcome = input.request.operation === "data.prepare-provider-file"
      ? await handlers.providerFilePreview?.(input.request, agent, current)
      : await handlers.localFilePreview?.(input.request, agent, current);
    if (!outcome) return failure(response, 404, "headless.unavailable");
    if (!current()) return failure(response, 403, "headless.forbidden");
    const result = input.request.operation === "data.prepare-provider-file"
      ? readHeadlessProviderFileImportResult(outcome.result, input.request.input)
      : readHeadlessLocalFileImportResult(outcome.result, input.request.input);
    if (!result.ok && result.code !== "headless.stale" && result.code !== "headless.source-not-ready")
      return failure(response, requestErrorStatus(result.code), result.code);
    const sent = await outcome.publishIfCurrent?.(() => {
      const expiresAt = result.ok
        ? ("selectionExpiresAt" in result.value ? result.value.selectionExpiresAt : result.value.checkpointExpiresAt)
        : undefined;
      if (!current() || response.headersSent || (expiresAt !== undefined && Date.now() >= expiresAt)) return false;
      if (result.ok) send(response, result);
      else failure(response, 409, result.code);
      return response.headersSent;
    });
    if (!sent) return failure(response, 403, "headless.forbidden");
    return;
  }
  if (kind === "window") {
    const session = incoming.headers[MANAGED_HEADLESS_AGENT_SESSION_HEADER];
    const input = readHeadlessWindowRequest(value);
    const window = handlers.window;
    if (!input || !isUiControlId(session) || !isManagedWindowOperation(input.operation, window?.deliveryEnabled === true))
      return failure(response, 400, "headless.invalid-request");
    if (!window) return failure(response, 404, "headless.unavailable");
    const raw = await window.execute(input, agent, session, current);
    if (!current() || !window.canPublish(input, raw, agent, session)) return failure(response, 403, "headless.forbidden");
    const result = readManagedWindowResult(raw, input);
    if (!result.ok) return failure(response, requestErrorStatus(result.code), result.code);
    return send(response, result);
  }
  if (kind === "read") {
    const parsed = parseHeadlessReadRequest(value, handlers.hostIncarnationId);
    if (!parsed.ok) return failure(response, requestErrorStatus(parsed.code), parsed.code);
    const dataRead = (isHeadlessModelTaskReadOperation(parsed.request.operation) || (parsed.request.operation === "models.preview-source" && handlers.allowModelSourceRead === true) || isHeadlessModelReadOperation(parsed.request.operation) || isHeadlessDataReadOperation(parsed.request.operation) || isHeadlessContextReadOperation(parsed.request.operation) ||
      parsed.request.operation === "context.task" || parsed.request.operation === "context.saved" || parsed.request.operation === "context.preview-query" || parsed.request.operation === "context.preview-rebuild") && Boolean(handlers.planReview);
    const workflowRead = handlers.allowWorkflowReads === true && isHeadlessWorkflowReadOperation(parsed.request.operation);
    if (!dataRead && !workflowRead && parsed.request.operation !== "plan.capabilities" && !availableReads.includes(parsed.request.operation))
      return failure(response, 400, "headless.unsupported-operation");
    const workflowProof = workflowRead ? parseHeadlessReadRequest(copyBoundedPassiveData(parsed.request), handlers.hostIncarnationId) : undefined;
    if (workflowProof && !workflowProof.ok) return failure(response, 400, "headless.invalid-request");
    if (workflowProof?.ok) {
      if (workflowProof.request.operation === "workflows.prepare") Object.freeze(workflowProof.request.input.source);
      Object.freeze(workflowProof.request.input); Object.freeze(workflowProof.request);
    }
    const questionProof = parsed.request.operation === "context.preview-query" ? (() => {
      const {query, ...target} = parsed.request.input;
      return {target: {...target, reference: {...target.reference}},
        digest: "sha256:" + createHash("sha256").update(query, "utf8").digest("hex")};
    })() : undefined;
    // Keep an independent target so a faulty handler cannot change correlation.
    const completionProof = parsed.request.operation === "models.review-training"
      ? readHeadlessTrainingCompletionRequest(parsed.request, handlers.hostIncarnationId) : undefined;
    const trainingProof = parsed.request.operation === "models.training-task"
      ? readHeadlessTrainingTaskReadRequest(parsed.request, handlers.hostIncarnationId) : undefined;
    const taskProof = parsed.request.operation === "models.task"
      ? readHeadlessModelTaskRequest(parsed.request, handlers.hostIncarnationId) : undefined;
    const reviewProof = parsed.request.operation === "models.review-download"
      ? readHeadlessModelDownloadReviewRequest(parsed.request, handlers.hostIncarnationId) : undefined;
    const modelProof = isHeadlessModelReadOperation(parsed.request.operation)
      ? readHeadlessModelMetadataRequest(parsed.request, handlers.hostIncarnationId) : undefined;
    const sourceProof = parsed.request.operation === "models.preview-source"
      ? readHeadlessModelSourcePreviewRequest(parsed.request, handlers.hostIncarnationId) : undefined;
    if (sourceProof && !sourceProof.ok) return failure(response, 400, "headless.invalid-request");
    if (taskProof && !taskProof.ok) return failure(response, 400, "headless.invalid-request");
    if (reviewProof && !reviewProof.ok) return failure(response, 400, "headless.invalid-request");
    if (modelProof && !modelProof.ok) return failure(response, 400, "headless.invalid-request");
    if (completionProof && !completionProof.ok) return failure(response, 400, "headless.invalid-request");
    if (trainingProof && !trainingProof.ok) return failure(response, 400, "headless.invalid-request");
    const result = await handlers.read(parsed.request, agent, current);
    if (!current()) return failure(response, 403, "headless.forbidden");
    if (completionProof?.ok) {
      const decoded = readHeadlessTrainingCompletionResult(result, completionProof.request.input);
      return decoded.ok ? send(response, decoded) : failure(response, requestErrorStatus(decoded.code), decoded.code);
    }
    if (trainingProof?.ok) {
      const decoded = readHeadlessTrainingTaskReadResult(result, trainingProof.request.input);
      return decoded.ok ? send(response, decoded) : failure(response, requestErrorStatus(decoded.code), decoded.code);
    }
    if (reviewProof?.ok) {
      const decoded = readHeadlessModelDownloadReviewResult(result, reviewProof.request.input);
      return decoded.ok ? send(response, decoded) : failure(response, requestErrorStatus(decoded.code), decoded.code);
    }
    if (!result.ok) {
      const code = readFailures.has(result.code) ? result.code : "headless.unavailable";
      return failure(response, requestErrorStatus(code), code);
    }
    if (workflowProof?.ok) {
      const decoded = readHeadlessWorkflowReadResult(result, workflowProof.request);
      return decoded.ok ? send(response, decoded) : failure(response, requestErrorStatus(decoded.code), decoded.code);
    }
    if (taskProof?.ok) {
      if (result.operation !== "models.task") return failure(response, 503, "headless.unavailable");
      const value = readHeadlessModelTaskValue(result.value, taskProof.request.input);
      return value ? send(response, {ok: true, operation: "models.task", value}) : failure(response, 503, "headless.unavailable");
    }
    if (result.operation !== parsed.request.operation || (questionProof && result.operation !== "context.preview-query") ||
        (modelProof?.ok && result.operation !== modelProof.request.operation) || (sourceProof?.ok && result.operation !== sourceProof.request.operation))
      return failure(response, 503, "headless.unavailable");
    if (result.operation === "host.describe") {
      const {version, hostIncarnationId, workspaces} = result.value;
      if (version !== HEADLESS_CONTRACT_VERSION || hostIncarnationId !== handlers.hostIncarnationId ||
          !Array.isArray(workspaces) || workspaces.length > 128 || workspaces.some(id => !isWorkspaceId(id) || hasKnownPassiveCredential(id)))
        return failure(response, 503, "headless.unavailable");
      return send(response, {ok: true, operation: result.operation,
        value: {version, hostIncarnationId, workspaces, operations: [...availableReads,
          ...(handlers.allowWorkflowReads === true ? result.value.operations.filter(isHeadlessWorkflowReadOperation) : []),
          ...(handlers.planReview ? result.value.operations.filter(operation => isHeadlessModelTaskReadOperation(operation) || operation === "models.preview-source" && handlers.allowModelSourceRead === true || isHeadlessModelReadOperation(operation) || isHeadlessDataReadOperation(operation) ||
            isHeadlessContextReadOperation(operation) || operation === "context.task" || operation === "context.saved" || operation === "context.preview-query" || operation === "context.preview-rebuild") : [])]}});
    }
    if (result.operation === "models.preview-source") {
      if (!sourceProof?.ok) return failure(response, 503, "headless.unavailable");
      const value = readHeadlessModelSourcePreviewValue(result.value, sourceProof.request.input);
      const digest = value ? "sha256:" + createHash("sha256").update(JSON.stringify(value.source), "utf8").digest("hex") : undefined;
      return value && value.manifestDigest === digest ? send(response, {ok: true, operation: result.operation, value})
        : failure(response, 503, "headless.unavailable");
    }
    if (result.operation === "models.inventory") {
      if (!modelProof?.ok || modelProof.request.operation !== result.operation) return failure(response, 503, "headless.unavailable");
      const value = readHeadlessModelInventory(result.value, modelProof.request.input);
      return value ? send(response, {ok: true, operation: result.operation, value}) : failure(response, 503, "headless.unavailable");
    }
    if (result.operation === "models.record") {
      if (!modelProof?.ok || modelProof.request.operation !== result.operation) return failure(response, 503, "headless.unavailable");
      const value = readHeadlessModelRecord(result.value, modelProof.request.input);
      return value ? send(response, {ok: true, operation: result.operation, value}) : failure(response, 503, "headless.unavailable");
    }
    if (result.operation === "context.preview-query") {
      if (!questionProof) return failure(response, 503, "headless.unavailable");
      const value = readHeadlessContextQueryPreviewValue(result.value, questionProof.target, questionProof.digest);
      return value ? send(response, {ok: true, operation: result.operation, value}) : failure(response, 503, "headless.unavailable");
    }
    if (result.operation === "context.preview-rebuild") {
      if (parsed.request.operation !== "context.preview-rebuild") return failure(response, 503, "headless.unavailable");
      const value = readHeadlessContextRebuildValue(result.value, parsed.request.input);
      return value ? send(response, {ok: true, operation: result.operation, value}) : failure(response, 503, "headless.unavailable");
    }
    if (result.operation === "context.saved") {
      if (parsed.request.operation !== "context.saved") return failure(response, 503, "headless.unavailable");
      const value = readHeadlessContextSavedValue(result.value, parsed.request.input.workspaceId, parsed.request.input.contextId);
      return value ? send(response, {ok: true, operation: result.operation, value}) : failure(response, 503, "headless.unavailable");
    }
    if (result.operation === "context.task") {
      if (parsed.request.operation !== "context.task") return failure(response, 503, "headless.unavailable");
      const value = readHeadlessContextTaskValue(result.value, parsed.request.input.selection);
      return value ? send(response, {ok: true, operation: result.operation, value}) : failure(response, 503, "headless.unavailable");
    }
    if (result.operation === "context.models") {
      if (parsed.request.operation !== "context.models") return failure(response, 503, "headless.unavailable");
      const value = readHeadlessContextModels(result.value, parsed.request.input.workspaceId);
      return value ? send(response, {ok: true, operation: result.operation, value}) : failure(response, 503, "headless.unavailable");
    }
    if (result.operation === "context.preview-generation") {
      if (parsed.request.operation !== "context.preview-generation") return failure(response, 503, "headless.unavailable");
      const value = readHeadlessContextPreview(result.value, parsed.request.input);
      return value ? send(response, {ok: true, operation: result.operation, value}) : failure(response, 503, "headless.unavailable");
    }
    if (result.operation === "data.dataset-task-review") {
      if (parsed.request.operation !== "data.dataset-task-review") return failure(response, 503, "headless.unavailable");
      const value = readHeadlessDatasetTaskReviewValue(result.value, parsed.request.input.selection);
      return value ? send(response, {ok: true, operation: result.operation, value}) : failure(response, 503, "headless.unavailable");
    }
    if (result.operation === "data.dataset-task-status") {
      if (parsed.request.operation !== "data.dataset-task-status") return failure(response, 503, "headless.unavailable");
      const value = readHeadlessDatasetTaskStatusValue(result.value, parsed.request.input.selection);
      return value ? send(response, {ok: true, operation: result.operation, value}) : failure(response, 503, "headless.unavailable");
    }
    if (result.operation === "data.dataset-versions") {
      if (parsed.request.operation !== "data.dataset-versions") return failure(response, 503, "headless.unavailable");
      const value = readHeadlessDatasetVersionBatch(result.value, parsed.request.input);
      return value ? send(response, {ok: true, operation: result.operation, value}) : failure(response, 503, "headless.unavailable");
    }
    if (result.operation === "data.preview-dataset-preparation") {
      if (parsed.request.operation !== "data.preview-dataset-preparation") return failure(response, 503, "headless.unavailable");
      const value = readHeadlessDatasetPreparationPreview(result.value, parsed.request.input);
      return value ? send(response, {ok: true, operation: result.operation, value}) : failure(response, 503, "headless.unavailable");
    }
    if (result.operation === "data.compare-dataset-versions") {
      if (parsed.request.operation !== "data.compare-dataset-versions") return failure(response, 503, "headless.unavailable");
      const value = readHeadlessDatasetComparison(result.value, parsed.request.input);
      return value ? send(response, {ok: true, operation: result.operation, value}) : failure(response, 503, "headless.unavailable");
    }
    if (result.operation === "data.ingestion-status") {
      if (parsed.request.operation !== "data.ingestion-status") return failure(response, 503, "headless.unavailable");
      const value = readHeadlessIngestionStatusValue(result.value, parsed.request.input.taskId);
      return value ? send(response, {ok: true, operation: result.operation, value}) : failure(response, 503, "headless.unavailable");
    }
    if (result.operation === "templates.list") {
      if (!Array.isArray(result.value) || result.value.length > 128 ||
          result.value.some(item => !SYSTEM_BUILDER_TEMPLATE_IDS.includes(item.templateId) || !safeLabel(item.displayName)))
        return failure(response, 503, "headless.unavailable");
      return send(response, {ok: true, operation: result.operation,
        value: result.value.map(({templateId, displayName}) => ({templateId, displayName}))});
    }
    if (result.operation === "systems.read") {
      const {systemId, name, revision, status, currentRevisionId} = result.value;
      if (parsed.request.operation !== "systems.read" || systemId !== parsed.request.input.systemId ||
          !isSystemBuilderSystemId(systemId) || hasKnownPassiveCredential(systemId) || !safeLabel(name) ||
          !Number.isSafeInteger(revision) || revision < 1 || !isSystemBuilderStatus(status) ||
          (currentRevisionId !== undefined && (normalizeSystemBuilderRevisionId(currentRevisionId) !== currentRevisionId ||
            hasKnownPassiveCredential(currentRevisionId)))) return failure(response, 503, "headless.unavailable");
      return send(response, {ok: true, operation: result.operation, value: {systemId, name, revision, status, currentRevisionId}});
    }
    if (result.operation === "plan.capabilities") {
      const {workspaceId, actions, approval} = result.value;
      if (parsed.request.operation !== "plan.capabilities" || workspaceId !== parsed.request.input.workspaceId ||
          hasKnownPassiveCredential(workspaceId) || approval !== "required" || !Array.isArray(actions) ||
          actions.length > 3 || new Set(actions).size !== actions.length ||
          actions.some(action => action !== "systems.create" && action !== "systems.rename" && action !== "systems.clone"))
        return failure(response, 503, "headless.unavailable");
      return send(response, {ok:true, operation:result.operation, value:{workspaceId, actions, approval}});
    }
    return failure(response, 503, "headless.unavailable");
  }
  const semantic = parseHeadlessSemanticBatchRequest(value, handlers.hostIncarnationId);
  const management = semantic.ok ? undefined : parseHeadlessSystemManagementRequest(value, handlers.hostIncarnationId);
  const request = semantic.ok ? semantic.request : management?.ok ? management.request : undefined;
  if (!request) {
    const code = !semantic.ok && semantic.code !== "headless.invalid-request" ? semantic.code :
      management && !management.ok ? management.code : "headless.invalid-request";
    return failure(response, requestErrorStatus(code), code);
  }
  const result = readHeadlessAuthoringWireResult(await handlers.author(request, agent, current));
  if (!current()) return failure(response, 403, "headless.forbidden");
  if (!result.ok) return failure(response, requestErrorStatus(result.code), result.code);
  return send(response, result);
}

function safeLabel(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 200 &&
    !/[\u0000-\u001f\u007f]/.test(value) && !hasKnownPassiveCredential(value);
}

function parseBody(body: unknown, maxBytes: number, planStep = false) {
  if (!Buffer.isBuffer(body) || !body.length || body.length > maxBytes) return undefined;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
    const value = JSON.parse(text);
    if (JSON.stringify(value) !== text) return undefined;
    return readStrictPassiveRecord(value, planStep ? ["version", "operation", "input", "transient"] : ["version", "operation", "input"]);
  } catch { return undefined; }
}

function requestErrorStatus(code: string) {
  switch (code) {
    case "headless.forbidden": return 403;
    case "headless.not-found": return 404;
    case "headless.plan-expired": return 410;
    case "headless.idempotency-conflict":
    case "headless.idempotency-expired":
    case "headless.stale":
    case "headless.source-not-ready":
    case "headless.stale-revision":
    case "headless.host-changed": return 409;
    case "headless.invalid-request":
    case "headless.unsupported-version":
    case "headless.unsupported-operation":
    case "headless.invalid-edit-batch": return 400;
    default: return 503;
  }
}

function send(response: Response, value: unknown) {
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) return failure(response, 503, "headless.result-too-large");
  response.status(200).type("application/json").send(body);
}

function failure(response: Response, status: number, code: string): void {
  if (!response.destroyed && !response.headersSent) response.status(status).json({ok: false, code});
}
