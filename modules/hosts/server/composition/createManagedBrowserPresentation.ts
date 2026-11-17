import { randomUUID } from "node:crypto";
import { createUiControlDelivery } from "../../../application/services/ui-control/ui-control-delivery.service";
import {
  readUiPresentationAcknowledgment, readUiPresentationContext, readUiPresentationDetail, readUiPresentationPublication,
  readUiPresentationPull, readUiPresentationSubmission, sameUiControlLease, UI_PRESENTATION_LIMITS,
  type UiControlLeaseTarget, type UiPresentationContext, type UiPresentationIntent, type UiPresentationPullResult,
} from "../../../contracts/headless";

const MAX_LEASES = 32;
const MAX_POLICY_READS = 16;
const MAX_CONTEXT_READS = 16;
const CONTEXT_MS = 750;
const unavailable = {status:"unavailable"} as const;
const denied = {status:"denied"} as const;
const bytes = (data: unknown) => new TextEncoder().encode(JSON.stringify(data)).byteLength;
type Current = () => boolean;
type Context = {readonly snapshot: UiPresentationContext; readonly deadline: number};
type Challenge = {readonly id: string; readonly target: UiControlLeaseTarget; readonly deadline: number;
  readonly isCurrent: Current; readonly finish: (value?: Context) => void};
type Queue = ReturnType<typeof createUiControlDelivery>;

/** Holds bounded delivery and one-shot context for exact leases already issued by the authority. */
export function createManagedBrowserPresentation(options: {readonly now?: () => number}) {
  const now = options.now ?? (() => performance.now());
  const queues = new Map<string, {readonly target: UiControlLeaseTarget; readonly isCurrent: Current; readonly queue: Queue}>();
  const challenges = new Map<string, Challenge>();
  const pendingPulls = new Set<string>();
  let open = true;
  let policyReads = 0;
  function live(isCurrent: Current) {
    try {return open && isCurrent() === true;} catch {return false;}
  }
  function sweep() {
    for (const [id, entry] of queues) {
      if (live(entry.isCurrent)) continue;
      entry.queue.close();
      queues.delete(id);
    }
  }
  function existing(target: UiControlLeaseTarget) {
    sweep();
    const entry = queues.get(target.leaseId);
    if (entry && sameUiControlLease(target, entry.target)) return entry.queue;
  }
  function forLease(target: UiControlLeaseTarget, isCurrent: Current) {
    const previous = existing(target);
    if (previous || queues.size >= MAX_LEASES || queues.has(target.leaseId)) return previous;
    const queue = createUiControlDelivery({target, now, isCurrent: () => live(isCurrent)});
    queues.set(target.leaseId, {target, isCurrent, queue});
    return queue;
  }
  function contextChallenge(target: UiControlLeaseTarget, isCurrent: Current) {
    const challenge = challenges.get(target.leaseId);
    if (!challenge || !sameUiControlLease(target, challenge.target) || !live(isCurrent)) return;
    if (now() < challenge.deadline && live(challenge.isCurrent)) return challenge.id;
    challenges.delete(target.leaseId);
    challenge.finish();
  }

  return {
    async submit(raw: unknown, leaseCurrent: Current, requestCurrent: Current,
      authorize: (intent: UiPresentationIntent) => Promise<boolean>) {
      const command = readUiPresentationSubmission(raw);
      const current = () => live(leaseCurrent) && live(requestCurrent);
      if (!command || !current()) return denied;
      if (policyReads >= MAX_POLICY_READS) return {status:"busy"} as const;
      policyReads++;
      try {
        if (await authorize(command.intent) !== true || !current()) return denied;
      } catch { return denied; }
      finally { policyReads--; }
      const queue = forLease(command.target, leaseCurrent);
      return queue ? queue.submit(command) : {status:"busy"} as const;
    },
    async pull(raw: unknown, isCurrent: Current, resolve: (intent: UiPresentationIntent) => Promise<unknown>): Promise<UiPresentationPullResult> {
      const request = readUiPresentationPull(raw);
      if (!request || !live(isCurrent)) return unavailable;
      const {target, sequence} = request;
      const queue = existing(target);
      if (!queue) return {status:"empty"};
      const next = queue.next(target, sequence, false);
      if (next.status === "empty" || next.status === "terminal") return next;
      if (next.status !== "delivered") return unavailable;
      // Reserve the exact queue position before any asynchronous lookup.
      const key = `${target.leaseId}:${sequence}`;
      if (policyReads >= MAX_POLICY_READS || pendingPulls.has(key)) return unavailable;
      pendingPulls.add(key);
      policyReads++;
      let detail: ReturnType<typeof readUiPresentationDetail>;
      try { detail = readUiPresentationDetail(await resolve(next.command.intent)); }
      catch { return unavailable; }
      finally { pendingPulls.delete(key); policyReads--; }
      if (!live(isCurrent)) return unavailable;
      const result = queue.next(target, sequence, false);
      if (result.status === "terminal") return result;
      if (result.status !== "delivered" || result.command.commandId !== next.command.commandId) return unavailable;
      if (!detail) {
        const receipt = queue.rejectUndeliverable(target, sequence, result.command.commandId);
        return receipt ? {status:"terminal", receipt} : unavailable;
      }
      const delivered = queue.next(target, sequence);
      return delivered.status === "delivered" ? {status:"command", command:delivered.command, detail} : unavailable;
    },
    acknowledge(raw: unknown, isCurrent: Current) {
      const input = readUiPresentationAcknowledgment(raw);
      if (!input || !live(isCurrent)) return false;
      const {target, receipt} = input;
      return Boolean(existing(target)?.acknowledge(target, receipt.sequence, receipt.commandId, receipt.status));
    },
    canPublishPull(target: UiControlLeaseTarget, result: UiPresentationPullResult) {
      if (result.status === "command") {
        const entry = existing(target)?.next(target, result.command.sequence, false);
        return entry?.status === "delivered" && entry.command.commandId === result.command.commandId;
      }
      if (result.status === "terminal") {
        const entry = existing(target)?.next(target, result.receipt.sequence, false);
        return entry?.status === "terminal" && entry.receipt.commandId === result.receipt.commandId &&
          entry.receipt.status === result.receipt.status;
      }
      return result.status === "empty";
    },
    async readFreshContext(target: UiControlLeaseTarget, isCurrent: Current): Promise<Context | undefined> {
      if (!live(isCurrent) || challenges.size >= MAX_CONTEXT_READS || challenges.has(target.leaseId)) return;
      let finish!: (value?: Context) => void;
      const payload = new Promise<Context | undefined>(resolve => { finish = resolve; });
      const challenge = {id:randomUUID(), target, deadline:now()+CONTEXT_MS, isCurrent, finish};
      challenges.set(target.leaseId, challenge);
      const timer = setTimeout(() => challenge.finish(), CONTEXT_MS);
      try {
        const context = await payload;
        return context && now() < context.deadline && live(isCurrent) ? context : undefined;
      } finally {
        clearTimeout(timer);
        if (challenges.get(target.leaseId) === challenge) challenges.delete(target.leaseId);
      }
    },
    contextChallenge,
    publishContext(raw: unknown, isCurrent: Current) {
      const parsed = readUiPresentationPublication(raw);
      if (!parsed || !live(isCurrent)) return false;
      const {target, challenge:id} = parsed;
      const challenge = challenges.get(target.leaseId);
      const snapshot = readUiPresentationContext(parsed.context);
      if (!snapshot || bytes(snapshot) > UI_PRESENTATION_LIMITS.contextBytes || !challenge || challenge.id !== contextChallenge(target, isCurrent) ||
          challenge.id !== id) return false;
      challenges.delete(target.leaseId);
      challenge.finish({snapshot, deadline:challenge.deadline});
      return true;
    },
    retireLease(target: UiControlLeaseTarget) {
      const queue = queues.get(target.leaseId);
      if (queue && sameUiControlLease(queue.target, target)) {queue.queue.close(); queues.delete(target.leaseId);}
      const challenge = challenges.get(target.leaseId);
      if (challenge && sameUiControlLease(challenge.target, target)) {challenges.delete(target.leaseId); challenge.finish();}
    },
    close() {
      open = false;
      for (const entry of queues.values()) entry.queue.close();
      queues.clear();
      for (const challenge of challenges.values()) challenge.finish();
      challenges.clear();
    },
  };
}
