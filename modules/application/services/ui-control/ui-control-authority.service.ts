import {
  UI_PRESENTATION_ACTIONS, isUiControlId, readUiControlAttempt, readUiControlLeaseTarget,
  readUiControlRequest, readUiControlRevoke, readUiControlWindow,
  type HeadlessHostIncarnationId, type UiControlAttempt, type UiControlLease, type UiControlLeaseTarget,
  type UiControlRequestStatus, type UiControlRequestView, type UiControlWindowTarget,
} from "../../../contracts/headless";
import type { OrganizationId } from "../../../contracts/organization";

export const UI_CONTROL_AUTHORITY_LIMITS = Object.freeze({
  windows: 32, requests: 256, policyReads: 16,
  requestMs: 60_000, readinessMs: 10_000, leaseMs: 15_000, retryMs: 60_000, admissionMs: 5_000,
});

type Principal = { readonly organizationId: OrganizationId; readonly principalId: string };

/** Constructed by the host after authenticating an interactive caller. */
export type UiControlInteractiveOwner = Principal & { readonly isCurrent: () => boolean };

/** Constructed by the host from a verified registration and logical chat session. */
export type UiControlAgent = Principal & {
  readonly registeredClientId: string;
  readonly agentSessionId: string;
  readonly isCurrent: () => boolean;
};

type WindowSlot = {
  readonly target: UiControlWindowTarget;
  readonly owner: UiControlInteractiveOwner;
  request?: RequestEntry;
};

type RequestEntry = {
  readonly target: UiControlAttempt;
  readonly agent: UiControlAgent;
  readonly taskId: string;
  readonly requestKey: string;
  readonly slot: WindowSlot;
  status: UiControlRequestStatus;
  expiresAt: number;
  lease?: UiControlLeaseTarget;
};

export type UiControlDecision<T> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "denied" | "busy" | "ended" | "unavailable" };

const denied = { status: "denied" } as const;
const ended = { status: "ended" } as const;
const busy = { status: "busy" } as const;
const unavailable = { status: "unavailable" } as const;
const limits = UI_CONTROL_AUTHORITY_LIMITS;
const ok = <T>(value: T) => ({ status: "ok", value }) as const;

function samePrincipal(left: Principal, right: Principal): boolean {
  return left.organizationId === right.organizationId && left.principalId === right.principalId;
}

function sameAgent(left: UiControlAgent, right: UiControlAgent): boolean {
  return samePrincipal(left, right) && left.registeredClientId === right.registeredClientId &&
    left.agentSessionId === right.agentSessionId;
}

function sameWindow(left: UiControlWindowTarget, right: UiControlWindowTarget): boolean {
  return left.hostIncarnationId === right.hostIncarnationId && left.windowId === right.windowId &&
    left.uiIncarnationId === right.uiIncarnationId && left.workspaceId === right.workspaceId;
}

function sameLease(left: UiControlLeaseTarget, right: UiControlAttempt): boolean {
  return "leaseId" in right && "generation" in right &&
    left.leaseId === right.leaseId && left.generation === right.generation;
}

function view(entry: RequestEntry): UiControlRequestView {
  return { target: { ...entry.target }, agentSessionId: entry.agent.agentSessionId,
    taskId: entry.taskId, status: entry.status, expiresAt: entry.expiresAt };
}

function lease(entry: RequestEntry): UiControlLease | undefined {
  return entry.lease && {
    target: { ...entry.lease }, actions: UI_PRESENTATION_ACTIONS,
    context: "resource-identifiers", expiresAt: entry.expiresAt,
  };
}

/** Owns presentation reservations. No provider, editor or business task is owned here. */
export function createUiControlAuthority(dependencies: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  /** Host-owned monotonic clock. Wall clock changes must never renew a lease. */
  readonly now: () => number;
  readonly issueId: () => string;
  readonly authorize: (target: UiControlWindowTarget, agent: UiControlAgent, interactive: Principal, taskId: string) => Promise<boolean>;
}) {
  const windows = new Map<string, WindowSlot>();
  const requests = new Map<string, RequestEntry>();
  let generation = 0;
  let policyReads = 0;
  let open = true;

  const current = (owner: { readonly isCurrent: () => boolean }) => {
    try { return owner.isCurrent() === true; } catch { return false; }
  };
  const end = (entry: RequestEntry, now = dependencies.now()) => {
    if (entry.status === "ended") return;
    entry.status = "ended";
    entry.expiresAt = now + limits.retryMs;
    if (entry.slot.request === entry) entry.slot.request = undefined;
  };
  const retire = (slot: WindowSlot, now = dependencies.now()) => {
    if (slot.request) end(slot.request, now);
    if (windows.get(slot.target.windowId) === slot) windows.delete(slot.target.windowId);
  };
  const sweep = (now = dependencies.now()) => {
    for (const slot of windows.values()) if (!current(slot.owner)) retire(slot, now);
    for (const entry of requests.values()) {
      if (entry.status === "ended") {
        if (now >= entry.expiresAt) requests.delete(entry.target.requestId);
      } else if (now >= entry.expiresAt || !current(entry.agent)) end(entry, now);
    }
  };
  const validHost = (target: UiControlWindowTarget) => open && target.hostIncarnationId === dependencies.hostIncarnationId;
  const slotFor = (target: UiControlWindowTarget) => {
    const slot = windows.get(target.windowId);
    return validHost(target) && slot && sameWindow(slot.target, target) && current(slot.owner) ? slot : undefined;
  };
  const exactEntry = (target: UiControlAttempt) => {
    const entry = requests.get(target.requestId);
    return validHost(target) && entry && sameWindow(entry.target, target) &&
      entry.target.attemptId === target.attemptId ? entry : undefined;
  };
  const findRetry = (requestKey: string, agent: UiControlAgent) => {
    for (const entry of requests.values()) {
      if (entry.requestKey === requestKey && sameAgent(entry.agent, agent)) return entry;
    }
  };
  const interactiveEntry = (target: UiControlAttempt, owner: UiControlInteractiveOwner) => {
    const entry = exactEntry(target);
    if (entry?.slot.owner !== owner || !current(owner)) return;
    return entry;
  };
  const authorized = async (slot: WindowSlot, agent: UiControlAgent, taskId: string): Promise<boolean | "busy"> => {
    if (agent.organizationId !== slot.owner.organizationId || !current(agent) || !current(slot.owner)) return false;
    if (policyReads >= limits.policyReads) return "busy";
    policyReads++;
    try { return (await dependencies.authorize(slot.target, agent, slot.owner, taskId)) === true; }
    catch { return false; }
    finally { policyReads--; }
  };
  const interactive = async (raw: unknown, owner: UiControlInteractiveOwner, activate: boolean) => {
    // Acceptance and readiness use different exact schemas.
    const target = activate ? readUiControlLeaseTarget(raw) : readUiControlAttempt(raw);
    if (!target) return denied;
    sweep();
    const entry = interactiveEntry(target, owner);
    if (!entry) return denied;
    if (entry.status === "ended") return ended;
    if (activate && (!entry.lease || !sameLease(entry.lease, target))) return denied;
    const allowed = await authorized(entry.slot, entry.agent, entry.taskId);
    sweep();
    if (!open || interactiveEntry(target, owner) !== entry || slotFor(target) !== entry.slot) return denied;
    if (entry.slot.request !== entry) return ended;
    if (allowed === "busy") return busy;
    if (!allowed) { end(entry); return denied; }
    if (activate) {
      if (entry.status === "awaiting-readiness") {
        entry.status = "active";
        entry.expiresAt = dependencies.now() + limits.leaseMs;
      }
    } else if (entry.status === "pending") {
      const leaseId = dependencies.issueId();
      if (!isUiControlId(leaseId) || generation >= Number.MAX_SAFE_INTEGER) return unavailable;
      entry.lease = { ...entry.target, leaseId, generation: ++generation };
      entry.status = "awaiting-readiness";
      entry.expiresAt = dependencies.now() + limits.readinessMs;
    }
    const result = lease(entry);
    return result ? ok(result) : denied;
  };

  return {
    registerWindow(raw: unknown, owner: UiControlInteractiveOwner): boolean {
      const target = readUiControlWindow(raw);
      if (!target || !validHost(target) || !current(owner)) return false;
      sweep();
      const previous = windows.get(target.windowId);
      if (previous) return previous.owner === owner && sameWindow(previous.target, target);
      if (windows.size >= limits.windows) return false;
      windows.set(target.windowId, { target, owner });
      return true;
    },
    retireWindow(raw: unknown, owner: UiControlInteractiveOwner): boolean {
      const target = readUiControlWindow(raw);
      if (!target) return false;
      const slot = windows.get(target.windowId);
      if (!slot || !sameWindow(slot.target, target) || slot.owner !== owner) return false;
      retire(slot);
      return true;
    },
    async request(raw: unknown, agent: UiControlAgent): Promise<UiControlDecision<UiControlRequestView>> {
      const request = readUiControlRequest(raw);
      if (!request || !isUiControlId(agent.registeredClientId) || !isUiControlId(agent.agentSessionId)) return denied;
      sweep();
      const slot = slotFor(request.target);
      if (!slot) return denied;
      const previous = findRetry(request.requestKey, agent);
      const admissionDeadline = dependencies.now() + limits.admissionMs;
      const allowed = await authorized(slot, agent, request.taskId);
      if (allowed === "busy") return busy;
      if (!allowed) return denied;
      sweep();
      if (slotFor(request.target) !== slot || !current(agent)) return denied;
      // A transport retry cannot recreate a dismissed prompt.
      const existing = previous ?? findRetry(request.requestKey, agent);
      if (existing) {
        if (existing.slot !== slot || existing.taskId !== request.taskId) return denied;
        return existing.status === "ended" ? ended : ok(view(existing));
      }
      if (dependencies.now() >= admissionDeadline) return unavailable;
      if (slot.request) return busy;
      if (requests.size >= limits.requests) return busy;
      const requestId = dependencies.issueId();
      const attemptId = dependencies.issueId();
      if (!isUiControlId(requestId) || !isUiControlId(attemptId) || requestId === attemptId || requests.has(requestId)) return unavailable;
      const entry: RequestEntry = { target: { ...slot.target, requestId, attemptId }, slot, agent,
        taskId: request.taskId, requestKey: request.requestKey, status: "pending", expiresAt: dependencies.now() + limits.requestMs };
      requests.set(requestId, entry);
      slot.request = entry;
      return ok(view(entry));
    },
    /** Internal view. The interactive transport must gate its publication on current workspace permission. */
    readPending(raw: unknown, owner: UiControlInteractiveOwner): UiControlRequestView | undefined {
      const target = readUiControlWindow(raw);
      if (!target) return;
      sweep();
      const slot = slotFor(target);
      if (slot?.owner === owner && slot.request) return view(slot.request);
    },
    accept: (raw: unknown, owner: UiControlInteractiveOwner) => interactive(raw, owner, false),
    ready: (raw: unknown, owner: UiControlInteractiveOwner) => interactive(raw, owner, true),
    revoke(raw: unknown, owner: UiControlInteractiveOwner): UiControlDecision<undefined> {
      const target = readUiControlRevoke(raw);
      if (!target) return denied;
      sweep();
      const entry = interactiveEntry(target, owner);
      if (!entry || ("leaseId" in target && (!entry.lease || !sameLease(entry.lease, target)))) return denied;
      end(entry);
      return ok(undefined);
    },
    async agentStatus(raw: unknown, agent: UiControlAgent, renew = false): Promise<UiControlDecision<UiControlRequestView>> {
      const target = renew ? readUiControlLeaseTarget(raw) : readUiControlAttempt(raw);
      if (!target) return denied;
      sweep();
      const entry = exactEntry(target);
      if (!entry || !sameAgent(entry.agent, agent) || !current(agent)) return denied;
      if (renew && (!entry.lease || !sameLease(entry.lease, target))) return denied;
      const allowed = await authorized(entry.slot, agent, entry.taskId);
      sweep();
      if (!open || exactEntry(target) !== entry || !current(agent)) return denied;
      if (allowed === "busy") return busy;
      if (entry.status === "ended") return ended;
      if (!allowed) { end(entry); return denied; }
      if (renew && entry.status === "active") entry.expiresAt = dependencies.now() + limits.leaseMs;
      return ok(view(entry));
    },
    release(raw: unknown, agent: UiControlAgent): UiControlDecision<undefined> {
      const target = readUiControlRevoke(raw);
      if (!target) return denied;
      sweep();
      const entry = exactEntry(target);
      if (!entry || !sameAgent(entry.agent, agent) || !current(agent) ||
          ("leaseId" in target && (!entry.lease || !sameLease(entry.lease, target)))) return denied;
      end(entry);
      return ok(undefined);
    },
    close(): void {
      open = false;
      windows.clear();
      requests.clear();
    },
  };
}
