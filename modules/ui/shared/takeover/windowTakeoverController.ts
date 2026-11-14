import {
  readUiControlAttempt, readUiControlLeaseTarget,
  type UiControlAttempt, type UiControlLeaseTarget, type UiControlRequestView, type UiControlTimedGrant,
} from "../../../contracts/headless";

export type TakeoverGrant = UiControlTimedGrant;

export interface WindowTakeoverPort {
  accept(target: UiControlAttempt): Promise<TakeoverGrant | undefined>;
  ready(target: UiControlLeaseTarget): Promise<TakeoverGrant | undefined>;
  revoke(target: UiControlAttempt | UiControlLeaseTarget): Promise<boolean>;
}

export type DraftHandoff =
  | { readonly status: "clean" }
  | { readonly status: "busy" }
  | { readonly status: "dirty"; readonly save: () => Promise<boolean> };

type State =
  | { readonly status: "manual"; readonly notice?: "revoked" | "unavailable" }
  | { readonly status: "pending" | "confirm-save" | "activating"; readonly request: UiControlRequestView }
  | { readonly status: "active"; readonly request: UiControlRequestView; readonly grant: TakeoverGrant };

function sameAttempt(left: UiControlAttempt, right: UiControlAttempt): boolean {
  return left.hostIncarnationId === right.hostIncarnationId && left.windowId === right.windowId &&
    left.uiIncarnationId === right.uiIncarnationId && left.workspaceId === right.workspaceId &&
    left.requestId === right.requestId && left.attemptId === right.attemptId;
}

function sameLease(left: UiControlLeaseTarget, right: UiControlLeaseTarget): boolean {
  return sameAttempt(left, right) && left.leaseId === right.leaseId && left.generation === right.generation;
}

const maximumRemainingMs = 15_000;
const maximumRevokes = 32;
const terminalRetentionMs = 60_000;

/** One instance per interactive document. The state and fence change before any IPC wait. */
export function createWindowTakeoverController(options: {
  readonly port: WindowTakeoverPort;
  readonly now: () => number;
  readonly readDraft: () => DraftHandoff;
}) {
  let state: State = { status: "manual" };
  let generation = 0;
  let expires = 0;
  let activeTarget: UiControlAttempt | UiControlLeaseTarget | undefined;
  let localEnd: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let observedRetirements: UiControlAttempt[] | undefined;
  const revokesInFlight = new Set<string>();
  const retries = new Map<string, {
    readonly target: UiControlAttempt | UiControlLeaseTarget;
    readonly until: number;
  }>();
  const suppressed = new Map<string, number>();
  const listeners = new Set<() => void>();
  const publish = (value: State) => {
    state = value;
    for (const listener of listeners) listener();
  };
  const normaliseGrant = (value: TakeoverGrant | undefined, request: UiControlAttempt, beganAt: number) => {
    const target = value && readUiControlLeaseTarget(value.target);
    if (!value || !target || !sameAttempt(target, request) || !Number.isFinite(value.remainingMs) ||
        value.remainingMs <= 0 || value.remainingMs > maximumRemainingMs || beganAt + value.remainingMs <= options.now()) return;
    return { target, remainingMs: value.remainingMs };
  };
  function flushRevokes() {
    for (const [key, record] of retries) {
      if (options.now() >= record.until) { retries.delete(key); continue; }
      // IPC has no abort method. Hold at most one call per exact attempt and
      // never let a held reply for one attempt block acknowledgments for others.
      if (revokesInFlight.size >= maximumRevokes || revokesInFlight.has(key)) continue;
      revokesInFlight.add(key);
      void (async () => {
        try {
          if (await options.port.revoke(record.target) && retries.get(key) === record) retries.delete(key);
        } catch { /* Keep the captured exact target for the next current transport contact. */ }
        finally { revokesInFlight.delete(key); }
      })();
    }
  }
  function retire(notice: "revoked" | "unavailable") {
    const target = activeTarget;
    generation++;
    expires = 0;
    activeTarget = undefined;
    clearTimeout(localEnd);
    if (target) {
      const until = options.now() + terminalRetentionMs;
      if (suppressed.size < maximumRevokes) suppressed.set(target.attemptId, until);
      if (retries.size < maximumRevokes) retries.set(target.attemptId, { target, until });
    }
    publish({ status: "manual", notice });
    flushRevokes();
  }
  function stillCurrent(expected: number) { return !closed && expected === generation; }
  function updateExpiry(deadline: number, expected: number) {
    expires = deadline;
    clearTimeout(localEnd);
    localEnd = setTimeout(() => { if (stillCurrent(expected)) retire("unavailable"); }, Math.max(0, expires - options.now()));
  }

  async function activate(request: UiControlRequestView, target: UiControlAttempt, save?: () => Promise<boolean>) {
    const expected = ++generation;
    activeTarget = target;
    publish({ status: "activating", request });
    try {
      if (save && !await save()) {
        if (stillCurrent(expected)) retire("unavailable");
        return;
      }
      if (!stillCurrent(expected) || options.readDraft().status !== "clean") {
        if (stillCurrent(expected)) retire("unavailable");
        return;
      }
      const grantStarted = options.now();
      const granted = normaliseGrant(await options.port.accept(target), target, grantStarted);
      if (!stillCurrent(expected)) return;
      if (!granted || options.readDraft().status !== "clean") { retire("unavailable"); return; }
      activeTarget = granted.target;
      const readyStarted = options.now();
      const ready = normaliseGrant(await options.port.ready(granted.target), target, readyStarted);
      if (!stillCurrent(expected)) return;
      if (!ready || !sameLease(granted.target, ready.target) || options.readDraft().status !== "clean") {
        retire("unavailable");
        return;
      }
      updateExpiry(readyStarted + ready.remainingMs, expected);
      publish({ status: "active", request, grant: ready });
    } catch {
      if (stillCurrent(expected)) retire("unavailable");
    }
  }

  const controller = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    update(request: UiControlRequestView | undefined) {
      if (closed) return;
      const now = options.now();
      for (const [key, until] of suppressed) if (now >= until) suppressed.delete(key);
      for (const [key, record] of retries) if (now >= record.until) retries.delete(key);
      const target = request && readUiControlAttempt(request.target);
      if (state.status === "active" && now >= expires) retire("unavailable");
      if (activeTarget) {
        if (!target || !sameAttempt(activeTarget, target) ||
            (state.status === "active" && request?.status !== "active") ||
            request?.status === "ended") retire("unavailable");
        return;
      }
      if (request?.status === "pending" && target && !suppressed.has(target.attemptId) &&
          suppressed.size < maximumRevokes && retries.size < maximumRevokes &&
          revokesInFlight.size < maximumRevokes) {
        activeTarget = target;
        publish({ status: "pending", request: { ...request, target } });
      }
      flushRevokes();
    },
    beginObservation() {
      const snapshot = state;
      const beganAt = options.now();
      const retired: UiControlAttempt[] = [];
      observedRetirements = retired;
      return (request: UiControlRequestView | undefined, lease?: TakeoverGrant) => {
        if (observedRetirements !== retired) return;
        observedRetirements = undefined;
        // A pre-readiness response can arrive after this exact attempt becomes active.
        if (state !== snapshot || (request && retired.some(target => sameAttempt(target, request.target)))) return;
        if (snapshot.status === "active" && request?.status === "active" && options.now() < expires) {
          const exact = normaliseGrant(lease, request.target, beganAt);
          if (exact && sameLease(snapshot.grant.target, exact.target)) {
            const deadline = beganAt + exact.remainingMs;
            if (deadline > expires) updateExpiry(deadline, generation);
          }
        }
        controller.update(request);
      };
    },
    accept() {
      if (state.status !== "pending" || !activeTarget) return;
      const draft = options.readDraft();
      if (draft.status === "busy") return;
      if (draft.status === "dirty") { publish({ status: "confirm-save", request: state.request }); return; }
      void activate(state.request, activeTarget);
    },
    saveAndAccept() {
      if (state.status !== "confirm-save" || !activeTarget) return;
      const draft = options.readDraft();
      if (draft.status === "busy") return;
      void activate(state.request, activeTarget, draft.status === "dirty" ? draft.save : undefined);
    },
    revoke() { if (activeTarget) retire("revoked"); },
    observeHostRetirement(target: UiControlAttempt) {
      if (closed) return;
      // A reply for this exact attempt can still be in transit. Track only the
      // current observation, and fail closed if the local bound is exceeded.
      if (observedRetirements) {
        if (observedRetirements.length >= maximumRevokes) observedRetirements = undefined;
        else if (!observedRetirements.some(previous => sameAttempt(previous, target))) observedRetirements.push(target);
      }
      if (activeTarget && sameAttempt(target, activeTarget)) retire("unavailable");
    },
    /** A late callback must supply the original lease and the captured local fence. */
    permits(target: UiControlLeaseTarget, fence: number): boolean {
      return stillCurrent(fence) && state.status === "active" && options.now() < expires &&
        sameLease(state.grant.target, target);
    },
    fence: () => generation,
    close() {
      if (closed) return;
      closed = true;
      retire("revoked");
      listeners.clear();
    },
  };
  return controller;
}
