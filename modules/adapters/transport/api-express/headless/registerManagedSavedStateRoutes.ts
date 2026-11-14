import { raw, type Application, type Request, type RequestHandler, type Response } from "express";

import { parseHeadlessChangeCursor } from "../../../../contracts/headless";
import type { OrganizationRequestContext } from "../../../../contracts/organization";
import { readStrictPassiveRecord } from "../../../../contracts/shared";
import type { SystemBuilderResult } from "../../../../contracts/system-builder";
import { isWorkspaceId, type WorkspaceId } from "../../../../contracts/workspace";
import { getExpressAuthContext } from "../security/expressAuthContext";
import { getExpressOrganizationContext } from "../security/expressOrganizationContext";
import { MANAGED_SAVED_STATE_PATHS } from "../security/apiRouteSecurityPolicy";

const MAX_REQUEST_BYTES = 1_024;
const MAX_RESPONSE_BYTES = 128 * 1_024;
const MAX_IN_FLIGHT = 16;

type FeedCall = (identity: OrganizationRequestContext, workspaceId: WorkspaceId, isCurrent: () => boolean) =>
  Promise<SystemBuilderResult<unknown>>;
export type ManagedSavedStateHandlers = {
  readonly snapshot: FeedCall;
  readonly changes: (
    identity: OrganizationRequestContext, workspaceId: WorkspaceId, isCurrent: () => boolean, cursor: unknown,
  ) => Promise<SystemBuilderResult<unknown>>;
};

/** Mount after existing authentication and membership, before general request-body parsing. */
export function registerManagedSavedStateRoutes(app: Pick<Application, "post">, getHandlers: () => ManagedSavedStateHandlers | undefined): () => void {
  let closed = false;
  let inFlight = 0;
  const readBody = raw({ limit: MAX_REQUEST_BYTES, type: () => true, inflate: false });

  for (const [kind, path] of Object.entries(MANAGED_SAVED_STATE_PATHS)) {
    const handle: RequestHandler = (request, response) => {
      response.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      if (request.originalUrl !== path) return sendFailure(response, 400, "headless.invalid-request");
      const auth = getExpressAuthContext(request);
      const identity = getExpressOrganizationContext(request);
      const expiry = Date.parse(auth?.expiresAt ?? "");
      const current = () => !closed && !response.destroyed && Date.now() < expiry;
      const handlers = getHandlers();
      if (!handlers || closed) return sendFailure(response, 404, "headless.unavailable");
      if (!identity || auth?.authMethod !== "oidc-bearer" || !auth.authenticated || auth.principal.kind !== "user" ||
          auth.principal.principalId !== identity.principalId || !current()) return sendFailure(response, 403, "headless.forbidden");
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) {
        return sendFailure(response, 415, "headless.invalid-request");
      }
      if (inFlight >= MAX_IN_FLIGHT) return sendFailure(response, 503, "headless.unavailable");
      inFlight += 1;
      const release = () => { inFlight -= 1; };
      readBody(request, response, (error?: { status?: number }) => {
        if (error) {
          release();
          sendFailure(response, error.status === 413 ? 413 : 400, "headless.invalid-request");
          return;
        }
        void dispatch(kind === "changes", request, response, identity, current, handlers).finally(release);
      });
    };
    app.post(path, handle);
  }
  return () => { closed = true; };
}

async function dispatch(changes: boolean, request: Request, response: Response, identity: OrganizationRequestContext,
  current: () => boolean, handlers: ManagedSavedStateHandlers): Promise<void> {
  const input = parseBody(request.body, changes);
  if (!input) return sendFailure(response, 400, "headless.invalid-request");
  try {
    if (!current()) return sendFailure(response, 403, "headless.forbidden");
    const result = changes ? await handlers.changes(identity, input.workspaceId, current, input.cursor)
      : await handlers.snapshot(identity, input.workspaceId, current);
    if (!current()) return sendFailure(response, 403, "headless.forbidden");
    if (!result.ok) {
      return result.error.code === "headless.forbidden" ? sendFailure(response, 403, "headless.forbidden")
        : sendFailure(response, 503, "headless.unavailable");
    }
    const body = JSON.stringify(result);
    if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) return sendFailure(response, 503, "headless.unavailable");
    response.status(200).type("application/json").send(body);
  } catch { sendFailure(response, 503, "headless.unavailable"); }
}

function parseBody(body: unknown, changes: boolean) {
  if (!Buffer.isBuffer(body) || !body.length || body.length > MAX_REQUEST_BYTES) return undefined;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
    const data: unknown = JSON.parse(text);
    // Compact JSON prevents duplicate fields and ambiguous encoded input.
    if (JSON.stringify(data) !== text) return undefined;
    const { workspaceId, cursor: rawCursor } = readStrictPassiveRecord(data, changes ? ["workspaceId", "cursor"] : ["workspaceId"]);
    if (!isWorkspaceId(workspaceId)) return undefined;
    const cursor = changes ? parseHeadlessChangeCursor(rawCursor) : undefined;
    return changes && !cursor ? undefined : { workspaceId, cursor };
  } catch { return undefined; }
}

function sendFailure(response: Response, status: number, code: "headless.invalid-request" | "headless.forbidden" | "headless.unavailable"): void {
  if (!response.destroyed && !response.headersSent) response.status(status).json({ ok: false, code });
}
