import { randomUUID } from "node:crypto";

import { createUiControlAuthority, type UiControlAgent } from "../../../application/services/ui-control/ui-control-authority.service";
import {
  UI_CONTROL_VERSION, isUiControlId, readUiControlAttempt, readUiControlLeaseTarget, readUiControlRevoke,
  type HeadlessHostIncarnationId, type HeadlessWindowRequest, type HeadlessWindowResult, type HeadlessWindowValue,
  type UiControlLease, type UiControlObservation, type UiControlTimedGrant,
} from "../../../contracts/headless";
import type { OrganizationRequestContext } from "../../../contracts/organization";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { ManagedHeadlessBrowserIdentity } from "../security/resolveManagedHeadlessClientPolicy";
import { createManagedHeadlessBrowserDocuments } from "./createManagedHeadlessBrowserDocuments";
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
  readonly now?: () => number;
}) {
  const {hostIncarnationId, authorize, now = () => performance.now()} = options;
  let open = true;
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
  async function authenticate(document: AuthenticatedDocument, requestIsCurrent: () => boolean) {
    if (!open || !requestIsCurrent()) return;
    const tab = await documents.authenticate(document.identity, document.target, document.proof, requestIsCurrent);
    return tab?.isCurrent() && requestIsCurrent() ? tab : undefined;
  }
  function asAgent(identity: AgentRegistration): UiControlAgent | undefined {
    if (open && identity.purpose === "agent" && identity.isCurrent() && isUiControlId(identity.registeredClientId) && isUiControlId(identity.agentSessionId)) {
      // Use credential lifetime only. Transport closure must not end an already admitted attempt.
      return {...identity, isCurrent: () => open && identity.isCurrent()};
    }
  }

  function canPublish(request: HeadlessWindowRequest, result: HeadlessWindowResult, identity: AgentRegistration) {
    const agent = asAgent(identity);
    if (!agent) return false;
    if (!result.ok || result.value.kind === "ended" || result.value.kind === "released") return true;
    if (result.value.kind === "request") {
      const latest = authority.readAgentRequest(result.value.request.target, agent);
      return latest?.status === result.value.request.status;
    }
    if (result.value.kind !== "windows" || request.operation !== "window.list") return false;
    const latest = authority.readWindows(request.input.workspaceId, agent);
    return result.value.windows.every(window => latest.some(tab => tab.windowId === window.windowId &&
      tab.uiIncarnationId === window.uiIncarnationId));
  }

  return {
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
      const tab = await authenticate(document, requestIsCurrent);
      if (!tab?.isCurrent() || !requestIsCurrent()) return noDocument;
      const state = authority.observeInteractive(tab.target, tab.owner);
      if (!state) return {status: "ready"};
      const lease = timed(state.active);
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
      return !!tab?.isCurrent() && requestIsCurrent() && authority.revoke(target, tab.owner).status === "ok";
    },
    disconnect(document: AuthenticatedDocument) {
      return documents.retire(document.identity, document.target, document.proof);
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
        case "window.status": {
          const response = await authority.agentStatus(request.input.target, agent, false, undefined, current);
          if (!current()) return denied;
          if (response.status === "ok") {
            const latest = authority.readAgentRequest(response.value.target, agent);
            if (!latest) return success({kind: "ended"});
            const lease = authority.readAgentLease(latest.target, agent);
            return success({kind: "request", request: latest, ...(lease ? {lease: lease.target} : {})});
          }
          return response.status === "ended" ? success({kind: "ended"}) : response.status === "busy" ? busy : denied;
        }
        case "window.release":
          return authority.release(request.input.target, agent).status === "ok" ? success({kind: "released"}) : denied;
        default:
          return unavailable;
      }
    },
    canPublish,
    close() {
      open = false;
      documents.close();
      authority.close();
    },
  };
}
