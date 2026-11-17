import { raw, type Application, type Request, type Response } from "express";

import {
  HEADLESS_CONTRACT_VERSION, parseHeadlessReadRequest, parseHeadlessSemanticBatchRequest, parseHeadlessSystemManagementRequest,
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
import { hasKnownPassiveCredential, readStrictPassiveRecord } from "../../../../contracts/shared";
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
  readonly author: (input: Authoring, agent: Agent, current: () => boolean) => Promise<unknown>;
  readonly planReview?: (input: HeadlessPlanReviewAgentRequest, agent: Agent, current: () => boolean) => Promise<HeadlessPlanReviewAgentResult>;
  readonly allowLocalFileSave?: boolean;
  readonly allowProviderFileSave?: boolean;
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
      const agent = handlers.identify({
        auth: getExpressAuthContext(request), organization: getExpressOrganizationContext(request),
        organizationHeader: request.headers["x-organization-id"],
      }, kind);
      if (!agent || !handlers.isCurrent(agent)) return failure(response, 403, "headless.forbidden");
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? ""))
        return failure(response, 415, "headless.invalid-request");
      if (active.size >= MAX_ACTIVE_REQUESTS) return failure(response, 503, "headless.unavailable");
      active.add(response);
      const started = performance.now();
      const current = () => open && !response.destroyed && active.has(response) &&
        performance.now() - started < DEADLINE_MS && handlers.isCurrent(agent);
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
  const value = parseBody(incoming.body, kind === "plan-review" ? HEADLESS_PLAN_REVIEW_MAX_REQUEST_BYTES : MAX_REQUEST_BYTES);
  if (!value) return failure(response, 400, "headless.invalid-request");
  if (kind === "plan-review") {
    const parsed = readHeadlessPlanReviewAgentRequest(value, handlers.hostIncarnationId,
      { allowLocalFileSave: handlers.allowLocalFileSave === true, allowProviderFileSave: handlers.allowProviderFileSave === true });
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
  if (kind === "plan-step") {
    const parsed = readHeadlessPlanStepRequest(value, handlers.hostIncarnationId);
    if (!parsed.ok) return failure(response, requestErrorStatus(parsed.code), parsed.code);
    if (!handlers.planStep) return failure(response, 404, "headless.unavailable");
    const outcome = await handlers.planStep(parsed.request, agent, current);
    if (!current()) return failure(response, 403, "headless.forbidden");
    const result = readHeadlessPlanStepResult(outcome.result, parsed.request.input,
      { allowLocalFileSave: handlers.allowLocalFileSave === true, allowProviderFileSave: handlers.allowProviderFileSave === true });
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
    if (parsed.request.operation !== "plan.capabilities" && !availableReads.includes(parsed.request.operation))
      return failure(response, 400, "headless.unsupported-operation");
    const result = await handlers.read(parsed.request, agent, current);
    if (!current()) return failure(response, 403, "headless.forbidden");
    if (!result.ok) {
      const code = readFailures.has(result.code) ? result.code : "headless.unavailable";
      return failure(response, requestErrorStatus(code), code);
    }
    if (result.operation !== parsed.request.operation)
      return failure(response, 503, "headless.unavailable");
    if (result.operation === "host.describe") {
      const {version, hostIncarnationId, workspaces} = result.value;
      if (version !== HEADLESS_CONTRACT_VERSION || hostIncarnationId !== handlers.hostIncarnationId ||
          !Array.isArray(workspaces) || workspaces.length > 128 || workspaces.some(id => !isWorkspaceId(id) || hasKnownPassiveCredential(id)))
        return failure(response, 503, "headless.unavailable");
      return send(response, {ok: true, operation: result.operation,
        value: {version, hostIncarnationId, workspaces, operations: availableReads}});
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

function parseBody(body: unknown, maxBytes: number) {
  if (!Buffer.isBuffer(body) || !body.length || body.length > maxBytes) return undefined;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
    const value = JSON.parse(text);
    if (JSON.stringify(value) !== text) return undefined;
    return readStrictPassiveRecord(value, ["version", "operation", "input"]);
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
