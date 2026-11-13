import type { CommittedSystemChange, HeadlessMutationReference } from "../../../application/ports/system-builder";
import { readStrictPassiveRecord } from "../../../contracts/shared";
import { isSystemBuilderSystemId, normalizeSystemBuilderRevisionId } from "../../../contracts/system-builder";
import { isWorkspaceId, type WorkspaceId } from "../../../contracts/workspace";
import type { StructuredDocumentStore } from "../shared";

const CHANGES = "headless/system-builder/changes";
export const HEADLESS_RETAINED_SYSTEM_CHANGES = 256;
export const HEADLESS_SYSTEM_CHANGE_PAGE_SIZE = 64;
type ChangeLog = { readonly watermark: number; readonly events: readonly CommittedSystemChange[] };
type SavedChange = Omit<CommittedSystemChange, "sequence">;

export async function readCommittedSystemChanges(store: StructuredDocumentStore, workspaceId: WorkspaceId) {
  if (!isWorkspaceId(workspaceId)) throw new Error("The change scope is unavailable.");
  const document = await store.readDocument(CHANGES, workspaceId);
  return document ? { revision: document.revision, value: exactLog(document.value) } : undefined;
}

/** Call only inside the transaction that changes the saved system record. */
export async function appendCommittedSystemChange(transaction: StructuredDocumentStore, workspaceId: WorkspaceId,
  savedReference: SavedChange): Promise<void> {
  if (!transaction.organizationId) throw new Error("The change organization is unavailable.");
  const reference = exactChange(savedReference);
  const log = await readCommittedSystemChanges(transaction, workspaceId);
  const sequence = safeInteger((log?.value.watermark ?? 0) + 1, 1);
  await transaction.writeDocument(CHANGES, workspaceId, {
    watermark: sequence,
    events: [...(log?.value.events ?? []), { ...reference, sequence }].slice(-HEADLESS_RETAINED_SYSTEM_CHANGES),
  } satisfies ChangeLog, { expectedRevision: log?.revision ?? 0 });
}

export function exactReference(value: unknown): HeadlessMutationReference {
  const reference = exactChange(value);
  if (reference.revisionId === null) throw new Error("The saved operation reference is invalid.");
  return { ...reference, revisionId: reference.revisionId };
}

function exactChange(value: unknown): SavedChange {
  const { systemId, recordRevision, revisionId } = readStrictPassiveRecord(value, ["systemId", "recordRevision", "revisionId"]);
  if (!isSystemBuilderSystemId(systemId) || (revisionId !== null && typeof revisionId !== "string"))
    throw new Error("The saved system change is invalid.");
  const normalized = revisionId === null ? null : normalizeSystemBuilderRevisionId(revisionId);
  if (normalized !== revisionId) throw new Error("The saved system change is invalid.");
  return { systemId, recordRevision: safeInteger(recordRevision, 1), revisionId: normalized };
}

export function safeInteger(value: unknown, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum)
    throw new Error("The stored operation metadata is invalid.");
  return value;
}

function exactLog(value: unknown): ChangeLog {
  const { watermark: rawWatermark, events } = readStrictPassiveRecord(value, ["watermark", "events"]);
  const watermark = safeInteger(rawWatermark, 1);
  if (!Array.isArray(events) || events.length !== Math.min(watermark, HEADLESS_RETAINED_SYSTEM_CHANGES))
    throw new Error("The stored change log is invalid.");
  const result: CommittedSystemChange[] = [];
  for (let index = 0; index < events.length; index++) {
    const { sequence, ...reference } = readStrictPassiveRecord(events[index], ["sequence", "systemId", "recordRevision", "revisionId"]);
    if (sequence !== watermark - events.length + index + 1) throw new Error("The stored change sequence is invalid.");
    result.push({ sequence, ...exactChange(reference) });
  }
  return { watermark, events: result };
}
