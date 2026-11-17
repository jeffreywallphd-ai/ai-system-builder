import { raw, type Application, type Request, type RequestHandler, type Response } from "express";

import { parseHeadlessChangeCursor, type HeadlessChangeCursor, type HeadlessSavedChanges } from "../../../../contracts/headless";
import type { OrganizationRequestContext } from "../../../../contracts/organization";
import { readStrictPassiveRecord } from "../../../../contracts/shared";
import type { SystemBuilderResult } from "../../../../contracts/system-builder";
import { isWorkspaceId, type WorkspaceId } from "../../../../contracts/workspace";
import { getExpressAuthContext } from "../security/expressAuthContext";
import { getExpressOrganizationContext } from "../security/expressOrganizationContext";
import { MANAGED_SAVED_STATE_PATHS } from "../security/apiRouteSecurityPolicy";
import { serveManagedSavedStateStream } from "./serveManagedSavedStateStream";

const MAX_REQUEST_BYTES = 1_024;
const MAX_RESPONSE_BYTES = 128 * 1_024;
const MAX_IN_FLIGHT = 16;
const MAX_STREAMS = 8;

type FeedCall = (identity: OrganizationRequestContext, workspaceId: WorkspaceId, isCurrent: () => boolean) =>
  Promise<SystemBuilderResult<unknown>>;
export type ManagedSavedStateHandlers = {
  readonly snapshot: FeedCall;
  readonly changes: (
    identity: OrganizationRequestContext, workspaceId: WorkspaceId, isCurrent: () => boolean, cursor: unknown,
  ) => Promise<SystemBuilderResult<HeadlessSavedChanges>>;
};

/** Mount after existing authentication and membership, before general request-body parsing. */
export function registerManagedSavedStateRoutes(app: Pick<Application, "post">, getHandlers: () => ManagedSavedStateHandlers | undefined): () => void {
  let closed = false;
  let inFlight = 0;
  let streamCount = 0;
  const activeStreams = new Map<AbortController, Response>();
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
      const streaming = kind === "stream";
      if (inFlight >= MAX_IN_FLIGHT || (streaming && streamCount >= MAX_STREAMS))
        return sendFailure(response, 503, "headless.unavailable");
      inFlight += 1;
      if (streaming) streamCount += 1;
      const release = () => { inFlight -= 1; if (streaming) streamCount -= 1; };
      const bodyDeadline = setTimeout(() => response.destroy(), 5_000);
      readBody(request, response, (error?: { status?: number }) => {
        clearTimeout(bodyDeadline);
        if (error) {
          release();
          sendFailure(response, error.status === 413 ? 413 : 400, "headless.invalid-request");
          return;
        }
        if (streaming) {
          const input = parseBody(request.body, true);
          if (!input?.cursor || !current()) {
            release();
            sendFailure(response, input?.cursor ? 403 : 400, input?.cursor ? "headless.forbidden" : "headless.invalid-request");
            return;
          }
          const cancel = new AbortController();
          const disconnected = () => cancel.abort();
          response.once("close", disconnected);
          activeStreams.set(cancel, response);
          void streamUpdates(response, input.workspaceId, input.cursor, identity, current, handlers, cancel).finally(() => {
            response.removeListener("close", disconnected);
            activeStreams.delete(cancel);
            release();
          });
          return;
        }
        void dispatch(kind === "changes", request, response, identity, current, handlers).finally(release);
      });
    };
    app.post(path, handle);
  }
  return () => {
    closed = true;
    for (const [cancel, response] of activeStreams) {
      cancel.abort();
      response.destroy();
    }
  };
}

async function streamUpdates(response: Response, workspaceId: WorkspaceId, cursor: HeadlessChangeCursor,
  identity: OrganizationRequestContext, current: () => boolean, handlers: ManagedSavedStateHandlers, cancel: AbortController) {
  const live = () => !cancel.signal.aborted && current();
  const status = await serveManagedSavedStateStream(cursor, {
    signal: cancel.signal, current: live,
    read: (next, authorized) => handlers.changes(identity, workspaceId, authorized, next),
    open() {
      response.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" });
      response.flushHeaders();
    },
    send: (frame) => {
      if (!live() || !response.write(frame)) { response.destroy(); return false; }
      return true;
    },
    onExpire: () => {
      cancel.abort();
      response.destroy();
    },
  });
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) { response.end(); return; }
  sendFailure(response, status === "forbidden" ? 403 : 503, status === "forbidden" ? "headless.forbidden" : "headless.unavailable");
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
