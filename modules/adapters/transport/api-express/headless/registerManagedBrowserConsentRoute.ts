import { raw, type Application, type Request, type RequestHandler, type Response } from "express";

import { isUiControlId, readUiControlObservation, readUiControlTimedGrant, readUiPresentationPullResult, sameUiControlLease,
  type HeadlessHostIncarnationId, type UiControlObservation, type UiControlTimedGrant } from "../../../../contracts/headless";
import { MANAGED_BROWSER_CONSENT_PATH, MANAGED_BROWSER_DOCUMENT_HEADER, MANAGED_BROWSER_OBSERVE_PATH, isManagedBrowserDocumentProof,
  parseManagedBrowserConsent, parseManagedBrowserRegistration, sameManagedBrowserAttempt,
  sameManagedBrowserDocument } from "../../../../contracts/headless";
import { MANAGED_BROWSER_ACKNOWLEDGE_PATH, MANAGED_BROWSER_CONTEXT_PATH, MANAGED_BROWSER_DELIVERY_PATH,
  MANAGED_BROWSER_PUBLISH_CONTEXT_PATH, parseManagedBrowserPresentation,
  type ManagedBrowserPresentationOperation } from "../../../../contracts/headless";
import { MANAGED_BROWSER_PLAN_APPROVAL_PATH, MANAGED_BROWSER_PLAN_CHAT_PATH, MANAGED_BROWSER_PLAN_APPROVAL_MAX_RESULT_BYTES, readManagedBrowserPlanApprovalRequest,
  readManagedBrowserPlanApprovalValue, type ManagedBrowserPlanApprovalRequest } from "../../../../contracts/headless";
import type { WorkspaceId } from "../../../../contracts/workspace";
import { readStrictPassiveRecord } from "../../../../contracts/shared";
import { getExpressAuthContext } from "../security/expressAuthContext";
import { getExpressOrganizationContext } from "../security/expressOrganizationContext";

const MAX_BODY = 8_192;
const MAX_CALLS = 32;
const CALL_MS = 5_000;

type Document<Identity> = { readonly identity: Identity; readonly target: unknown; readonly proof: unknown };
type Current = () => boolean;
type Lane = "consent" | "observe" | "plan-approval" | "plan-chat" | ManagedBrowserPresentationOperation;
type ApprovalChannel = "app-popup" | "authenticated-chat";
type LeaseResponse = {readonly result: unknown; readonly canPublish: Current};

export type ManagedBrowserConsentHandlers<Identity> = {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly deliveryEnabled?: boolean;
  readonly identify: (input: {readonly auth: ReturnType<typeof getExpressAuthContext>;
    readonly organization: ReturnType<typeof getExpressOrganizationContext>; readonly organizationHeader: unknown}) => Identity | undefined;
  readonly isCurrent: (identity: Identity) => boolean;
  readonly register: (identity: Identity, workspaceId: WorkspaceId, current: Current) => Promise<unknown>;
  readonly observe: (document: Document<Identity>, current: Current) => Promise<UiControlObservation>;
  readonly consent: (document: Document<Identity>, target: unknown, phase: "accept" | "ready", current: Current) => Promise<UiControlTimedGrant | undefined>;
  readonly revoke: (document: Document<Identity>, target: unknown, current: Current) => Promise<boolean>;
  readonly disconnect: (document: Document<Identity>) => boolean;
  readonly planApproval?: (document: Document<Identity>, request: ManagedBrowserPlanApprovalRequest, current: Current,
    channel: ApprovalChannel) => Promise<{readonly value:unknown; readonly canPublish:Current;
      readonly publishIfCurrent?: (publish: () => boolean) => Promise<boolean>} | undefined>;
  readonly pullPresentation?: (document: Document<Identity>, input: unknown, current: Current) => Promise<LeaseResponse | undefined>;
  readonly acknowledgePresentation?: (document: Document<Identity>, input: unknown, current: Current) => Promise<LeaseResponse | undefined>;
  readonly readContextChallenge?: (document: Document<Identity>, target: unknown, current: Current) => Promise<LeaseResponse | undefined>;
  readonly publishContext?: (document: Document<Identity>, input: unknown, current: Current) => Promise<LeaseResponse | undefined>;
};

export function registerManagedBrowserConsentRoute<Identity>(app: Pick<Application, "post">, origin: string | undefined,
  getHandlers: () => ManagedBrowserConsentHandlers<Identity> | undefined) {
  const parseConsent = raw({ limit: 4_096, type: () => true, inflate: false });
  const parsePresentation = raw({ limit: MAX_BODY, type: () => true, inflate: false });
  const slots = new Set<Response>();
  let open = true;
  const attach = (path: string, lane: Lane): RequestHandler => (request, response) => {
    response.set({"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"});
    if (request.method !== "POST" || request.originalUrl !== path) return error(response, 400);
    const handlers = open && origin && getHandlers();
    if (!handlers) return error(response, 404);
    const planReview = lane === "plan-approval" || lane === "plan-chat";
    if (planReview && !handlers.planApproval) return error(response, 404);
    if (lane !== "consent" && lane !== "observe" && !planReview && !handlers.deliveryEnabled) return error(response, 404);
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
    const parse = lane === "consent" || lane === "observe" ? parseConsent : parsePresentation;
    parse(request, response, (failure?: {status?: number}) => {
      response.removeListener("close", release);
      if (failure) { release(); return error(response, failure.status === 413 ? 413 : 400); }
      void respond(request, response, handlers, identity, current, lane).catch(() => error(response, 503)).finally(release);
    });
  };
  app.post(MANAGED_BROWSER_CONSENT_PATH, attach(MANAGED_BROWSER_CONSENT_PATH, "consent"));
  app.post(MANAGED_BROWSER_OBSERVE_PATH, attach(MANAGED_BROWSER_OBSERVE_PATH, "observe"));
  app.post(MANAGED_BROWSER_PLAN_APPROVAL_PATH, attach(MANAGED_BROWSER_PLAN_APPROVAL_PATH, "plan-approval"));
  app.post(MANAGED_BROWSER_PLAN_CHAT_PATH, attach(MANAGED_BROWSER_PLAN_CHAT_PATH, "plan-chat"));
  app.post(MANAGED_BROWSER_DELIVERY_PATH, attach(MANAGED_BROWSER_DELIVERY_PATH, "pull"));
  app.post(MANAGED_BROWSER_ACKNOWLEDGE_PATH, attach(MANAGED_BROWSER_ACKNOWLEDGE_PATH, "acknowledge"));
  app.post(MANAGED_BROWSER_CONTEXT_PATH, attach(MANAGED_BROWSER_CONTEXT_PATH, "challenge"));
  app.post(MANAGED_BROWSER_PUBLISH_CONTEXT_PATH, attach(MANAGED_BROWSER_PUBLISH_CONTEXT_PATH, "publish"));
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
    if (JSON.stringify(parsed) === text) return parsed;
  } catch { return undefined; }
}

async function respond<Identity>(request: Request, response: Response, handlers: ManagedBrowserConsentHandlers<Identity>,
  identity: Identity, current: Current, lane: Lane) {
  if (!current()) return error(response, 403);
  const raw = readBody(request.body);
  if (lane === "plan-approval" || lane === "plan-chat")
    return respondPlanApproval(raw, request, response, handlers, identity, current, lane === "plan-chat" ? "authenticated-chat" : "app-popup");
  if (lane !== "consent" && lane !== "observe") return respondPresentation(raw, lane, request, response, handlers, identity, current);
  const input = parseManagedBrowserConsent(raw);
  if (!input || (lane === "observe") !== (input.operation === "observe")) return error(response, 400);
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
    if (result.status === "ready" && handlers.deliveryEnabled) response.set("X-AISB-Headless-Presentation", "1");
    if (result.status === "ready" && handlers.planApproval) response.set({
      "X-AISB-Headless-Plan-Approvals":"1",
      "X-AISB-Headless-Plan-Chat":"1",
    });
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

async function respondPlanApproval<Identity>(raw: unknown, request: Request, response: Response,
  handlers: ManagedBrowserConsentHandlers<Identity>, identity: Identity, current: Current, channel: ApprovalChannel) {
  const input = readManagedBrowserPlanApprovalRequest(raw);
  if (!input) return error(response, 400);
  const fileSelection = input.operation === "list-file-clients" || input.operation === "select-file" || input.operation === "select-provider-file";
  if (fileSelection && channel !== "app-popup") return error(response, 403);
  const proof = request.headers[MANAGED_BROWSER_DOCUMENT_HEADER];
  if (!isManagedBrowserDocumentProof(proof) || input.document.hostIncarnationId !== handlers.hostIncarnationId)
    return error(response, 403);
  const result = await handlers.planApproval?.({identity, target:input.document, proof}, input, current, channel);
  if (!current() || result === undefined) return error(response, 403);
  const value = readManagedBrowserPlanApprovalValue(input, result.value,
    {allowLocalFileSave: result.publishIfCurrent !== undefined, allowProviderFileSave: result.publishIfCurrent !== undefined,
      allowLocalDatasetPreparation: result.publishIfCurrent !== undefined,
      allowDatasetResultSave: result.publishIfCurrent !== undefined,
      allowContextPackGeneration: result.publishIfCurrent !== undefined,
      allowContextRagGeneration: result.publishIfCurrent !== undefined,
      allowContextResultSave: result.publishIfCurrent !== undefined, allowContextQuery: result.publishIfCurrent !== undefined});
  if (value === undefined || Buffer.byteLength(JSON.stringify(value)) > MANAGED_BROWSER_PLAN_APPROVAL_MAX_RESULT_BYTES) return error(response, 503);
  if (fileSelection || result.publishIfCurrent) {
    const sent = await result.publishIfCurrent?.(() => {
      if (!current() || !result.canPublish() || response.headersSent) return false;
      response.json(value);
      return response.headersSent;
    });
    if (!sent) return error(response, 403);
    return;
  }
  if (!current() || !result.canPublish()) return error(response, 403);
  return response.json(value);
}

async function respondPresentation<Identity>(raw: unknown, lane: ManagedBrowserPresentationOperation, request: Request,
  response: Response, handlers: ManagedBrowserConsentHandlers<Identity>, identity: Identity, current: Current) {
  const input = parseManagedBrowserPresentation(raw, lane);
  if (!input) return error(response, 400);
  const proof = request.headers[MANAGED_BROWSER_DOCUMENT_HEADER];
  if (!isManagedBrowserDocumentProof(proof) || input.document.hostIncarnationId !== handlers.hostIncarnationId) return error(response, 403);
  const document = {identity, target:input.document, proof};
  switch (input.operation) {
    case "pull": {
      if (!handlers.pullPresentation) return error(response, 404);
      const outcome = await handlers.pullPresentation(document, input.payload, current);
      const result = readUiPresentationPullResult(outcome?.result);
      if (!outcome || result.status === "unavailable") return error(response, 403);
      if (result.status === "command" && (!sameUiControlLease(result.command.target, input.payload.target) ||
          result.command.sequence !== input.payload.sequence)) return error(response, 503);
      if (result.status === "terminal" && result.receipt.sequence !== input.payload.sequence) return error(response, 503);
      if (!current() || !outcome.canPublish()) return error(response, 403);
      return response.json(result);
    }
    case "challenge": {
      if (!handlers.readContextChallenge) return error(response, 404);
      const outcome = await handlers.readContextChallenge(document, input.payload.target, current);
      if (!outcome) return error(response, 403);
      const challenge = outcome.result;
      if (challenge !== undefined && !isUiControlId(challenge)) return error(response, 503);
      if (!current() || !outcome.canPublish()) return error(response, 403);
      return response.json(challenge ? {challenge} : {});
    }
    case "acknowledge":
    case "publish": {
      const action = input.operation === "acknowledge" ? handlers.acknowledgePresentation : handlers.publishContext;
      if (!action) return error(response, 404);
      const outcome = await action(document, input.payload, current);
      if (outcome?.result !== true || !current() || !outcome.canPublish()) return error(response, 403);
      return response.json({ok:true});
    }
  }
}

function registrationIsBusy(value: unknown) {
  try { return readStrictPassiveRecord(value, ["status"]).status === "busy"; }
  catch { return false; }
}

function error(response: Response, status: number) {
  if (!response.destroyed && !response.headersSent) response.status(status).json({error: "headless.browser-consent-unavailable"});
}
