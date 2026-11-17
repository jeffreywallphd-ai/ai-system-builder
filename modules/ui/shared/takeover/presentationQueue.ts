import {
  isUiControlId, readUiPresentationDelivery, sameUiControlLease, UI_PRESENTATION_LIMITS,
  type UiControlLeaseTarget, type UiPresentationDelivery, type UiPresentationIntent, type UiPresentationOutcome,
} from "../../../contracts/headless";

type Work = { readonly command: UiPresentationDelivery; readonly expiresAt: number };
type Terminal =
  | { readonly work: Work; readonly outcome: UiPresentationOutcome }
  | { readonly commandId: string; readonly outcome: UiPresentationOutcome };
type Result = "queued" | "duplicate" | "denied" | "detached";
type PreparedEffect = () => boolean;

const limits = UI_PRESENTATION_LIMITS;

/** Preparation may read and be delayed. It never produces a visible effect itself. */
export function createPresentationQueue(options: {
  target: UiControlLeaseTarget;
  now: () => number;
  isCurrent: () => boolean;
  prepare: (intent: UiPresentationIntent, signal: AbortSignal) => Promise<PreparedEffect | undefined>;
  acknowledge: (command: UiPresentationDelivery, outcome: UiPresentationOutcome) => void;
  requestMissing: (sequence: number) => void;
  detach: () => void;
}) {
  const target = { ...options.target };
  const buffered = new Map<number, Work>();
  const terminal = new Map<number, Terminal>();
  const occupied = new Map<string, number>();
  let sequence = 1;
  let gap: { readonly sequence: number; readonly deadline: number } | undefined;
  let gapTimer: ReturnType<typeof setTimeout> | undefined;
  let ended = false;
  let active: { readonly work: Work; readonly abort: AbortController; timer?: ReturnType<typeof setTimeout> } | undefined;

  function close() {
    ended = true;
    const running = active;
    active = undefined;
    buffered.clear();
    terminal.clear();
    occupied.clear();
    clearTimeout(gapTimer);
    clearTimeout(running?.timer);
    running?.abort.abort();
  }

  function live() {
    if (ended) return false;
    try { if (options.isCurrent()) return true; } catch { /* An unreadable fence denies. */ }
    close();
    return false;
  }

  function fault(): "detached" {
    close();
    options.detach();
    return "detached";
  }

  function gapExpired() {
    return gap !== undefined && options.now() >= gap.deadline;
  }

  function sameCommand(work: Work, command: UiPresentationDelivery) {
    return work.command.commandId === command.commandId &&
      JSON.stringify(work.command.intent) === JSON.stringify(command.intent);
  }

  function report(work: Work, outcome: UiPresentationOutcome) {
    try { options.acknowledge(work.command, outcome); }
    catch { /* A repeated exact delivery can recover this acknowledgment. */ }
  }

  function finish(work: Work, outcome: UiPresentationOutcome) {
    if (!live() || work.command.sequence !== sequence) return;
    const running = active;
    active = undefined;
    clearTimeout(running?.timer);
    terminal.set(work.command.sequence, { work, outcome });
    sequence++;
    // Abort listeners can run synchronously and reenter this queue.
    if (outcome === "discarded") running?.abort.abort();
    if (live()) report(work, outcome);
  }

  function pump() {
    if (!live() || active) return;
    while (!active && live()) {
      const work = buffered.get(sequence);
      if (!work) {
        if (buffered.size && gap?.sequence !== sequence) {
          const requested = gap = { sequence, deadline: options.now() + limits.commandMs };
          clearTimeout(gapTimer);
          gapTimer = setTimeout(() => {
            if (live() && gap === requested) fault();
          }, limits.commandMs);
          try { options.requestMissing(sequence); } catch { fault(); }
        }
        break;
      }
      gap = undefined;
      clearTimeout(gapTimer);
      buffered.delete(sequence);
      const remainingMs = work.expiresAt - options.now();
      if (remainingMs <= 0) {
        finish(work, "discarded");
        continue;
      }
      const running = { work, abort: new AbortController(), timer: undefined as ReturnType<typeof setTimeout> | undefined };
      active = running;
      running.timer = setTimeout(() => {
        if (active !== running || !live()) return;
        finish(work, "discarded");
        pump();
      }, remainingMs);
      void (async () => {
        let effect: PreparedEffect | undefined;
        try { effect = await options.prepare(work.command.intent, running.abort.signal); }
        catch { /* Unavailable targets produce a bounded rejection. */ }
        if (active !== running || !live()) return;
        let outcome: UiPresentationOutcome = "rejected";
        try {
          if (options.now() >= work.expiresAt || running.abort.signal.aborted) outcome = "discarded";
          else if (effect) {
            // No await, event loop, or external callback between this gate and the effect.
            if (effect()) outcome = "applied";
          }
        } catch { /* Synchronous presentation failure. */ }
        if (active !== running || !live()) return;
        finish(work, outcome);
        pump();
      })();
    }
  }

  return {
    receive(raw: unknown, requestStartedAt: number): Result {
      const command = readUiPresentationDelivery(raw);
      if (!command || !Number.isFinite(requestStartedAt) || requestStartedAt > options.now() ||
          !sameUiControlLease(target, command.target) || !live()) return "denied";
      if (gapExpired()) return fault();
      const prior = terminal.get(command.sequence);
      if (prior) {
        if ("work" in prior) {
          if (!sameCommand(prior.work, command)) return fault();
          report(prior.work, prior.outcome);
        } else {
          if (prior.commandId !== command.commandId) return fault();
          report({ command, expiresAt: 0 }, prior.outcome);
        }
        return "duplicate";
      }
      const queued = active?.work.command.sequence === command.sequence ? active.work : buffered.get(command.sequence);
      if (queued) return sameCommand(queued, command) ? "duplicate" : fault();
      if (command.sequence < sequence || command.sequence - sequence > limits.gap || buffered.size >= limits.gap + 1) {
        return fault();
      }
      if (occupied.has(command.commandId)) return fault();
      occupied.set(command.commandId, command.sequence);
      buffered.set(command.sequence, { command, expiresAt: requestStartedAt + command.remainingMs });
      pump();
      return "queued";
    },
    /** Advance an exact host terminal position that this renderer never applied. */
    skip(exact: UiControlLeaseTarget, missingSequence: number, commandId: string, outcome: "rejected" | "discarded" = "discarded") {
      if (!sameUiControlLease(target, exact) || !live()) return false;
      if (gapExpired()) { fault(); return false; }
      if (active || missingSequence !== sequence ||
          buffered.has(sequence) || sequence > limits.receipts || !isUiControlId(commandId) || occupied.has(commandId)) return false;
      gap = undefined;
      clearTimeout(gapTimer);
      occupied.set(commandId, sequence);
      terminal.set(sequence, { commandId, outcome });
      sequence++;
      pump();
      return true;
    },
    close,
  };
}
