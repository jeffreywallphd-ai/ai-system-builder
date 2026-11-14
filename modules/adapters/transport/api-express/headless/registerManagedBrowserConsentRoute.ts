import { raw, type Application, type Request, type Response } from "express";

import { readUiControlObservation, readUiControlTimedGrant, sameUiControlLease,
  type HeadlessHostIncarnationId, type UiControlObservation, type UiControlTimedGrant } from "../../../../contracts/headless";
import { MANAGED_BROWSER_CONSENT_PATH, MANAGED_BROWSER_DOCUMENT_HEADER, isManagedBrowserDocumentProof,
  parseManagedBrowserConsent, parseManagedBrowserRegistration, sameManagedBrowserAttempt,
  sameManagedBrowserDocument } from "../../../../contracts/headless/managed-browser-consent";
import type { WorkspaceId } from "../../../../contracts/workspace";
import { readStrictPassiveRecord } from "../../../../contracts/shared";
import { getExpressAuthContext } from "../security/expressAuthContext";
import { getExpressOrganizationContext } from "../security/expressOrganizationContext";

const ROOT = MANAGED_BROWSER_CONSENT_PATH;
const MAX_BODY = 4_096;
const MAX_CALLS = 32;
const CALL_MS = 5_000;

type Document<Identity> = { readonly identity: Identity; readonly target: unknown; readonly proof: unknown };
type Current = () => boolean;

export type ManagedBrowserConsentHandlers<Identity> = {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly identify: (input: {readonly auth: ReturnType<typeof getExpressAuthContext>;
    readonly organization: ReturnType<typeof getExpressOrganizationContext>; readonly organizationHeader: unknown}) => Identity | undefined;
  readonly isCurrent: (identity: Identity) => boolean;
  readonly register: (identity: Identity, workspaceId: WorkspaceId, current: Current) => Promise<unknown>;
  readonly observe: (document: Document<Identity>, current: Current) => Promise<UiControlObservation>;
  readonly consent: (document: Document<Identity>, target: unknown, phase: "accept" | "ready", current: Current) => Promise<UiControlTimedGrant | undefined>;
  readonly revoke: (document: Document<Identity>, target: unknown, current: Current) => Promise<boolean>;
  readonly disconnect: (document: Document<Identity>) => boolean;
};

export function registerManagedBrowserConsentRoute<Identity>(app: Pick<Application, "post">, origin: string | undefined,
  getHandlers: () => ManagedBrowserConsentHandlers<Identity> | undefined) {
  const parse = raw({ limit: MAX_BODY, type: () => true, inflate: false });
  const slots = new Set<Response>();
  let open = true;
  app.post(ROOT, (request, response) => {
    response.set({"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"});
    if (request.method !== "POST" || request.originalUrl !== ROOT) return error(response, 400);
    const handlers = open && origin && getHandlers();
    if (!handlers) return error(response, 404);
    if (request.headers.origin !== origin || request.headers["sec-fetch-site"] !== "same-origin") return error(response, 403);
    const identity = handlers.identify({auth: getExpressAuthContext(request), organization: getExpressOrganizationContext(request),
      organizationHeader: request.headers["x-organization-id"]});
    if (!identity || !handlers.isCurrent(identity)) return error(response, 403);
    if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) return error(response, 415);
    if (slots.size >= MAX_CALLS) return error(response, 503);
    slots.add(response);
    const expiresAt = performance.now() + CALL_MS;
    const current = () => open && !response.destroyed && slots.has(response) &&
      performance.now() < expiresAt && handlers.isCurrent(identity);
    const timer = setTimeout(() => response.destroy(), CALL_MS);
    const release = () => { clearTimeout(timer); slots.delete(response); };
    response.once("close", release);
    parse(request, response, (failure?: {status?: number}) => {
      response.removeListener("close", release);
      if (failure) { release(); return error(response, failure.status === 413 ? 413 : 400); }
      void respond(request, response, handlers, identity, current).catch(() => error(response, 503)).finally(release);
    });
  });
  return () => {
    open = false;
    for (const response of slots) response.destroy();
  };
}

function readBody(body: unknown) {
  if (!Buffer.isBuffer(body) || body.length === 0 || body.length > MAX_BODY) return;
  try {
    const text = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(body);
    const parsed: unknown = JSON.parse(text);
    if (JSON.stringify(parsed) === text) return parseManagedBrowserConsent(parsed);
  } catch { return undefined; }
}

async function respond<Identity>(request: Request, response: Response, handlers: ManagedBrowserConsentHandlers<Identity>,
  identity: Identity, current: Current) {
  if (!current()) return error(response, 403);
  const input = readBody(request.body);
  if (!input) return error(response, 400);
  const proof = request.headers[MANAGED_BROWSER_DOCUMENT_HEADER];
  if (input.operation === "register") {
    if (proof !== undefined) return error(response, 400);
    const outcome = await handlers.register(identity, input.workspaceId, current);
    if (registrationIsBusy(outcome)) return error(response, current() ? 503 : 403);
    const result = parseManagedBrowserRegistration(outcome);
    if (!result) return error(response, 403);
    if (result.target.hostIncarnationId !== handlers.hostIncarnationId || result.target.workspaceId !== input.workspaceId)
      return error(response, 503);
    if (!current()) {
      handlers.disconnect({identity, target: result.target, proof: result.proof});
      return error(response, 403);
    }
    return response.json(result);
  }
  if (input.document.hostIncarnationId !== handlers.hostIncarnationId) return error(response, 403);
  if (!isManagedBrowserDocumentProof(proof)) return error(response, 403);
  const document = {identity, target: input.document, proof};
  if (input.operation === "observe") {
    const result = readUiControlObservation(await handlers.observe(document, current));
    if (!current() || !result) return error(response, 403);
    if (result.status === "ready" && (result.contextChallenge ||
      result.request && !sameManagedBrowserDocument(result.request.target, input.document))) return error(response, 503);
    return response.json(result);
  }
  if (input.operation === "disconnect" || input.operation === "revoke") {
    const result = input.operation === "disconnect" ? handlers.disconnect(document) : await handlers.revoke(document, input.target, current);
    if (!current() || result !== true) return error(response, 403);
    return response.json({ok: true});
  }
  if (!("target" in input)) return error(response, 400);
  const grant = readUiControlTimedGrant(await handlers.consent(document, input.target, input.operation, current));
  if (!current() || !grant) return error(response, 403);
  const exact = input.operation === "ready" ? "leaseId" in input.target && sameUiControlLease(grant.target, input.target) :
    sameManagedBrowserAttempt(grant.target, input.target);
  if (!exact) return error(response, 503);
  return response.json(grant);
}

function registrationIsBusy(value: unknown) {
  try { return readStrictPassiveRecord(value, ["status"]).status === "busy"; }
  catch { return false; }
}

function error(response: Response, status: number) {
  if (!response.destroyed && !response.headersSent) response.status(status).json({error: "headless.browser-consent-unavailable"});
}
