import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { createUiControlAuthority, type UiControlInteractiveOwner } from "../../../application/services/ui-control/ui-control-authority.service";
import { createUiControlDelivery } from "../../../application/services/ui-control/ui-control-delivery.service";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { DesktopHeadlessAuthoringWireGrant } from "../../../adapters/transport/headless-loopback";
import {
  UI_CONTROL_VERSION, sameUiControlLease, readUiPresentationDetail, readUiPresentationContext,
  type HeadlessHostIncarnationId, type HeadlessWindowRequest, type HeadlessWindowResult, type HeadlessWindowValue,
  type UiControlAttempt, type UiControlLeaseTarget, type UiPresentationContext, type UiPresentationIntent, type UiPresentationDetail,
} from "../../../contracts/headless";
import type { LocalIdentityProfile } from "../../../contracts/organization";
import type { SecurityScope } from "../../../contracts/security";
import type { WorkspaceId } from "../../../contracts/workspace";
import { composeDesktopWorkspaceAuthorization } from "./composeDesktopWorkspaceAuthorization";

export function composeDesktopUiControl({
  hostIncarnationId, identity, documents, rootDirectory, isOpen, canPresent, now = () => performance.now(),
}: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly identity: LocalIdentityProfile;
  readonly documents: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly isOpen: () => boolean;
  readonly canPresent?: (workspaceId: WorkspaceId, intent: UiPresentationIntent) => Promise<UiPresentationDetail | undefined>;
  readonly now?: () => number;
}) {
  async function authorizeWorkspace(workspaceId: WorkspaceId, scopes: readonly SecurityScope[]): Promise<boolean> {
    if (!isOpen() || documents.organizationId !== undefined) return false;
    try {
      // This read transaction orders workspace and membership against committed
      // changes in the same database. No prompt or lease may return a result that
      // was denied in this committed view.
      const allowed = await documents.runInTransaction(async transaction => {
        const workspaces = createLocalWorkspaceRepository({
          rootDirectory, documents: transaction.forOrganization(identity.organizationId),
        });
        const workspace = await workspaces.readWorkspace(workspaceId);
        if (workspace?.workspaceId !== workspaceId || workspace.organizationId !== identity.organizationId ||
            workspace.status !== "active") return false;
        await composeDesktopWorkspaceAuthorization({ documents: transaction, localIdentity: identity })
          .authorizeWorkspaceOperation({
            operation: "headless.window.observe", workspace, requiredScopes: scopes,
          });
        return true;
      });
      return allowed && isOpen();
    } catch { return false; }
  }
  const canObserve = (workspaceId: WorkspaceId) => authorizeWorkspace(workspaceId, ["workspace:read", "asset:read"]);
  const authorizeIntent = async (workspaceId: WorkspaceId, intent: UiPresentationIntent) => {
    if (!canPresent) return;
    const extraScopes: readonly SecurityScope[] = intent.action === "show-run" ? ["runtime:read"] :
      intent.action === "show-artifact" ? ["artifact:read"] : [];
    const scopes: readonly SecurityScope[] = ["workspace:read", "asset:read", ...extraScopes];
    if (!await authorizeWorkspace(workspaceId, scopes)) return;
    try {
      const detail = readUiPresentationDetail(await canPresent(workspaceId, intent));
      if (detail && await authorizeWorkspace(workspaceId, scopes)) return detail;
    } catch { return undefined; }
  };
  const authority = createUiControlAuthority({
    hostIncarnationId, now, issueId: randomUUID,
    authorize: async (target, agent, interactive) => agent.principalId === identity.principalId &&
      interactive.principalId === identity.principalId && agent.organizationId === identity.organizationId &&
      interactive.organizationId === identity.organizationId && await canObserve(target.workspaceId),
  });
  const deliveries = new Map<string, {
    readonly target: UiControlLeaseTarget;
    readonly queue: ReturnType<typeof createUiControlDelivery>;
    readonly current: () => boolean;
  }>();
  const contextReads = new Map<string, {
    readonly target: UiControlLeaseTarget;
    readonly challenge: string;
    readonly deadline: number;
    readonly resolve: (value: ContextProof | undefined) => void;
  }>();
  type ContextProof = { readonly context: UiPresentationContext; readonly deadline: number };
  const contextDeadlines = new WeakMap<object, number>();
  const ok = (value: HeadlessWindowValue): HeadlessWindowResult => ({ ok: true, value });
  const denied = { ok: false, code: "headless.forbidden" } as const;
  const capacity = { ok: false, code: "headless.operation-capacity" } as const;
  const unavailable = { ok: false, code: "headless.unavailable" } as const;
  const identityMatches = (grant: DesktopHeadlessAuthoringWireGrant) =>
    grant.presentation === true && grant.organizationId === identity.organizationId && grant.principalId === identity.principalId;

  function delivery(target: UiControlLeaseTarget, current: () => boolean) {
    for (const [id, entry] of deliveries) {
      if (entry.current()) continue;
      entry.queue.close();
      deliveries.delete(id);
    }
    if (!current()) return undefined;
    const existing = deliveries.get(target.leaseId);
    if (existing) return sameUiControlLease(existing.target, target) ? existing.queue : undefined;
    if (deliveries.size >= 32) return undefined;
    const created = createUiControlDelivery({ target, now, isCurrent: current });
    deliveries.set(target.leaseId, { target, queue: created, current });
    return created;
  }

  async function execute(request: HeadlessWindowRequest, grant: DesktopHeadlessAuthoringWireGrant, agentSessionId: string) {
    const input = request.input;
    const target = "target" in input ? input.target : input;
    if (target.hostIncarnationId !== hostIncarnationId) return { ok: false, code: "headless.host-changed" } as const;
    const live = () => isOpen() && grant.isCurrent?.() === true;
    if (!live() || !identityMatches(grant) ||
        !grant.workspaceIds.includes(target.workspaceId) || !await canObserve(target.workspaceId) || !live()) return denied;
    const agent = { ...identity, registeredClientId: grant.registeredClientId, agentSessionId,
      isCurrent: () => isOpen() && grant.isPresentationCurrent?.() === true };
    if (request.operation === "window.list") return ok({ kind: "windows", windows: authority.readWindows(request.input.workspaceId, agent) });
    if (request.operation === "window.request") {
      const result = await authority.request({ version: UI_CONTROL_VERSION, ...request.input }, agent);
      if (result.status === "ok") return ok({ kind: "request", request: result.value });
      if (result.status === "ended") return ok({ kind: "ended" });
      return result.status === "busy" ? capacity : denied;
    }
    if (request.operation === "window.release") {
      if (authority.release(request.input.target, agent).status !== "ok") return denied;
      closeDelivery(request.input.target);
      return ok({ kind: "released" });
    }
    if (request.operation === "window.status" || request.operation === "window.renew") {
      const exact = request.input.target;
      let proof: ContextProof | undefined;
      if (request.operation === "window.renew") {
        if (!("leaseId" in exact)) return denied;
        if (authority.readAgentLease(exact, agent)) {
          proof = await freshContext(exact);
          if (!proof || now() >= proof.deadline) return unavailable;
        }
      }
      const status = await authority.agentStatus(exact, agent, request.operation === "window.renew",
        request.operation === "window.renew" ? () => !!proof && now() < proof.deadline : undefined);
      if (status.status === "ended") return ok({ kind: "ended" });
      if (status.status !== "ok") return status.status === "busy" ? capacity : denied;
      const lease = authority.readAgentLease(status.value.target, agent);
      if (!lease && status.value.status === "active") return ok({ kind: "ended" });
      return ok({ kind: "request", request: status.value, ...(lease ? { lease: lease.target } : {}) });
    }
    const exact = request.input.target;
    const current = () => {
      const lease = authority.readAgentLease(exact, agent);
      return !!lease && sameUiControlLease(lease.target, exact);
    };
    if (!current()) return denied;
    if (request.operation === "window.context") {
      const proof = await freshContext(exact);
      if (!proof || now() >= proof.deadline) return unavailable;
      const snapshot = proof.context;
      if (snapshot?.selection && !await authorizeIntent(exact.workspaceId, snapshot.selection)) return denied;
      if (!current() || now() >= proof.deadline) return denied;
      const value = { kind: "context", context: snapshot } as const;
      contextDeadlines.set(value, proof.deadline);
      return ok(value);
    }
    if (request.operation !== "window.present" || !canPresent) return unavailable;
    const queue = delivery(exact, current);
    if (!queue) return capacity;
    const known = queue.readSubmission(request.input);
    if (known?.status === "conflict") return { ok: false, code: "headless.idempotency-conflict" } as const;
    if (known?.status === "duplicate") return ok({ kind: "command", receipt: known.receipt, duplicate: true });
    if (!await authorizeIntent(exact.workspaceId, request.input.intent) || !current()) return denied;
    const result = queue.submit(request.input);
    if (result.status === "conflict") return { ok: false, code: "headless.idempotency-conflict" } as const;
    if (result.status === "busy") return capacity;
    if (result.status === "denied") return denied;
    return ok({ kind: "command", receipt: result.receipt, duplicate: result.status === "duplicate" });
  }

  function readDelivery(target: UiControlLeaseTarget) {
    return deliveries.get(target.leaseId)?.queue;
  }

  function closeDelivery(target: UiControlAttempt) {
    for (const entry of contextReads.values()) {
      if (entry.target.requestId === target.requestId && entry.target.attemptId === target.attemptId) entry.resolve(undefined);
    }
    for (const [id, entry] of deliveries) {
      const exact = entry.target;
      if (exact.attemptId !== target.attemptId || exact.windowId !== target.windowId ||
          exact.hostIncarnationId !== target.hostIncarnationId || exact.uiIncarnationId !== target.uiIncarnationId ||
          exact.workspaceId !== target.workspaceId || exact.requestId !== target.requestId) continue;
      entry.queue.close();
      deliveries.delete(id);
      break;
    }
  }

  async function freshContext(target: UiControlLeaseTarget): Promise<ContextProof | undefined> {
    if (contextReads.size >= 16 || contextReads.has(target.leaseId)) return undefined;
    const challenge = randomUUID();
    const deadline = now() + 750;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<ContextProof | undefined>(resolve => {
        contextReads.set(target.leaseId, { target, challenge, deadline, resolve });
        timer = setTimeout(() => resolve(undefined), 750);
      });
    } finally {
      clearTimeout(timer);
      if (contextReads.get(target.leaseId)?.challenge === challenge) contextReads.delete(target.leaseId);
    }
  }

  function contextChallenge(target: UiControlLeaseTarget) {
    const entry = contextReads.get(target.leaseId);
    return entry && now() < entry.deadline && sameUiControlLease(target, entry.target) ? entry.challenge : undefined;
  }

  function publishContext(target: UiControlLeaseTarget, owner: UiControlInteractiveOwner, context: UiPresentationContext, challenge: string) {
    const entry = contextReads.get(target.leaseId);
    const safe = readUiPresentationContext(context);
    if (!safe || !entry || now() >= entry.deadline || entry.challenge !== challenge || !sameUiControlLease(target, entry.target) ||
        !isOpen() || !authority.readInteractiveLease(target, owner, true)) return false;
    contextReads.delete(target.leaseId);
    entry.resolve({ context: safe, deadline: entry.deadline });
    return true;
  }

  function canPublish(request: HeadlessWindowRequest, result: HeadlessWindowResult, grant: DesktopHeadlessAuthoringWireGrant, agentSessionId: string) {
    const input = request.input;
    const target = "target" in input ? input.target : input;
    if (!(isOpen() && identityMatches(grant) && grant.isCurrent?.() === true && grant.workspaceIds.includes(target.workspaceId))) return false;
    if (!result.ok || result.value.kind === "released" || result.value.kind === "ended") return true;
    const agent = { ...identity, registeredClientId: grant.registeredClientId, agentSessionId, isCurrent: () => grant.isCurrent?.() === true };
    if (result.value.kind === "windows") {
      const current = authority.readWindows(target.workspaceId, agent);
      return result.value.windows.every(window => current.some(value => value.windowId === window.windowId && value.uiIncarnationId === window.uiIncarnationId));
    }
    if (result.value.kind === "request") {
      const latest = authority.readAgentRequest(result.value.request.target, agent);
      return latest?.status === result.value.request.status;
    }
    if (request.operation !== "window.context" && request.operation !== "window.present") return false;
    const lease = authority.readAgentLease(request.input.target, agent);
    if (!lease || !sameUiControlLease(lease.target, request.input.target)) return false;
    if (result.value.kind === "context") return now() < (contextDeadlines.get(result.value) ?? 0);
    return true;
  }

  async function authorizePublication(request: HeadlessWindowRequest, result: HeadlessWindowResult) {
    if (!result.ok) return true;
    const input = request.input;
    const { workspaceId } = "target" in input ? input.target : input;
    const selection = request.operation === "window.present" ? request.input.intent :
      result.value.kind === "context" ? result.value.context?.selection : undefined;
    return selection ? !!await authorizeIntent(workspaceId, selection) : canObserve(workspaceId);
  }

  function close() {
    authority.close();
    for (const entry of deliveries.values()) entry.queue.close();
    deliveries.clear();
    for (const entry of contextReads.values()) entry.resolve(undefined);
    contextReads.clear();
  }

  return {
    hostIncarnationId, identity, authority, canObserve, execute, readDelivery, closeDelivery,
    canPublish, authorizePublication, authorizeIntent, publishContext, contextChallenge, close,
  };
}

export type DesktopUiControlOwner = ReturnType<typeof composeDesktopUiControl>;
