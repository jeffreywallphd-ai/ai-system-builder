import { createHash } from "node:crypto";
import type { HeadlessTurnReference, HeadlessTurnReservation, HeadlessTurnReservationPort, HeadlessTurnScope } from "../../../application/ports/system-run-workflow/headless-turn-reservation.port";
import { normalizeConversationTurnId } from "../../../contracts/conversations";
import { normalizeExecutionRunId } from "../../../contracts/execution-runs";
import { isHeadlessHostIncarnationId } from "../../../contracts/headless";
import { isOrganizationId } from "../../../contracts/organization";
import { hasKnownPassiveCredential, readStrictPassiveRecord } from "../../../contracts/shared";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { StructuredDocumentStore } from "../shared";
import { HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE, HEADLESS_RECEIPT_TTL_MS } from "./createStructuredHeadlessOperationStore";

const RECORDS = "headless/conversation/reservations";
const COUNTS = "headless/conversation/reservation-counts";
const denied = { kind: "denied" } as const;
const unconfirmed = { kind: "unconfirmed" } as const;
const hash = (value: readonly string[]) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Store admission before handing a turn to the existing runtime. An unfinished
 *  reservation is intentionally non-retriable across process failures. */
export function createStructuredHeadlessTurnReservation(options: {
  readonly documents: StructuredDocumentStore;
  readonly authorize: (owner: StructuredDocumentStore, scope: HeadlessTurnScope, mode: "observe" | "dispatch") => Promise<boolean>;
  readonly now?: () => number;
}): HeadlessTurnReservationPort {
  const { documents, authorize, now = Date.now } = options;
  if (documents.organizationId !== undefined || !documents.runInOwnedTransaction)
    throw new Error("The platform transaction owner is unavailable.");
  const transact = documents.runInOwnedTransaction.bind(documents) as NonNullable<StructuredDocumentStore["runInOwnedTransaction"]>;
  return {
    async reserve({ scope: rawScope, key, fingerprint, mode, isCurrent }) {
      const scope = Object.freeze({ ...rawScope });
      const keys = locate(scope, key);
      if (!keys || !isDigest(fingerprint) || (mode !== "observe" && mode !== "dispatch") || !isCurrent()) return denied;
      try {
        let wrote = false;
        let observedExpiry: number | undefined;
        const result = await transact<HeadlessTurnReservation>(async owner => {
          if (!isCurrent() || !await authorize(owner, scope, "observe") || !isCurrent()) return denied;
          const store = owner.forOrganization(scope.organizationId);
          const existing = await store.readDocument(RECORDS, keys.record);
          if (!isCurrent()) return denied;
          const at = timestamp(now());
          if (existing) {
            const record = readReservation(existing.value);
            if (record.expiresAt <= at) return { kind: "expired" };
            if (record.fingerprint !== fingerprint) return { kind: "conflict" };
            if (!record.reference) return unconfirmed;
            observedExpiry = record.expiresAt;
            return { kind: "observed", reference: record.reference };
          }
          if (mode === "observe") return { kind: "absent" };
          if (!await authorize(owner, scope, "dispatch") || !isCurrent()) return denied;
          const count = await store.readDocument(COUNTS, keys.count);
          const value = count ? timestamp(readStrictPassiveRecord(count.value, ["used"]).used) : 0;
          if (value >= HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE) return { kind: "capacity" };
          if (!isCurrent()) return denied;
          const expiresAt = timestamp(timestamp(now()) + HEADLESS_RECEIPT_TTL_MS);
          await store.writeDocument(RECORDS, keys.record, { fingerprint, expiresAt }, { expectedRevision: 0 });
          await store.writeDocument(COUNTS, keys.count, { used: value + 1 }, { expectedRevision: count?.revision ?? 0 });
          wrote = true;
          return { kind: "reserved", operationId: keys.operationId };
        }, () => {
          if (wrote && !isCurrent()) throw new Error("The current grant is no longer available.");
        });
        if (!isCurrent()) return denied;
        if (result.kind === "observed" && (observedExpiry === undefined || observedExpiry <= timestamp(now()))) return { kind: "expired" };
        return result;
      } catch { return unconfirmed; }
    },
    async confirm({ scope: rawScope, key, operationId, reference: rawReference }) {
      const scope = { ...rawScope };
      const keys = locate(scope, key);
      if (!keys || keys.operationId !== operationId) return false;
      try {
        const reference = readReference(rawReference);
        return await transact(async owner => {
          const store = owner.forOrganization(scope.organizationId);
          const current = await store.readDocument(RECORDS, keys.record);
          if (!current) return false;
          const record = readReservation(current.value);
          if (record.reference) return record.reference.turnId === reference.turnId && record.reference.runId === reference.runId;
          await store.writeDocument(RECORDS, keys.record, { ...record, reference }, { expectedRevision: current.revision });
          return true;
        }, () => {});
      } catch { return false; }
    },
  };
}

function locate(scope: HeadlessTurnScope, key: string) {
  const { organizationId, workspaceId, principalId, registeredClientId } = scope;
  if (!isOrganizationId(organizationId) || !isWorkspaceId(workspaceId) || !isHeadlessHostIncarnationId(registeredClientId) ||
      !isHeadlessHostIncarnationId(key) || typeof principalId !== "string" || principalId.length > 160 || principalId.length === 0 ||
      principalId.trim() !== principalId || /[\u0000-\u001f\u007f]/.test(principalId) || hasKnownPassiveCredential(principalId)) return;
  const identity = [organizationId, workspaceId, principalId, registeredClientId] as const;
  const record = hash([...identity, "conversation.turn", key]);
  return { count: hash(identity), record, operationId: `headless.${record}` };
}
function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Invalid reservation metadata.");
  return value;
}
function isDigest(value: unknown): value is string {
  return typeof value === "string" && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
}
function readReference(raw: unknown): HeadlessTurnReference {
  const { turnId, runId } = readStrictPassiveRecord(raw, ["turnId", "runId"]);
  if (typeof turnId !== "string" || normalizeConversationTurnId(turnId) !== turnId ||
      hasKnownPassiveCredential(turnId) || typeof runId !== "string" ||
      normalizeExecutionRunId(runId) !== runId || hasKnownPassiveCredential(runId))
    throw new Error("Invalid saved run reference.");
  return { turnId, runId };
}
function readReservation(raw: unknown) {
  const { fingerprint, expiresAt, reference } = readStrictPassiveRecord(raw, ["fingerprint", "expiresAt", "reference"]);
  if (!isDigest(fingerprint)) throw new Error("Invalid reservation metadata.");
  return { fingerprint, expiresAt: timestamp(expiresAt), ...(reference === undefined ? {} : { reference: readReference(reference) }) };
}
