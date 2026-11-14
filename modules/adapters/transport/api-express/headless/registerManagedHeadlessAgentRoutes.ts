import { raw, type Application, type Request, type Response } from "express";

import {
  HEADLESS_CONTRACT_VERSION, parseHeadlessReadRequest, parseHeadlessSemanticBatchRequest, parseHeadlessSystemManagementRequest,
  readHeadlessAuthoringWireResult, type HeadlessHostIncarnationId, type HeadlessReadOperation,
  type HeadlessReadRequest, type HeadlessReadResult, type HeadlessSemanticBatchRequest, type HeadlessSystemManagementRequest,
} from "../../../../contracts/headless";
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
  readonly identify: (request: AuthAdmission) => Agent | undefined;
  readonly isCurrent: (agent: Agent) => boolean;
  readonly read: (input: HeadlessReadRequest, agent: Agent, current: () => boolean) => Promise<HeadlessReadResult>;
  readonly author: (input: Authoring, agent: Agent, current: () => boolean) => Promise<unknown>;
};

export function registerManagedHeadlessAgentRoutes<Agent extends object>(
  app: Pick<Application, "post">,
  getHandlers: () => ManagedAgentRouteHandlers<Agent> | undefined,
): () => void {
  let open = true;
  const active = new Set<Response>();
  const parse = raw({ limit: MAX_REQUEST_BYTES, type: () => true, inflate: false });
  for (const [kind, path] of Object.entries(MANAGED_HEADLESS_AGENT_PATHS)) {
    app.post(path, (request, response) => {
      response.set({"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"});
      if (request.method !== "POST" || request.originalUrl !== path) return failure(response, 400, "headless.invalid-request");
      const handlers = getHandlers();
      if (!open || !handlers) return failure(response, 404, "headless.unavailable");
      const agent = handlers.identify({
        auth: getExpressAuthContext(request), organization: getExpressOrganizationContext(request),
        organizationHeader: request.headers["x-organization-id"],
      });
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
      parse(request, response, (error?: { status?: number }) => {
        response.removeListener("close", retireBody);
        const result = error
          ? Promise.resolve(failure(response, error.status === 413 ? 413 : 400, "headless.invalid-request"))
          : respond(kind === "read", request.body, response, handlers, agent, current);
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
  read: boolean, body: unknown, response: Response, handlers: ManagedAgentRouteHandlers<Agent>, agent: Agent,
  current: () => boolean,
) {
  if (!current()) return failure(response, 403, "headless.forbidden");
  const value = parseBody(body);
  if (!value) return failure(response, 400, "headless.invalid-request");
  if (read) {
    const parsed = parseHeadlessReadRequest(value, handlers.hostIncarnationId);
    if (!parsed.ok) return failure(response, requestErrorStatus(parsed.code), parsed.code);
    if (!availableReads.includes(parsed.request.operation))
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

function parseBody(body: unknown) {
  if (!Buffer.isBuffer(body) || !body.length || body.length > MAX_REQUEST_BYTES) return undefined;
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
