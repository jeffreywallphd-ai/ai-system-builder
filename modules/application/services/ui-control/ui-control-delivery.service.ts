import {
  readUiPresentationContext, readUiPresentationSubmission, sameUiControlLease, UI_PRESENTATION_LIMITS,
  type UiControlLeaseTarget, type UiPresentationDelivery, type UiPresentationOutcome,
  type UiPresentationContext, type UiPresentationReceipt, type UiPresentationSubmission,
} from "../../../contracts/headless";

type Entry = {
  readonly command: UiPresentationSubmission;
  readonly sequence: number;
  readonly expiresAt: number;
  status: UiPresentationReceipt["status"];
};
type AuditStatus = "delivered" | UiPresentationOutcome | "unconfirmed" | "conflict";

const limits = UI_PRESENTATION_LIMITS;
const isTerminal = (entry: Entry) => entry.status !== "accepted" && entry.status !== "delivered";
const encoder = new TextEncoder();
const receipt = (entry: Entry): UiPresentationReceipt => ({
  commandId: entry.command.commandId, sequence: entry.sequence, status: entry.status,
});

/** One bounded log for an exact time-limited lease. Transport owns current authorization. */
export function createUiControlDelivery(options: {
  readonly target: UiControlLeaseTarget;
  readonly now: () => number;
  readonly isCurrent: () => boolean;
  readonly audit?: (status: AuditStatus, commandId: string, sequence: number) => void;
}) {
  const target = { ...options.target };
  const entries: Entry[] = [];
  const byId = new Map<string, Entry>();
  let firstUnfinished = 0;
  let ended = false;
  let context: UiPresentationContext | undefined;
  const audit = (entry: Entry, status: AuditStatus) => {
    try { options.audit?.(status, entry.command.commandId, entry.sequence); } catch { /* Audit cannot drive delivery. */ }
  };

  function expire(entry: Entry) {
    if (entry.status === "accepted") { entry.status = "discarded"; audit(entry, "discarded"); }
    else if (entry.status === "delivered") { entry.status = "unconfirmed"; audit(entry, "unconfirmed"); }
  }

  function discardOutstanding() {
    ended = true;
    context = undefined;
    for (const entry of entries) expire(entry);
  }

  function advance() {
    const now = options.now();
    while (firstUnfinished < entries.length) {
      const entry = entries[firstUnfinished]!;
      if (!isTerminal(entry) && now < entry.expiresAt) break;
      expire(entry);
      firstUnfinished++;
    }
  }

  function live(presented: UiControlLeaseTarget) {
    if (!sameUiControlLease(presented, target)) return false;
    if (ended) return false;
    try { if (options.isCurrent()) return true; } catch { /* An unreadable fence denies. */ }
    discardOutstanding();
    return false;
  }

  function known(command: UiPresentationSubmission) {
    const prior = byId.get(command.commandId);
    if (!prior) return;
    if (JSON.stringify(prior.command.intent) !== JSON.stringify(command.intent)) {
      audit(prior, "conflict");
      return { status: "conflict" } as const;
    }
    return { status: "duplicate", receipt: receipt(prior) } as const;
  }

  return {
    readSubmission(raw: unknown) {
      const command = readUiPresentationSubmission(raw);
      if (!command || !live(command.target)) return;
      advance();
      return known(command);
    },
    submit(raw: unknown) {
      const command = readUiPresentationSubmission(raw);
      if (!command || encoder.encode(JSON.stringify(command)).byteLength > limits.commandBytes ||
          !live(command.target)) return { status: "denied" } as const;
      advance();
      const prior = known(command);
      if (prior) return prior;
      if (entries.length >= limits.receipts || entries.length - firstUnfinished >= limits.queued) {
        return { status: "busy" } as const;
      }
      const entry: Entry = {
        command, sequence: entries.length + 1, expiresAt: options.now() + limits.commandMs, status: "accepted",
      };
      entries.push(entry);
      byId.set(command.commandId, entry);
      return { status: "accepted", receipt: receipt(entry) } as const;
    },
    next(exact: UiControlLeaseTarget, sequence: number, markDelivered = true) {
      if (!live(exact) || !Number.isSafeInteger(sequence) || sequence <= 0) return { status: "denied" } as const;
      advance();
      const entry = entries[sequence - 1];
      if (entry && isTerminal(entry)) return { status: "terminal", receipt: receipt(entry) } as const;
      if (sequence !== firstUnfinished + 1) return { status: "gap", sequence: firstUnfinished + 1 } as const;
      if (!entry) return { status: "empty" } as const;
      const remainingMs = entry.expiresAt - options.now();
      if (remainingMs <= 0) {
        expire(entry);
        advance();
        return { status: "terminal", receipt: receipt(entry) } as const;
      }
      if (markDelivered && entry.status !== "delivered") {
        entry.status = "delivered";
        audit(entry, "delivered");
      }
      const command: UiPresentationDelivery = { ...entry.command, target: { ...target }, intent: { ...entry.command.intent }, sequence, remainingMs };
      return { status: "delivered", command } as const;
    },
    acknowledge(exact: UiControlLeaseTarget, sequence: number, commandId: string, status: UiPresentationOutcome) {
      if (!live(exact) || !Number.isSafeInteger(sequence) || sequence <= 0) return undefined;
      advance();
      const entry = entries[sequence - 1];
      if (!entry || entry.command.commandId !== commandId) return undefined;
      if (status !== "applied" && status !== "rejected" && status !== "discarded") return undefined;
      if (entry.status === "unconfirmed") {
        // The exact active renderer can confirm an effect even after the wire
        // acknowledgment deadline. The sequence is never delivered again.
        entry.status = status;
        audit(entry, status);
        return receipt(entry);
      }
      if (isTerminal(entry)) return receipt(entry);
      if (sequence !== firstUnfinished + 1 || entry.status !== "delivered") return undefined;
      entry.status = status;
      audit(entry, status);
      advance();
      return receipt(entry);
    },
    rejectUndeliverable(exact: UiControlLeaseTarget, sequence: number, commandId: string) {
      if (!live(exact) || !Number.isSafeInteger(sequence) || sequence <= 0) return undefined;
      advance();
      const entry = entries[sequence - 1];
      if (!entry || entry.command.commandId !== commandId) return undefined;
      if (!isTerminal(entry)) {
        if (sequence !== firstUnfinished + 1) return undefined;
        entry.status = entry.status === "delivered" ? "unconfirmed" : "rejected";
        audit(entry, entry.status);
        advance();
      }
      return receipt(entry);
    },
    publishContext(exact: UiControlLeaseTarget, raw: unknown) {
      if (!live(exact)) return false;
      const current = readUiPresentationContext(raw);
      if (!current || encoder.encode(JSON.stringify(current)).byteLength > limits.contextBytes) return false;
      context = current;
      return true;
    },
    readContext(exact: UiControlLeaseTarget): UiPresentationContext | undefined {
      if (!live(exact) || !context) return;
      return readUiPresentationContext(context);
    },
    close: discardOutstanding,
  };
}
