import type { IngestionFilePublication } from "../../../application/ports/ingestion";
import type { HeadlessLocalFileSelection } from "../../../application/ports/ingestion/headless-local-file-selection.port";
import { assertPublicationOutput, assertPublicationTask, publicationUnavailable } from "../../../application/shared/ingestion-file-publication";
import { isHeadlessHostIncarnationId } from "../../../contracts/headless";
import { normalizeIngestionTaskRecord, type IngestionTaskRecord } from "../../../contracts/ingestion";
import { readStrictPassiveRecord } from "../../../contracts/shared";
import type { StructuredDocumentStore } from "../shared";
import { matchesStructuredHeadlessLocalFileSelection } from "./createStructuredHeadlessLocalFileSelectionRepository";
import {
  createStructuredIngestionFilePublicationRepository, savePublicationInOwnedTransaction,
} from "./createStructuredIngestionFilePublicationRepository";
import { INGESTION_TASK_NAMESPACE } from "./createStructuredIngestionAcquisitionRepository";

const namespace = "headless/data/local-file-plan-effects";

export interface LocalFilePlanEffect {
  readonly key: string;
  readonly selection: HeadlessLocalFileSelection;
}

function effectKey({ key, selection }: LocalFilePlanEffect) {
  if (!isHeadlessHostIncarnationId(key)) publicationUnavailable();
  return `${selection.target.workspaceId}/${key}`;
}

function effectIdentity(effect: LocalFilePlanEffect) {
  const { selection: { principalId, registeredClientId, target } } = effect;
  return JSON.stringify([principalId, registeredClientId, target.hostIncarnationId,
    target.workspaceId, target.taskId, target.fileId, target.taskRevision]);
}

async function readEffect(owner: StructuredDocumentStore, effect: LocalFilePlanEffect) {
  if (owner.organizationId !== effect.selection.organizationId) publicationUnavailable();
  const record = await owner.readDocument(namespace, effectKey(effect));
  if (!record) return;
  const { identity, publicationId, phase } = readStrictPassiveRecord(record.value,
    ["identity", "publicationId", "phase"]);
  if (identity !== effectIdentity(effect) || typeof publicationId !== "string" || publicationId.length > 128 ||
      (phase !== "writing" && phase !== "origin-issued") || record.revision !== (phase === "writing" ? 1 : 2))
    publicationUnavailable();
  return { publicationId, phase, revision: record.revision };
}

/** Issue a byte write or a composite origin write in the same transaction as approval. */
export async function issueStructuredLocalFilePlanEffect(
  owner: StructuredDocumentStore, effect: LocalFilePlanEffect,
  next: IngestionFilePublication, expectedRevision: 1 | 3, now: number,
) {
  const { selection } = effect;
  const { workspaceId, taskId, fileId, taskRevision } = selection.target;
  const expectedPhase = expectedRevision === 1 ? "writing" : "origin-issued";
  const deadline = Date.parse(next.checkpointExpiresAt ?? "");
  if (owner.runInOwnedTransaction || (expectedRevision !== 1 && expectedRevision !== 3) ||
      next.workspaceId !== workspaceId || next.taskId !== taskId || next.fileId !== fileId ||
      next.organizationId !== selection.organizationId || next.state !== expectedPhase ||
      !Number.isSafeInteger(now) || now < 1 || !Number.isSafeInteger(deadline) || now >= deadline ||
      !await matchesStructuredHeadlessLocalFileSelection(owner, selection)) publicationUnavailable();
  const task = await owner.readDocument(INGESTION_TASK_NAMESPACE, `${workspaceId}/${taskId}`);
  if (!task || task.revision !== taskRevision + 1) publicationUnavailable();
  const record = await readEffect(owner, effect);
  if (expectedRevision === 1 ? record !== undefined : record?.phase !== "writing" || record.publicationId !== next.publicationId)
    publicationUnavailable();
  const issued = await savePublicationInOwnedTransaction(owner, next, expectedRevision);
  await owner.writeDocument(namespace, effectKey(effect), {
    identity: effectIdentity(effect), publicationId: issued.publicationId, phase: expectedPhase,
  }, { expectedRevision: record?.revision ?? 0 });
  return issued;
}

/** Accept an existing save only when both issue phases belonged to this exact plan step. */
export async function readCommittedStructuredLocalFilePlanEffect(owner: StructuredDocumentStore, effect: LocalFilePlanEffect) {
  const record = await readEffect(owner, effect);
  if (record?.phase !== "origin-issued") return;
  const { workspaceId, taskId, fileId, taskRevision } = effect.selection.target;
  const publication = await createStructuredIngestionFilePublicationRepository(owner).readPublication(workspaceId, taskId, fileId);
  if (publication?.state !== "committed" || publication.publicationId !== record.publicationId) return;
  const stored = await owner.readDocument<IngestionTaskRecord>(INGESTION_TASK_NAMESPACE, `${workspaceId}/${taskId}`);
  if (!stored || stored.revision <= taskRevision + 1) return;
  const task = normalizeIngestionTaskRecord(stored.value);
  if (task.revision !== stored.revision || task.status === "cancelled") return;
  assertPublicationTask(publication, task);
  assertPublicationOutput(publication, task);
  // One CAS enters finalizing and the next commits this single selected source.
  // Checkpoint cleanup can advance the task without changing that save result.
  return { workspaceId, taskId, fileId, taskRevision: taskRevision + 2 };
}
