import { createHash } from "node:crypto";
import {
  HEADLESS_MUTATIONS,
  type HeadlessMutation, type HeadlessMutationReference, type HeadlessOperationOutcome,
  type HeadlessOperationScope, type HeadlessOperationStorePort, type SystemBuilderRepositoryPort,
} from "../../../application/ports/system-builder";
import { isDesktopHeadlessClientId } from "../../../contracts/headless";
import { isOrganizationId } from "../../../contracts/organization";
import { readStrictPassiveRecord } from "../../../contracts/shared";
import { isSystemBuilderSystemId } from "../../../contracts/system-builder";
import { isWorkspaceId } from "../../../contracts/workspace";
import { cloneStructuredJson, type StructuredDocumentStore } from "../shared";
import { createStructuredSystemBuilderRepository } from "./createStructuredSystemBuilderRepository";

import { HEADLESS_SYSTEM_CHANGE_PAGE_SIZE, exactReference, readCommittedSystemChanges, safeInteger } from "./structuredSystemChangeJournal";
export { HEADLESS_RETAINED_SYSTEM_CHANGES, HEADLESS_SYSTEM_CHANGE_PAGE_SIZE } from "./structuredSystemChangeJournal";

const RECEIPTS = "headless/system-builder/receipts";
const COUNTS = "headless/system-builder/counts";
export const HEADLESS_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
export const HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE = 2_048;

type Scope = Pick<HeadlessOperationScope, "organizationId" | "workspaceId">;
type Receipt = { readonly fingerprint: string; readonly expiresAt: number; readonly reference: HeadlessMutationReference };
const digest = (value: readonly string[]) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

class Rollback extends Error {
  public constructor(readonly outcome: HeadlessOperationOutcome) { super("Headless operation rolled back."); }
}

/** A transaction owns the System Builder writes, scoped receipt, and event together. */
export function createStructuredHeadlessOperationStore(
  documents: StructuredDocumentStore,
  now: () => number = Date.now,
  policy?: {
    readonly authorize: (transaction: StructuredDocumentStore, scope: HeadlessOperationScope,
      operation: HeadlessMutation) => Promise<boolean>;
  },
): HeadlessOperationStorePort {
  return {
    async run(input) {
      const { scope, operation, key, fingerprint, isCurrent, mutate } = input;
      const { organizationId, workspaceId, principalId, registeredClientId } = scope;
      const boundScope = { organizationId, workspaceId, principalId, registeredClientId };
      if (!isOrganizationId(organizationId) || !isWorkspaceId(workspaceId) ||
          typeof principalId !== "string" || principalId.length < 1 || principalId.length > 160 ||
          principalId.trim() !== principalId || /[\u0000-\u001f\u007f]/.test(principalId) ||
          !isDesktopHeadlessClientId(registeredClientId) || !isDesktopHeadlessClientId(key) ||
          !HEADLESS_MUTATIONS.includes(operation) || typeof fingerprint !== "string" ||
          fingerprint.length !== 64 || !/^[a-f0-9]{64}$/.test(fingerprint) ||
          !isCurrent()) return { kind: "denied" };
      const identity = [organizationId, workspaceId, principalId, registeredClientId] as const;
      const countKey = digest(identity);
      const receiptKey = digest([...identity, operation, key]);
      try {
        // Desktop authorization needs the platform directory and the exact
        // organization partition within one underlying transaction owner.
        const store = policy ? documents : documents.forOrganization(organizationId);
        if (policy && documents.organizationId !== undefined) throw new Error("The platform owner is unavailable.");
        if (!store.runInOwnedTransaction) throw new Error("Owned transaction is unavailable.");
        let mustCommit = false;
        let replayExpiry: number | undefined;
        const outcome = await store.runInOwnedTransaction<HeadlessOperationOutcome>(async (owner) => {
          if (policy && !await policy.authorize(owner, boundScope, operation)) return { kind: "denied" };
          const transaction = policy ? owner.forOrganization(organizationId) : owner;
          if (!isCurrent()) return { kind: "denied" };
          const existing = await transaction.readDocument(RECEIPTS, receiptKey);
          if (!isCurrent()) return { kind: "denied" };
          if (existing) {
            const receipt = exactReceipt(existing.value);
            if (receipt.expiresAt <= receiptTime(now())) return { kind: "key-expired" };
            if (receipt.fingerprint !== fingerprint) return { kind: "key-conflict" };
            replayExpiry = receipt.expiresAt;
            return { kind: "replayed", reference: receipt.reference };
          }
          const count = await transaction.readDocument(COUNTS, countKey);
          const used = count ? safeInteger(readStrictPassiveRecord(count.value, ["value"]).value, 1) : 0;
          if (used >= HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE) return { kind: "capacity" };
          if (!isCurrent()) return { kind: "denied" };
          const { systems, written } = scopeSystemMutation(createStructuredSystemBuilderRepository(transaction, { journalChanges: true }), workspaceId, operation);
          const result = await mutate(systems);
          if (!result.ok) throw new Rollback({ kind: "mutation-failed", failure: result });
          const reference = exactReference(result.value);
          const current = await systems.readRecord(workspaceId, reference.systemId);
          const revision = await systems.readRevision(workspaceId, reference.systemId, reference.revisionId);
          if (written() !== reference.systemId || !current || current.revision !== reference.recordRevision ||
              current.currentRevisionId !== reference.revisionId || revision?.revisionId !== reference.revisionId)
            throw new Error("The saved operation reference does not match its workspace record.");
          if (!isCurrent()) throw new Rollback({ kind: "denied" });
          mustCommit = true;
          await transaction.writeDocument(RECEIPTS, receiptKey, {
            fingerprint, reference, expiresAt: receiptTime(now()) + HEADLESS_RECEIPT_TTL_MS,
          } satisfies Receipt, { expectedRevision: 0 });
          await transaction.writeDocument(COUNTS, countKey, { value: used + 1 }, { expectedRevision: count?.revision ?? 0 });
          if (!isCurrent()) throw new Rollback({ kind: "denied" });
          return { kind: "committed", reference };
        }, () => {
          if (mustCommit && !isCurrent()) throw new Rollback({ kind: "denied" });
        });
        if (!isCurrent()) return { kind: "denied" };
        if (outcome.kind === "replayed" && (replayExpiry === undefined || replayExpiry <= receiptTime(now())))
          return { kind: "key-expired" };
        return outcome;
      } catch (error) {
        if (error instanceof Rollback) return error.outcome;
        // The commit result might be uncertain. The caller must retry the same
        // identity/key or reconcile, never start a different operation.
        throw new Error("The saved operation could not be confirmed.");
      }
    },
    async watermark(scope) {
      const { organizationId, workspaceId } = scope;
      const log = await readCommittedSystemChanges(scopedStore(documents, { organizationId, workspaceId }), workspaceId);
      return log?.value.watermark ?? 0;
    },
    async readChanges(scope, after) {
      if (!Number.isSafeInteger(after) || after < 0) return { kind: "resync" };
      const { organizationId, workspaceId } = scope;
      const log = (await readCommittedSystemChanges(scopedStore(documents, { organizationId, workspaceId }), workspaceId))?.value;
      if (!log) return after === 0 ? { kind: "changes", events: [], watermark: 0 } : { kind: "resync" };
      const earliest = log.events[0]?.sequence;
      if (!earliest || after < earliest - 1 || after > log.watermark) return { kind: "resync" };
      return { kind: "changes", watermark: log.watermark,
        events: log.events.filter((event) => event.sequence > after).slice(0, HEADLESS_SYSTEM_CHANGE_PAGE_SIZE) };
    },
  };
}

function scopedStore(documents: StructuredDocumentStore, scope: Scope): StructuredDocumentStore {
  if (!isOrganizationId(scope.organizationId) || !isWorkspaceId(scope.workspaceId))
    throw new Error("The operation scope is unavailable.");
  return documents.forOrganization(scope.organizationId);
}

function receiptTime(value: number) {
  const timestamp = safeInteger(value, 0);
  if (timestamp > Number.MAX_SAFE_INTEGER - HEADLESS_RECEIPT_TTL_MS)
    throw new Error("The receipt clock is unavailable.");
  return timestamp;
}

function exactReceipt(value: unknown): Receipt {
  const { fingerprint, expiresAt, reference } = readStrictPassiveRecord(value, ["fingerprint", "expiresAt", "reference"]);
  if (typeof fingerprint !== "string" || fingerprint.length !== 64 || !/^[a-f0-9]{64}$/.test(fingerprint))
    throw new Error("The stored operation fingerprint is invalid.");
  return { fingerprint, expiresAt: safeInteger(expiresAt, HEADLESS_RECEIPT_TTL_MS), reference: exactReference(reference) };
}

/** Permit one System Builder record change under this transaction's verified scope. */
function scopeSystemMutation(
  repository: SystemBuilderRepositoryPort,
  workspaceId: HeadlessOperationScope["workspaceId"],
  operation: HeadlessMutation,
) {
  let changed: HeadlessMutationReference["systemId"] | undefined;
  let started = false;
  let violated = false;
  function refuse(): never {
    violated = true;
    throw new Error("The operation attempted an invalid repository effect.");
  }
  function requireScope(workspace: typeof workspaceId) {
    if (workspace !== workspaceId) refuse();
  }
  function write(workspace: typeof workspaceId, systemId: HeadlessMutationReference["systemId"]) {
    requireScope(workspace);
    if (started || !isSystemBuilderSystemId(systemId)) refuse();
    started = true;
  }
  function verifyPair(record: Parameters<SystemBuilderRepositoryPort["createRecordAndRevision"]>[0],
    revision: Parameters<SystemBuilderRepositoryPort["createRecordAndRevision"]>[1]) {
    if (revision.targetWorkspaceId !== record.targetWorkspaceId || revision.systemId !== record.systemId ||
        revision.revisionId !== record.currentRevisionId) refuse();
    write(record.targetWorkspaceId, record.systemId);
  }
  const systems: SystemBuilderRepositoryPort = {
    async createRecordAndRevision(record, revision) {
      if (operation !== "systems.create" && operation !== "systems.clone") return refuse();
      const savedRecord = cloneStructuredJson(record);
      const savedRevision = cloneStructuredJson(revision);
      verifyPair(savedRecord, savedRevision);
      const result = await repository.createRecordAndRevision(savedRecord, savedRevision);
      changed = result.record.systemId;
      return result;
    },
    async createRecord() { return refuse(); },
    async saveRevision() { return refuse(); },
    async saveRevisionAndRecord(revision, record, expected) {
      if (operation !== "systems.apply-edits") return refuse();
      const savedRecord = cloneStructuredJson(record);
      const savedRevision = cloneStructuredJson(revision);
      verifyPair(savedRecord, savedRevision);
      const result = await repository.saveRevisionAndRecord(savedRevision, savedRecord, expected);
      changed = result.record.systemId;
      return result;
    },
    async updateRecord(record, expected) {
      if (operation !== "systems.rename") return refuse();
      const savedRecord = cloneStructuredJson(record);
      write(savedRecord.targetWorkspaceId, savedRecord.systemId);
      const result = await repository.updateRecord(savedRecord, expected);
      changed = result.systemId;
      return result;
    },
    async readRecord(workspace, systemId) {
      requireScope(workspace); return repository.readRecord(workspace, systemId);
    },
    async readRevision(workspace, systemId, revisionId) {
      requireScope(workspace); return repository.readRevision(workspace, systemId, revisionId);
    },
    async listRecords(workspace, includeArchived) {
      requireScope(workspace); return repository.listRecords(workspace, includeArchived);
    },
    async listRevisions(workspace, systemId) {
      requireScope(workspace); return repository.listRevisions(workspace, systemId);
    },
  };
  return { systems, written: () => violated ? undefined : changed };
}
