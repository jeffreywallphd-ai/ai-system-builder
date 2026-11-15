import { randomUUID } from "node:crypto";

import { createUiControlAuthority, type UiControlAgent } from "../../../application/services/ui-control/ui-control-authority.service";
import {
  UI_CONTROL_VERSION, isUiControlId, readUiControlAttempt, readUiControlLeaseTarget, readUiControlRevoke, sameUiControlLease,
  readUiPresentationAcknowledgment, readUiPresentationDetail, readUiPresentationPublication, readUiPresentationPull,
  type HeadlessHostIncarnationId, type HeadlessWindowRequest, type HeadlessWindowResult, type HeadlessWindowValue,
  type UiControlLease, type UiControlLeaseTarget, type UiControlObservation, type UiControlTimedGrant, type UiPresentationIntent,
} from "../../../contracts/headless";
import { sameManagedBrowserAttempt } from "../../../contracts/headless/managed-browser-consent";
import type { OrganizationRequestContext } from "../../../contracts/organization";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { ManagedHeadlessBrowserIdentity } from "../security/resolveManagedHeadlessClientPolicy";
import { createManagedHeadlessBrowserDocuments } from "./createManagedHeadlessBrowserDocuments";
import type { ManagedBrowserPlanApprovalRequest } from "../../../contracts/headless/managed-browser-plan-approval";
import type { HeadlessPlanReviewChannel } from "../../../application/ports/system-builder/headless-build-plan-review.port";
import type { composeManagedHeadlessPlanApprovals } from "./composeManagedHeadlessPlanApprovals";
import {createManagedBrowserPresentation} from "./createManagedBrowserPresentation";
import type { ManagedHeadlessAuthoringRegistration } from "./composeManagedHeadlessAuthoring";

type Principal = Pick<OrganizationRequestContext, "organizationId" | "principalId">;
type AgentRegistration = ManagedHeadlessAuthoringRegistration & {readonly agentSessionId: string};
type AuthenticatedDocument = {readonly identity: ManagedHeadlessBrowserIdentity; readonly target: unknown; readonly proof: unknown};
const denied = {ok: false, code: "headless.forbidden"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;
const busy = {ok: false, code: "headless.operation-capacity"} as const;
const noDocument = {status: "unavailable"} as const;
const success = (value: HeadlessWindowValue): HeadlessWindowResult => ({ok: true, value});
const samePrincipal = (left: Principal, right: Principal) =>
  left.organizationId === right.organizationId && left.principalId === right.principalId;

/** The renderer and a registered agent use separate admissions to the same window authority. */
export function composeManagedBrowserConsent(options: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly authorize: (principal: Principal, workspaceId: WorkspaceId) => Promise<boolean>;
  readonly authorizeObservation?: (principal: Principal, workspaceId: WorkspaceId) => Promise<boolean>;
  readonly planApprovals?: ReturnType<typeof composeManagedHeadlessPlanApprovals>;
  readonly resolvePresentation?: (principal: Principal, workspaceId: WorkspaceId, intent: UiPresentationIntent,
    mode: {readonly passive: boolean}) => Promise<unknown>;
  readonly now?: () => number;
}) {
  const {hostIncarnationId, authorize, now = () => performance.now()} = options;
  let open = true;
  const presentation = createManagedBrowserPresentation({now});
  const contextDeadlines = new WeakMap<object, number>();
  async function permitted(principal: Principal, workspaceId: WorkspaceId) {
    try { return open && await authorize(principal, workspaceId) === true && open; }
    catch { return false; }
  }
  const authority = createUiControlAuthority({hostIncarnationId, now, issueId: randomUUID,
    authorize: (target, agent, browser) => samePrincipal(agent, browser) ? permitted(agent, target.workspaceId) : Promise.resolve(false)});
  const documents = createManagedHeadlessBrowserDocuments({hostIncarnationId, now, authorize: permitted,
    register: authority.registerWindow, retire: authority.retireWindow});
  const timed = (lease: UiControlLease | undefined): UiControlTimedGrant | undefined => {
    const remainingMs = lease && lease.expiresAt - now();
    if (lease && remainingMs && remainingMs > 0 && remainingMs <= 15_000) return {target: lease.target, remainingMs};
  };
  async function authenticate(document: AuthenticatedDocument, requestIsCurrent: () => boolean, passive = false) {
    if (!open || !requestIsCurrent()) return;
    const tab = await documents.authenticate(document.identity, document.target, document.proof, requestIsCurrent,
      passive ? options.authorizeObservation : undefined);
    return tab?.isCurrent() && requestIsCurrent() ? tab : undefined;
  }
  function asAgent(identity: AgentRegistration): UiControlAgent | undefined {
    if (open && identity.purpose === "agent" && identity.isCurrent() && isUiControlId(identity.registeredClientId) && isUiControlId(identity.agentSessionId)) {
      // Use credential lifetime only. Transport closure must not end an already admitted attempt.
      return {...identity, isCurrent: () => open && identity.isCurrent()};
    }
  }

  async function detail(principal: Principal, target: UiControlLeaseTarget, intent: UiPresentationIntent, passive = false) {
    try {
      return readUiPresentationDetail(await options.resolvePresentation?.(principal, target.workspaceId, intent, {passive}));
    } catch { return undefined; }
  }

  const exactAgentLease = (target: UiControlLeaseTarget, agent: UiControlAgent) => {
    const lease = authority.readAgentLease(target, agent);
    return !!lease && sameUiControlLease(lease.target, target);
  };

  async function browserLease(document: AuthenticatedDocument, target: UiControlLeaseTarget, requestIsCurrent: () => boolean, passive: boolean) {
    const tab = await authenticate(document, requestIsCurrent, passive);
    const live = () => !!tab?.isCurrent() && requestIsCurrent() && !!authority.readInteractiveLease(target, tab.owner, true);
    return live() ? live : undefined;
  }

  function canPublish(request: HeadlessWindowRequest, result: HeadlessWindowResult, identity: AgentRegistration) {
    const agent = asAgent(identity);
    if (!agent) return false;
    if (!result.ok || result.value.kind === "ended" || result.value.kind === "released") return true;
    if (request.operation === "window.present" && result.value.kind === "command")
      return exactAgentLease(request.input.target, agent) && result.value.receipt.commandId === request.input.commandId;
    if (request.operation === "window.context" && result.value.kind === "context")
      return exactAgentLease(request.input.target, agent) && now() < (contextDeadlines.get(result.value) ?? 0);
    if (result.value.kind === "request") {
      const {request: supplied, lease} = result.value;
      const latest = authority.readAgentRequest(supplied.target, agent);
      if (!latest || latest.status !== supplied.status || latest.taskId !== supplied.taskId ||
          latest.agentSessionId !== supplied.agentSessionId || latest.expiresAt !== supplied.expiresAt) return false;
      const readLease = request.operation === "window.status" || request.operation === "window.renew";
      if (!lease) return !readLease || latest.status !== "active";
      if (!readLease) return false;
      const current = authority.readAgentLease(supplied.target, agent);
      return !!current && sameUiControlLease(current.target, lease);
    }
    if (result.value.kind !== "windows" || request.operation !== "window.list") return false;
    const latest = authority.readWindows(request.input.workspaceId, agent);
    return result.value.windows.every(window => latest.some(tab => tab.windowId === window.windowId &&
      tab.uiIncarnationId === window.uiIncarnationId));
  }

  return {
    ...(options.planApprovals ? {
      async planApproval(document: AuthenticatedDocument, request: ManagedBrowserPlanApprovalRequest, current: () => boolean,
        channel: HeadlessPlanReviewChannel = "app-popup") {
        const authenticated = await authenticate(document, current);
        if (!authenticated?.isCurrent() || !current()) return;
        const result = await options.planApprovals?.(request, authenticated.owner, authenticated.isCurrent, current, channel);
        if (!result?.ok || !authenticated.isCurrent() || !current()) return;
        const publish = "canPublish" in result ? result.canPublish : undefined;
        return {value:result.value, canPublish:() => authenticated.isCurrent() && current() && (!publish || publish()),
          ...("publishIfCurrent" in result && result.publishIfCurrent ? { publishIfCurrent: result.publishIfCurrent } : {})};
      },
    } : {}),
    async register(identity: ManagedHeadlessBrowserIdentity, workspaceId: WorkspaceId, requestIsCurrent: () => boolean) {
      if (!open || !requestIsCurrent()) return;
      const registered = await documents.register(identity, workspaceId, requestIsCurrent);
      if (registered && (!open || !requestIsCurrent())) {
        if ("target" in registered) documents.retire(identity, registered.target, registered.proof);
        return;
      }
      return registered;
    },
    async observe(document: AuthenticatedDocument, requestIsCurrent: () => boolean): Promise<UiControlObservation> {
      const tab = await authenticate(document, requestIsCurrent, true);
      if (!tab?.isCurrent() || !requestIsCurrent()) return noDocument;
      const state = authority.observeInteractive(tab.target, tab.owner);
      if (!state) return {status: "ready"};
      const lease = timed(state.active);
      // This fixed consent observation stays separate from the context channel.
      return {status: "ready", request: state.request, ...(lease ? {lease} : {})};
    },
    async consent(document: AuthenticatedDocument, raw: unknown, phase: "accept" | "ready", requestIsCurrent: () => boolean) {
      const target = phase === "accept" ? readUiControlAttempt(raw) : readUiControlLeaseTarget(raw);
      if (!target) return;
      const tab = await authenticate(document, requestIsCurrent);
      if (!tab) return;
      const current = () => tab.isCurrent() && requestIsCurrent();
      const result = await authority[phase](target, tab.owner, current);
      if (result.status !== "ok" || !current()) return;
      return timed(authority.readInteractiveLease(result.value.target, tab.owner, phase === "ready"));
    },
    async revoke(document: AuthenticatedDocument, raw: unknown, requestIsCurrent: () => boolean) {
      const target = readUiControlRevoke(raw);
      if (!target) return false;
      const tab = await authenticate(document, requestIsCurrent);
      if (!tab?.isCurrent() || !requestIsCurrent()) return false;
      const lease = authority.observeInteractive(tab.target, tab.owner)?.active;
      const revoked = authority.revoke(target, tab.owner).status === "ok";
      if (revoked && lease && ("leaseId" in target ?
        sameUiControlLease(lease.target, target) : sameManagedBrowserAttempt(lease.target, target))) {
        presentation.retireLease(lease.target);
      }
      return revoked;
    },
    disconnect(document: AuthenticatedDocument) {
      return documents.retire(document.identity, document.target, document.proof);
    },
    async pullPresentation(document: AuthenticatedDocument, raw: unknown, requestIsCurrent: () => boolean) {
      const input = readUiPresentationPull(raw);
      if (!input) return;
      const live = await browserLease(document, input.target, requestIsCurrent, true);
      if (!live) return;
      const result = await presentation.pull(input, live, intent => detail(document.identity, input.target, intent, true));
      return {result, canPublish: () => live() && presentation.canPublishPull(input.target, result)};
    },
    async acknowledgePresentation(document: AuthenticatedDocument, raw: unknown, requestIsCurrent: () => boolean) {
      const input = readUiPresentationAcknowledgment(raw);
      if (!input) return;
      const live = await browserLease(document, input.target, requestIsCurrent, false);
      if (live) return {result: presentation.acknowledge(input, live), canPublish: live};
    },
    async readContextChallenge(document: AuthenticatedDocument, raw: unknown, requestIsCurrent: () => boolean) {
      const target = readUiControlLeaseTarget(raw);
      if (!target) return;
      const live = await browserLease(document, target, requestIsCurrent, true);
      if (!live) return;
      const result = presentation.contextChallenge(target, live);
      return {result, canPublish: () => live() && (!result || result === presentation.contextChallenge(target, live))};
    },
    async publishContext(document: AuthenticatedDocument, raw: unknown, requestIsCurrent: () => boolean) {
      const input = readUiPresentationPublication(raw);
      if (!input) return;
      const live = await browserLease(document, input.target, requestIsCurrent, false);
      if (live) return {result: presentation.publishContext(input, live), canPublish: live};
    },
    async execute(request: HeadlessWindowRequest, identity: AgentRegistration, requestIsCurrent: () => boolean): Promise<HeadlessWindowResult> {
      const input = request.input;
      const target = "target" in input ? input.target : input;
      if (target.hostIncarnationId !== hostIncarnationId) return {ok: false, code: "headless.host-changed"};
      const agent = asAgent(identity);
      const current = () => !!agent?.isCurrent() && requestIsCurrent();
      if (!agent || !current() || !await permitted(agent, target.workspaceId) || !current()) return denied;
      switch (request.operation) {
        case "window.list":
          return success({kind: "windows", windows: authority.readWindows(request.input.workspaceId, agent)});
        case "window.request": {
          const response = await authority.request({version: UI_CONTROL_VERSION, ...request.input}, agent, current);
          if (!current()) return denied;
          if (response.status === "ok") {
            const latest = authority.readAgentRequest(response.value.target, agent);
            return latest ? success({kind: "request", request: latest}) : success({kind: "ended"});
          }
          return response.status === "ended" ? success({kind: "ended"}) : response.status === "busy" ? busy : denied;
        }
        case "window.status":
        case "window.renew": {
          const exact = request.input.target;
          const renew = request.operation === "window.renew";
          const fresh = renew && "leaseId" in exact ? await presentation.readFreshContext(exact,
            () => current() && exactAgentLease(exact, agent)) : undefined;
          if (renew && !fresh) return unavailable;
          const response = await authority.agentStatus(exact, agent, renew, fresh ? () => now() < fresh.deadline : undefined, current);
          if (!current()) return denied;
          if (response.status === "ok") {
            const latest = authority.readAgentRequest(response.value.target, agent);
            if (!latest) return success({kind: "ended"});
            const lease = authority.readAgentLease(latest.target, agent);
            return success({kind: "request", request: latest, ...(lease ? {lease: lease.target} : {})});
          }
          return response.status === "ended" ? success({kind: "ended"}) : response.status === "busy" ? busy : denied;
        }
        case "window.release": {
          const lease = authority.readAgentLease(request.input.target, agent);
          if (authority.release(request.input.target, agent).status !== "ok") return denied;
          if (lease) presentation.retireLease(lease.target);
          return success({kind: "released"});
        }
        case "window.present": {
          if (!options.resolvePresentation) return unavailable;
          const exact = request.input.target;
          const result = await presentation.submit(request.input, () => exactAgentLease(exact, agent), current,
            async intent => !!await detail(agent, exact, intent));
          if (!current() || !exactAgentLease(exact, agent) || result.status === "denied") return denied;
          if (result.status === "conflict") return {ok:false, code:"headless.idempotency-conflict"};
          if (result.status === "busy") return busy;
          return success({kind:"command",receipt:result.receipt,duplicate:result.status === "duplicate"});
        }
        case "window.context": {
          const exact = request.input.target;
          const live = () => current() && exactAgentLease(exact, agent);
          const context = await presentation.readFreshContext(exact, live);
          if (!context || !live()) return unavailable;
          if (context.snapshot.selection && !await detail(agent, exact, context.snapshot.selection)) return denied;
          if (!live() || now() >= context.deadline) return unavailable;
          const projection = {kind:"context", context:context.snapshot} as const;
          contextDeadlines.set(projection, context.deadline);
          return success(projection);
        }
        default:
          return unavailable;
      }
    },
    canPublish,
    close() {
      open = false;
      documents.close();
      authority.close();
      presentation.close();
    },
  };
}
