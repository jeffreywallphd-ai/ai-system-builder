import { normalizeConversationSessionId, normalizeConversationTurnId } from "../../../contracts/conversations";
import { normalizeExecutionRunId } from "../../../contracts/execution-runs";
import { isHeadlessHostIncarnationId } from "../../../contracts/headless";
import { isOrganizationId } from "../../../contracts/organization";
import { hasKnownPassiveCredential, readStrictPassiveRecord } from "../../../contracts/shared";
import { isWorkspaceId, type WorkspaceId } from "../../../contracts/workspace";
import type { HeadlessTurnReference, HeadlessTurnReservationPort, HeadlessTurnScope } from "../../ports/system-run-workflow/headless-turn-reservation.port";

type PreparedTarget = { readonly workspaceId: WorkspaceId; readonly planId: string; readonly planRevision: string;
  readonly sessionId: string; readonly snapshotRevision: string };
type Grant = {
  readonly scope: HeadlessTurnScope;
  readonly isCurrent: () => boolean;
  readonly canObserve: (target: PreparedTarget) => Promise<boolean>;
  readonly canDispatch: (target: PreparedTarget) => Promise<boolean>;
};
const invalid = { kind: "invalid" } as const;
const denied = { kind: "denied" } as const;
const unconfirmed = { kind: "unconfirmed" } as const;
type DispatchResult = { readonly kind: "observed"; readonly reference: HeadlessTurnReference } | typeof unconfirmed;

/** Finite dispatch to a preapproved session. This use case has no approval or cancellation port. */
export class HeadlessApprovedConversationDispatchUseCase {
  public constructor(private readonly dependencies: {
    readonly reservations: HeadlessTurnReservationPort;
    /** Keyed, stable across restart, and bound to the owning host. Never an unkeyed prompt hash. */
    readonly fingerprint: (data: string) => string;
    /** The trusted owner must check the exact prepared target and live fence at invocation. */
    readonly submit: (command: { workspaceId: WorkspaceId; conversationSessionId: string; operationId: string; text: string },
      authority: { readonly target: PreparedTarget; readonly isCurrent: () => boolean;
        readonly onAdmitted?: (reference: HeadlessTurnReference) => Promise<boolean> }) => Promise<unknown>;
    /** Optional bounded host lifetime owner. Must start at most once and hold the task through settlement. */
    readonly runOwned?: (task: () => Promise<void>) => boolean;
  }) {}

  public async execute(input: unknown, grant: Grant) {
    const decoded = parse(input);
    if (!decoded) return invalid;
    const { key, text, ...prepared } = decoded;
    const target = Object.freeze(prepared);
    const scope = Object.freeze({ ...grant.scope });
    const { isCurrent } = grant;
    const canObserve = (prepared: PreparedTarget) => grant.canObserve(prepared);
    const canDispatch = (prepared: PreparedTarget) => grant.canDispatch(prepared);
    if (scope.workspaceId !== target.workspaceId || !isOrganizationId(scope.organizationId) ||
        !isHeadlessHostIncarnationId(scope.registeredClientId) || !safeId(scope.principalId)) return denied;
    const current = () => { try { return isCurrent.call(grant); } catch { return false; } };
    const allowed = async (check: (target: PreparedTarget) => Promise<boolean>) => {
      try { return current() && await check(target) && current(); } catch { return false; }
    };
    if (!await allowed(canObserve) || !current()) return denied;
    try {
      const fingerprint = this.dependencies.fingerprint(JSON.stringify([
        "conversation.turn", scope.organizationId, scope.principalId, scope.registeredClientId, target.workspaceId,
        target.planId, target.planRevision, target.sessionId, target.snapshotRevision, key, text,
      ]));
      if (!/^[a-f0-9]{64}$/.test(fingerprint) || fingerprint.length !== 64) return unconfirmed;
      const reservation = { scope, key, fingerprint, isCurrent: current } as const;
      const observed = await this.dependencies.reservations.reserve({ ...reservation, mode: "observe" });
      if (observed.kind === "reserved") return unconfirmed;
      if (observed.kind !== "absent") return await allowed(canObserve) && current() ? observed : denied;
      if (!await allowed(canDispatch) || !current()) return denied;
      const admission = await this.dependencies.reservations.reserve({ ...reservation, mode: "dispatch" });
      if (admission.kind === "absent") return unconfirmed;
      if (admission.kind !== "reserved") return await allowed(canObserve) && current() ? admission : denied;
      if (!await allowed(canDispatch) || !current()) return unconfirmed;
      const command = {
        workspaceId: target.workspaceId, conversationSessionId: target.sessionId, operationId: admission.operationId, text,
      };
      if (this.dependencies.runOwned) {
        return await this.submitOwned(command, target, current, () => allowed(canObserve), reference =>
          this.dependencies.reservations.confirm({ scope, key, operationId: admission.operationId, reference }));
      }
      const result = await this.dependencies.submit(command, { target, isCurrent: current });
      const reference = project(result);
      if (!reference || !await this.dependencies.reservations.confirm({ scope, key, operationId: admission.operationId, reference }))
        return unconfirmed;
      if (!await allowed(canObserve) || !current()) return unconfirmed;
      return { kind: "observed", reference } as const;
    } catch { return unconfirmed; }
  }

  private async submitOwned(
    command: Parameters<HeadlessApprovedConversationDispatchUseCase["dependencies"]["submit"]>[0],
    target: PreparedTarget,
    isCurrent: () => boolean,
    canObserve: () => Promise<boolean>,
    confirm: (reference: HeadlessTurnReference) => Promise<boolean>,
  ): Promise<DispatchResult> {
    return new Promise<DispatchResult>((resolve) => {
      let started = false;
      let callbackOpen = false;
      let signal: Promise<boolean> | undefined;
      let admit!: (accepted: boolean) => void;
      const scheduling = new Promise<boolean>(settled => { admit = settled; });
      const task = async () => {
        if (started) return;
        started = true;
        try {
          if (!await scheduling || !isCurrent()) return;
          callbackOpen = true;
          await this.dependencies.submit(command, { target, isCurrent, onAdmitted(raw) {
            if (!callbackOpen || signal) return Promise.resolve(false);
            signal = (async () => {
              const reference = projectReference(raw);
              if (!reference || !await confirm(reference)) return false;
              // Suppress the handle if access changed while its receipt was committing.
              if (!await canObserve() || !isCurrent()) return false;
              resolve({ kind: "observed", reference });
              return true;
            })().catch(() => false);
            return signal;
          } });
        } catch { /* The caller gets a fixed outcome and may only reconcile the saved key. */ }
        finally {
          callbackOpen = false;
          await signal;
          resolve(unconfirmed);
        }
      };
      let scheduled = false;
      try { scheduled = this.dependencies.runOwned?.(task) === true; } catch { /* Refused. */ }
      admit(scheduled);
      if (!scheduled) resolve(unconfirmed);
    });
  }
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value) &&
    !/[\r\n]/.test(value) && !value.includes("..") && !hasKnownPassiveCredential(value);
}

function parse(value: unknown) {
  try {
    const { workspaceId, planId, planRevision, sessionId, snapshotRevision, key, text } =
      readStrictPassiveRecord(value, ["workspaceId", "planId", "planRevision", "sessionId", "snapshotRevision", "key", "text"]);
    if (!isWorkspaceId(workspaceId) || !safeId(planId) || !safeId(planRevision) || !safeId(sessionId) ||
        normalizeConversationSessionId(sessionId) !== sessionId || !safeId(snapshotRevision) ||
        !isHeadlessHostIncarnationId(key) || typeof text !== "string" || text.length > 2_000 ||
        !text.trim() || hasKnownPassiveCredential(text)) return undefined;
    return { workspaceId, planId, planRevision, sessionId, snapshotRevision, key, text };
  } catch { return undefined; }
}

function project(value: unknown): HeadlessTurnReference | undefined {
  if (typeof value !== "object" || value === null || !("kind" in value) || value.kind !== "success" || !("value" in value))
    return undefined;
  const result = value.value;
  if (typeof result !== "object" || result === null || !("conversationTurnId" in result) || !("executionRunId" in result))
    return undefined;
  return projectReference({ turnId: result.conversationTurnId, runId: result.executionRunId });
}

function projectReference(raw: unknown): HeadlessTurnReference | undefined {
  let reference: Record<string, unknown>;
  try { reference = readStrictPassiveRecord(raw, ["turnId", "runId"]); } catch { return undefined; }
  const { turnId, runId } = reference;
  return safeId(turnId) && normalizeConversationTurnId(turnId) === turnId && safeId(runId) &&
    normalizeExecutionRunId(runId) === runId ? { turnId, runId } : undefined;
}
