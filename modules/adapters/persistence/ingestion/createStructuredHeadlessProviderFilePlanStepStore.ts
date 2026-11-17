import type { IngestionAcquisitionRepositoryPort } from "../../../application/ports/ingestion";
import type { HeadlessLocalFileSelection } from "../../../application/ports/ingestion/headless-local-file-selection.port";
import { isHeadlessHostIncarnationId } from "../../../contracts/headless";
import { normalizeIngestionSourceSnapshotId } from "../../../contracts/ingestion";
import { readStrictPassiveRecord } from "../../../contracts/shared";
import type { StructuredDocumentStore } from "../shared";
import { createStructuredIngestionAcquisitionRepository } from "./createStructuredIngestionAcquisitionRepository";
import {
  matchesStructuredHeadlessProviderFileSelection, readStructuredHeadlessProviderFileSelection,
} from "./createStructuredHeadlessLocalFileSelectionRepository";

const namespace = "headless/data/provider-file-plan-effects";
type PublishProvider = NonNullable<IngestionAcquisitionRepositoryPort["saveTaskWithProviderArtifact"]>;
export type OwnedProviderPublication = (owner: StructuredDocumentStore, ...input: Parameters<PublishProvider>) => ReturnType<PublishProvider>;

export interface ProviderFilePlanEffect {
  readonly key: string;
  readonly selection: HeadlessLocalFileSelection;
}

function effectKey(effect: ProviderFilePlanEffect) {
  if (!isHeadlessHostIncarnationId(effect.key)) throw new Error("The provider plan effect is unavailable.");
  return `${effect.selection.target.workspaceId}/${effect.key}`;
}

function effectIdentity({ selection }: ProviderFilePlanEffect) {
  const { principalId, registeredClientId, target } = selection;
  return JSON.stringify([principalId, registeredClientId, target.hostIncarnationId,
    target.workspaceId, target.taskId, target.fileId, target.taskRevision]);
}

/** Read an exact committed plan effect; an ordinary provider import supplies no receipt. */
export async function readCommittedStructuredProviderFilePlanEffect(owner: StructuredDocumentStore, effect: ProviderFilePlanEffect) {
  const { selection } = effect;
  if (owner.organizationId !== selection.organizationId ||
      !await matchesStructuredHeadlessProviderFileSelection(owner, selection)) return;
  const stored = await owner.readDocument(namespace, effectKey(effect));
  if (!stored) return;
  const receipt = readStrictPassiveRecord(stored.value, ["identity", "sourceSnapshotId", "artifactKey", "taskRevision"]);
  const { workspaceId, taskId, fileId, taskRevision } = selection.target;
  if (stored.revision !== 1 || receipt.identity !== effectIdentity(effect) || receipt.taskRevision !== taskRevision + 1 ||
      typeof receipt.sourceSnapshotId !== "string" || typeof receipt.artifactKey !== "string")
    throw new Error("The provider plan effect is unavailable.");
  const repository = createStructuredIngestionAcquisitionRepository(owner);
  const task = await repository.readTask(workspaceId, taskId);
  const file = task?.files[0];
  if (task?.organizationId !== selection.organizationId || task.workspaceId !== workspaceId || task.taskId !== taskId ||
      task.kind !== "hugging-face" || task.status !== "succeeded" || task.revision !== taskRevision + 1 ||
      task.files.length !== 1 || file?.fileId !== fileId || file.status !== "finalized" ||
      file.output?.sourceSnapshotId !== receipt.sourceSnapshotId || file.output.key !== receipt.artifactKey) return;
  const snapshot = await repository.readSourceSnapshot(workspaceId, normalizeIngestionSourceSnapshotId(file.output.sourceSnapshotId));
  const source = file.providerSource;
  if (!snapshot || !source || snapshot.organizationId !== selection.organizationId || snapshot.locator.kind !== "hugging-face" ||
      snapshot.workspaceId !== workspaceId || snapshot.snapshotId !== receipt.sourceSnapshotId ||
      snapshot.snapshotId !== `snapshot.${taskId}.${fileId}` || snapshot.sourceId !== `source.${taskId}.${fileId}` ||
      snapshot.sourceId !== file.output.sourceId || snapshot.rawArtifactKey !== file.output.key ||
      snapshot.mediaType !== file.output.mediaType || snapshot.sizeBytes !== file.output.sizeBytes ||
      snapshot.contentDigest !== file.output.digest || snapshot.locator.displayName !== file.fileName ||
      snapshot.providerRevision !== source.revision || file.output.providerRevision !== source.revision ||
      snapshot.locator.repository !== source.repository || snapshot.locator.path !== source.path ||
      snapshot.locator.revision !== source.revision ||
      JSON.stringify(snapshot.providerLicenseIds) !== JSON.stringify(file.output.providerLicenseIds)) return;
  return { task, snapshot, reference: { workspaceId, taskId, fileId, taskRevision: task.revision } };
}

/** Called only inside the plan owner's transaction, after its current approval and permission checks. */
export async function publishStructuredProviderFilePlanEffect(
  owner: StructuredDocumentStore, effect: ProviderFilePlanEffect, publish: OwnedProviderPublication,
  input: Parameters<PublishProvider>, now: () => number,
) {
  if (owner.runInOwnedTransaction || owner.organizationId !== effect.selection.organizationId)
    throw new Error("The provider plan publication needs its transaction owner.");
  const replay = await readCommittedStructuredProviderFilePlanEffect(owner, effect);
  if (replay) return { task: replay.task, snapshot: replay.snapshot };
  const selected = await readStructuredHeadlessProviderFileSelection(owner, effect.selection, now);
  const [task, expectedRevision, snapshot, artifact] = input;
  const { workspaceId, taskId, fileId, taskRevision } = effect.selection.target;
  const file = task.files[0];
  if (!selected?.ok || task.organizationId !== effect.selection.organizationId || task.workspaceId !== workspaceId ||
      task.taskId !== taskId || expectedRevision !== taskRevision || task.revision !== taskRevision + 1 ||
      task.files.length !== 1 || file?.fileId !== fileId || file.output?.providerRevision !== selected.value.providerRevision)
    throw new Error("The selected provider source changed.");
  const result = await publish(owner, task, expectedRevision, snapshot, artifact);
  if (result.task.workspaceId !== workspaceId || result.task.taskId !== taskId ||
      result.task.revision !== taskRevision + 1 || result.task.status !== "succeeded")
    throw new Error("The provider publication was not confirmed.");
  await owner.writeDocument(namespace, effectKey(effect), {
    identity: effectIdentity(effect), sourceSnapshotId: result.snapshot.snapshotId,
    artifactKey: result.snapshot.rawArtifactKey, taskRevision: result.task.revision,
  }, { expectedRevision: 0 });
  const confirmed = await readCommittedStructuredProviderFilePlanEffect(owner, effect);
  if (!confirmed) throw new Error("The provider publication was not confirmed.");
  return { task: confirmed.task, snapshot: confirmed.snapshot };
}
