import type { IngestionAcquisitionRepositoryPort, VerifiedIngestionProviderArtifact } from "../../../application/ports/ingestion";
import { assertPublicationOutput, normalizeIngestionFilePublication, publicationUnavailable } from "../../../application/shared/ingestion-file-publication";
import {
  INGESTION_TASK_LIST_LIMIT,
  normalizeIngestionSourceRefreshRecord,
  normalizeIngestionSourceSnapshot,
  normalizeIngestionSourceSnapshotId,
  normalizeIngestionSourceId,
  normalizeIngestionTaskRecord,
  type IngestionSourceRefreshRecord,
  type IngestionSourceSnapshot,
  type IngestionTaskFileRecord,
  type IngestionTaskRecord,
} from "../../../contracts/ingestion";
import { encodeArtifactRepoBackingLocator } from "../../../contracts/storage";
import type { WorkspaceId } from "../../../contracts/workspace";
import { StructuredDocumentConflictError, cloneStructuredJson, type StructuredDocumentStore } from "../shared";

export const INGESTION_TASK_NAMESPACE = "ingestion/acquisition-tasks";
export const INGESTION_SOURCE_SNAPSHOT_NAMESPACE = "ingestion/source-snapshots";
export const INGESTION_SOURCE_REFRESH_NAMESPACE = "ingestion/source-refreshes";
export const INGESTION_FILE_PUBLICATION_NAMESPACE = "ingestion/file-publications";

export function createStructuredIngestionAcquisitionRepository(
  documents: StructuredDocumentStore,
  writeProviderArtifact?: (transaction: StructuredDocumentStore, artifact: VerifiedIngestionProviderArtifact) => Promise<void>,
): IngestionAcquisitionRepositoryPort {
  async function saveTaskWithSourceSnapshot(
    input: IngestionTaskRecord, expectedRevision: number, snapshotInput: IngestionSourceSnapshot,
    artifact?: VerifiedIngestionProviderArtifact,
  ) {
    const task = normalizeIngestionTaskRecord(input);
    const snapshot = normalizeIngestionSourceSnapshot(snapshotInput);
    assertOrganizationScope(documents, task.organizationId);
    assertOrganizationScope(documents, snapshot.organizationId);
    assertTaskSnapshotRelationship(task, snapshot);
    const providerFile = artifact ? assertProviderPublication(task, snapshot, artifact) : undefined;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || task.revision !== expectedRevision + 1) throw new Error("Ingestion task updates require the next exact revision.");
    const taskDocumentKey = taskKey(task.workspaceId, task.taskId);
    const snapshotDocumentKey = snapshotKey(snapshot.workspaceId, snapshot.snapshotId);
    async function commitSnapshot(transaction: StructuredDocumentStore) {
      const current = await transaction.readDocument<IngestionTaskRecord>(INGESTION_TASK_NAMESPACE, taskDocumentKey);
      if (!current) throw new Error("Ingestion task does not exist.");
      const existing = normalizeIngestionTaskRecord(current.value);
      if (!sameTaskIdentity(existing, task)) throw new Error("Ingestion task identity is immutable.");
      if (existing.revision !== current.revision) throw new Error("Ingestion task revision is inconsistent.");
      if (existing.revision !== expectedRevision) {
        if (providerFile && existing.revision > expectedRevision) {
          const committed = await readProviderWinner(transaction, existing, providerFile, snapshot, snapshotDocumentKey);
          if (committed) return committed;
        }
        throw new StructuredDocumentConflictError(INGESTION_TASK_NAMESPACE, taskDocumentKey, expectedRevision);
      }
      assertTransition(existing, task);
      if (task.kind === "file-batch") {
        const added = task.files.filter(file => file.status === "finalized" && existing.files.find(before => before.fileId === file.fileId)?.status !== "finalized");
        if (added.length !== 1 || added[0]!.output?.sourceSnapshotId !== snapshot.snapshotId) publicationUnavailable();
        const file = added[0]!;
        const publicationKey = `${task.workspaceId}/${task.taskId}/${file.fileId}`;
        const document = await transaction.readDocument(INGESTION_FILE_PUBLICATION_NAMESPACE, publicationKey);
        if (!document || document.revision !== 5) publicationUnavailable();
        const publication = normalizeIngestionFilePublication(document.value);
        if (publication.state !== "origin-complete" || publication.revision !== document.revision) publicationUnavailable();
        assertPublicationOutput(publication, task);
        const expected = normalizeIngestionSourceSnapshot({
          schemaVersion: "1.0", snapshotId: normalizeIngestionSourceSnapshotId(`snapshot.${task.taskId}.${file.fileId}`),
          sourceId: normalizeIngestionSourceId(`source.${task.taskId}.${file.fileId}`),
          ...(task.organizationId ? { organizationId: task.organizationId } : {}), workspaceId: task.workspaceId,
          locator: { kind: "file", displayName: file.fileName, originalName: file.fileName },
          contentDigest: publication.digest, sizeBytes: publication.totalBytes, mediaType: publication.mediaType,
          rawArtifactKey: publication.key, capturedAt: publication.capturedAt,
        });
        if (stableJson(snapshot) !== stableJson(expected)) publicationUnavailable();
        await transaction.writeDocument(INGESTION_FILE_PUBLICATION_NAMESPACE, publicationKey,
          normalizeIngestionFilePublication({ ...publication, state: "committed", revision: 6 }), { expectedRevision: 5 });
      }
      const currentSnapshot = await transaction.readDocument<IngestionSourceSnapshot>(INGESTION_SOURCE_SNAPSHOT_NAMESPACE, snapshotDocumentKey);
      if (artifact && providerFile) {
        if (!writeProviderArtifact) throw new Error("Owned provider publication is unavailable.");
        const newlyFinalized = task.files.filter(file => file.status === "finalized" &&
          existing.files.find(before => before.fileId === file.fileId)?.status !== "finalized");
        if (currentSnapshot || newlyFinalized.length !== 1 || newlyFinalized[0] !== providerFile)
          throw new Error("The provider artifact does not match one new source.");
        await writeProviderArtifact(transaction, artifact);
      }
      if (currentSnapshot && stableJson(normalizeIngestionSourceSnapshot(currentSnapshot.value)) !== stableJson(snapshot)) throw new StructuredDocumentConflictError(INGESTION_SOURCE_SNAPSHOT_NAMESPACE, snapshotDocumentKey, 0);
      await transaction.writeDocument(INGESTION_TASK_NAMESPACE, taskDocumentKey, cloneStructuredJson(task), { expectedRevision: current.revision });
      if (!currentSnapshot) await transaction.writeDocument(INGESTION_SOURCE_SNAPSHOT_NAMESPACE, snapshotDocumentKey, cloneStructuredJson(snapshot), { expectedRevision: 0 });
      return { task: cloneStructuredJson(task), snapshot: cloneStructuredJson(snapshot) };
    }
    try {
      return await documents.runInTransaction(commitSnapshot);
    } catch (error) {
      if (providerFile) {
        // A conditional storage adapter can return a generic failure for a
        // serialization race. Reconcile the winner without issuing new writes.
        const committed = await documents.runInTransaction(async transaction => {
          const current = await transaction.readDocument<IngestionTaskRecord>(INGESTION_TASK_NAMESPACE, taskDocumentKey);
          if (!current || current.revision <= expectedRevision) return;
          const latest = normalizeIngestionTaskRecord(current.value);
          if (latest.revision !== current.revision || !sameTaskIdentity(latest, task)) return;
          return readProviderWinner(transaction, latest, providerFile, snapshot, snapshotDocumentKey);
        }).catch(() => undefined);
        if (committed) return committed;
      }
      throw error;
    }
  }

  return {
    async createTask(input) {
      const task = normalizeIngestionTaskRecord(input);
      assertOrganizationScope(documents, task.organizationId);
      if (task.revision !== 1) throw new Error("New ingestion tasks must start at revision 1.");
      return createImmutable(documents, INGESTION_TASK_NAMESPACE, taskKey(task.workspaceId, task.taskId), task, normalizeIngestionTaskRecord);
    },
    async readTask(workspaceId, taskId) {
      const value = (await documents.readDocument<IngestionTaskRecord>(INGESTION_TASK_NAMESPACE, taskKey(workspaceId, taskId)))?.value;
      if (!value) return undefined;
      const task = normalizeIngestionTaskRecord(value);
      assertOrganizationScope(documents, task.organizationId);
      return task.workspaceId === workspaceId ? cloneStructuredJson(task) : undefined;
    },
    async listTasks(workspaceId, limit = INGESTION_TASK_LIST_LIMIT) {
      const boundedLimit = listLimit(limit);
      const tasks = (await documents.listDocuments<IngestionTaskRecord>(INGESTION_TASK_NAMESPACE)).map((document) => normalizeIngestionTaskRecord(document.value));
      tasks.forEach((task) => assertOrganizationScope(documents, task.organizationId));
      return tasks.filter((task) => task.workspaceId === workspaceId).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, boundedLimit).map(cloneStructuredJson);
    },
    async listExpiredCheckpointTasks(workspaceId, expiresAtOrBefore, limit = INGESTION_TASK_LIST_LIMIT) {
      const boundedLimit = listLimit(limit);
      const cutoff = timestamp(expiresAtOrBefore);
      const tasks = (await documents.listDocuments<IngestionTaskRecord>(INGESTION_TASK_NAMESPACE)).map((document) => normalizeIngestionTaskRecord(document.value));
      tasks.forEach((task) => assertOrganizationScope(documents, task.organizationId));
      return tasks
        .filter((task) => task.workspaceId === workspaceId && task.cleanupPending && Boolean(task.checkpointExpiresAt) && task.checkpointExpiresAt! <= cutoff)
        .sort((left, right) => left.checkpointExpiresAt!.localeCompare(right.checkpointExpiresAt!))
        .slice(0, boundedLimit)
        .map(cloneStructuredJson);
    },
    async saveTask(input, expectedRevision) {
      const task = normalizeIngestionTaskRecord(input);
      assertOrganizationScope(documents, task.organizationId);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || task.revision !== expectedRevision + 1) throw new Error("Ingestion task updates require the next exact revision.");
      const key = taskKey(task.workspaceId, task.taskId);
      return documents.runInTransaction(async (transaction) => {
        const current = await transaction.readDocument<IngestionTaskRecord>(INGESTION_TASK_NAMESPACE, key);
        if (!current) throw new Error("Ingestion task does not exist.");
        const existing = normalizeIngestionTaskRecord(current.value);
        if (existing.workspaceId !== task.workspaceId || existing.taskId !== task.taskId || existing.organizationId !== task.organizationId) throw new Error("Ingestion task identity is immutable.");
        if (existing.revision !== expectedRevision || current.revision !== expectedRevision) throw new StructuredDocumentConflictError(INGESTION_TASK_NAMESPACE, key, expectedRevision);
        assertTransition(existing, task);
        if (task.kind === "file-batch" && task.files.some(file => file.status === "finalized" && existing.files.find(before => before.fileId === file.fileId)?.status !== "finalized")) {
          throw new Error("Local file completion requires its private publication and source snapshot transaction.");
        }
        await transaction.writeDocument(INGESTION_TASK_NAMESPACE, key, cloneStructuredJson(task), { expectedRevision: current.revision });
        return cloneStructuredJson(task);
      });
    },
    async markCancelledCheckpointCleanupPending(input) {
      const { workspaceId, taskId, fileId, checkpointId, expectedRevision, updatedAt } = input;
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("Checkpoint cleanup requires an exact task revision.");
      const key = taskKey(workspaceId, taskId);
      await documents.runInTransaction(async transaction => {
        const current = await transaction.readDocument<IngestionTaskRecord>(INGESTION_TASK_NAMESPACE, key);
        if (!current) throw new Error("Cancelled ingestion checkpoint is unavailable.");
        const task = normalizeIngestionTaskRecord(current.value);
        assertOrganizationScope(documents, task.organizationId);
        const file = task.files.find(candidate => candidate.fileId === fileId);
        if (task.workspaceId !== workspaceId || task.taskId !== taskId || task.kind !== "file-batch"
            || task.status !== "cancelled" || file?.status !== "cancelled"
            || file.checkpointId !== checkpointId || file.output !== undefined) {
          throw new Error("Cancelled ingestion checkpoint is unavailable.");
        }
        if (task.revision !== expectedRevision || current.revision !== expectedRevision) {
          throw new StructuredDocumentConflictError(INGESTION_TASK_NAMESPACE, key, expectedRevision);
        }
        // Advance even when cleanup is pending so an earlier cleanup cannot clear this write.
        const pending = normalizeIngestionTaskRecord({ ...task, cleanupPending: true, updatedAt, revision: expectedRevision + 1 });
        await transaction.writeDocument(INGESTION_TASK_NAMESPACE, key, cloneStructuredJson(pending), { expectedRevision });
      });
    },
    saveTaskWithSourceSnapshot,
    ...(writeProviderArtifact ? { saveTaskWithProviderArtifact: saveTaskWithSourceSnapshot } : {}),
    async createSourceSnapshot(input) {
      const snapshot = normalizeIngestionSourceSnapshot(input);
      assertOrganizationScope(documents, snapshot.organizationId);
      return createImmutable(documents, INGESTION_SOURCE_SNAPSHOT_NAMESPACE, snapshotKey(snapshot.workspaceId, snapshot.snapshotId), snapshot, normalizeIngestionSourceSnapshot);
    },
    async readSourceSnapshot(workspaceId, snapshotId) {
      const value = (await documents.readDocument<IngestionSourceSnapshot>(INGESTION_SOURCE_SNAPSHOT_NAMESPACE, snapshotKey(workspaceId, snapshotId)))?.value;
      if (!value) return undefined;
      const snapshot = normalizeIngestionSourceSnapshot(value);
      assertOrganizationScope(documents, snapshot.organizationId);
      return snapshot.workspaceId === workspaceId ? cloneStructuredJson(snapshot) : undefined;
    },
    async listSourceSnapshots(workspaceId, sourceId, limit = 50) {
      const snapshots = (await documents.listDocuments<IngestionSourceSnapshot>(INGESTION_SOURCE_SNAPSHOT_NAMESPACE)).map((document) => normalizeIngestionSourceSnapshot(document.value));
      snapshots.forEach((snapshot) => assertOrganizationScope(documents, snapshot.organizationId));
      const scoped = snapshots
        .filter((snapshot) => snapshot.workspaceId === workspaceId && snapshot.sourceId === sourceId)
        .map((snapshot) => ({ snapshot, time: Date.parse(snapshot.capturedAt) }));
      const timeById = new Map(scoped.map(({ snapshot, time }) => [snapshot.snapshotId, time]));
      const superseded = new Set<IngestionSourceSnapshot["snapshotId"]>();
      for (const { snapshot, time } of scoped) {
        const previousId = snapshot.previousSnapshotId;
        if (previousId && previousId !== snapshot.snapshotId && timeById.get(previousId) === time) {
          superseded.add(previousId);
        }
      }
      return scoped.sort((left, right) => right.time - left.time
        || Number(superseded.has(left.snapshot.snapshotId)) - Number(superseded.has(right.snapshot.snapshotId)))
        .slice(0, listLimit(limit)).map(({ snapshot }) => cloneStructuredJson(snapshot));
    },
    async recordSourceRefresh(input) {
      const record = normalizeIngestionSourceRefreshRecord(input);
      assertOrganizationScope(documents, record.organizationId);
      if (record.outcome === "changed") throw new Error("Changed source refreshes must commit their matching snapshot atomically.");
      return createImmutable(documents, INGESTION_SOURCE_REFRESH_NAMESPACE, refreshKey(record.workspaceId, record.refreshId), record, normalizeIngestionSourceRefreshRecord);
    },
    async recordSourceRefreshWithSnapshot(snapshotInput, refreshInput) {
      const snapshot = normalizeIngestionSourceSnapshot(snapshotInput);
      const refresh = normalizeIngestionSourceRefreshRecord(refreshInput);
      assertOrganizationScope(documents, snapshot.organizationId);
      assertOrganizationScope(documents, refresh.organizationId);
      const previousSnapshotId = refresh.previousSnapshotId;
      if (refresh.outcome !== "changed" || !previousSnapshotId || previousSnapshotId === snapshot.snapshotId
        || snapshot.previousSnapshotId !== previousSnapshotId
        || refresh.currentSnapshotId !== snapshot.snapshotId || refresh.sourceId !== snapshot.sourceId
        || refresh.workspaceId !== snapshot.workspaceId || refresh.organizationId !== snapshot.organizationId) {
        throw new Error("Changed source refreshes must commit their matching snapshot atomically.");
      }
      const snapshotDocumentKey = snapshotKey(snapshot.workspaceId, snapshot.snapshotId);
      const refreshDocumentKey = refreshKey(refresh.workspaceId, refresh.refreshId);
      return documents.runInTransaction(async (transaction) => {
        const previousDocument = await transaction.readDocument<IngestionSourceSnapshot>(INGESTION_SOURCE_SNAPSHOT_NAMESPACE, snapshotKey(refresh.workspaceId, previousSnapshotId));
        const previous = previousDocument && normalizeIngestionSourceSnapshot(previousDocument.value);
        if (!previous || previous.snapshotId !== previousSnapshotId || previous.sourceId !== refresh.sourceId
          || previous.workspaceId !== refresh.workspaceId || previous.organizationId !== refresh.organizationId) {
          throw new Error("Changed source refreshes require their previous source snapshot.");
        }
        const currentSnapshot = await transaction.readDocument<IngestionSourceSnapshot>(INGESTION_SOURCE_SNAPSHOT_NAMESPACE, snapshotDocumentKey);
        if (currentSnapshot && stableJson(normalizeIngestionSourceSnapshot(currentSnapshot.value)) !== stableJson(snapshot)) throw new StructuredDocumentConflictError(INGESTION_SOURCE_SNAPSHOT_NAMESPACE, snapshotDocumentKey, 0);
        const currentRefresh = await transaction.readDocument<IngestionSourceRefreshRecord>(INGESTION_SOURCE_REFRESH_NAMESPACE, refreshDocumentKey);
        if (currentRefresh && stableJson(normalizeIngestionSourceRefreshRecord(currentRefresh.value)) !== stableJson(refresh)) throw new StructuredDocumentConflictError(INGESTION_SOURCE_REFRESH_NAMESPACE, refreshDocumentKey, 0);
        if (!currentSnapshot) await transaction.writeDocument(INGESTION_SOURCE_SNAPSHOT_NAMESPACE, snapshotDocumentKey, cloneStructuredJson(snapshot), { expectedRevision: 0 });
        if (!currentRefresh) await transaction.writeDocument(INGESTION_SOURCE_REFRESH_NAMESPACE, refreshDocumentKey, cloneStructuredJson(refresh), { expectedRevision: 0 });
        return { snapshot: cloneStructuredJson(snapshot), refresh: cloneStructuredJson(refresh) };
      });
    },
    async listSourceRefreshes(workspaceId, sourceId, limit = 50) {
      const records = (await documents.listDocuments<IngestionSourceRefreshRecord>(INGESTION_SOURCE_REFRESH_NAMESPACE)).map((document) => normalizeIngestionSourceRefreshRecord(document.value));
      records.forEach((record) => assertOrganizationScope(documents, record.organizationId));
      return records.filter((record) => record.workspaceId === workspaceId && record.sourceId === sourceId).sort((left, right) => right.checkedAt.localeCompare(left.checkedAt)).slice(0, listLimit(limit)).map(cloneStructuredJson);
    },
  };
}

async function createImmutable<T>(documents: StructuredDocumentStore, namespace: string, key: string, input: T, normalize: (value: T) => T): Promise<T> {
  return documents.runInTransaction(async (transaction) => {
    const current = await transaction.readDocument<T>(namespace, key);
    if (current) {
      const existing = normalize(current.value);
      if (stableJson(existing) === stableJson(input)) return cloneStructuredJson(existing);
      throw new StructuredDocumentConflictError(namespace, key, 0);
    }
    await transaction.writeDocument(namespace, key, cloneStructuredJson(input), { expectedRevision: 0 });
    return cloneStructuredJson(input);
  });
}

function assertTransition(previous: IngestionTaskRecord, next: IngestionTaskRecord): void {
  if (previous.status === "succeeded") throw new Error("Succeeded ingestion tasks are immutable.");
  if (previous.status === "cancelled" && !(previous.cleanupPending && next.status === "cancelled" && !next.cleanupPending
      && next.completedAt === previous.completedAt && stableJson(next.files) === stableJson(previous.files))) {
    throw new Error("Cancelled ingestion tasks are immutable after cleanup.");
  }
  if (previous.status === "failed" && next.status !== "transferring" && next.status !== "failed") throw new Error("Failed ingestion tasks may only resume or retain failure state.");
  if (previous.createdAt !== next.createdAt || previous.checkpointExpiresAt !== next.checkpointExpiresAt || previous.kind !== next.kind || previous.files.length !== next.files.length) throw new Error("Ingestion task definition is immutable.");
  for (const before of previous.files) {
    const after = next.files.find((file) => file.fileId === before.fileId);
    if (!after || after.checkpointId !== before.checkpointId || after.fileName !== before.fileName || after.mediaType !== before.mediaType || after.totalBytes !== before.totalBytes || stableJson(after.providerSource) !== stableJson(before.providerSource) || stableJson(after.websiteSource) !== stableJson(before.websiteSource)) throw new Error("Ingestion task file definition is immutable.");
    if (after.acceptedBytes < before.acceptedBytes || after.nextChunkIndex < before.nextChunkIndex) throw new Error("Ingestion task progress must be monotonic.");
    if (before.status === "finalized" && (after.status !== "finalized" || stableJson(before.output) !== stableJson(after.output)
      || before.acceptedBytes !== after.acceptedBytes || before.nextChunkIndex !== after.nextChunkIndex || stableJson(before.lastChunk) !== stableJson(after.lastChunk))) {
      throw new Error("Finalized ingestion file outputs and checkpoint counters are immutable.");
    }
  }
}

function assertOrganizationScope(documents: StructuredDocumentStore, organizationId: string | undefined): void {
  if (documents.organizationId !== organizationId) throw new Error("Ingestion record organization must match the repository organization scope.");
}

function sameTaskIdentity(left: IngestionTaskRecord, right: IngestionTaskRecord) {
  return left.taskId === right.taskId && left.workspaceId === right.workspaceId && left.organizationId === right.organizationId;
}

function assertProviderPublication(task: IngestionTaskRecord, snapshot: IngestionSourceSnapshot,
  artifact: VerifiedIngestionProviderArtifact): IngestionTaskFileRecord {
  const file = task.files.find(candidate => candidate.output?.sourceSnapshotId === snapshot.snapshotId);
  const source = file?.providerSource;
  const { catalog, binding } = artifact;
  const { backing } = binding;
  if (task.kind !== "hugging-face" || !file || !source || file.status !== "finalized" ||
      snapshot.sourceId !== `source.${task.taskId}.${file.fileId}` ||
      snapshot.snapshotId !== `snapshot.${task.taskId}.${file.fileId}` ||
      !isProviderSnapshot(snapshot, file) ||
      catalog.workspaceId !== task.workspaceId || binding.workspaceId !== task.workspaceId ||
      catalog.storageKey !== snapshot.rawArtifactKey || binding.artifactId !== snapshot.rawArtifactKey ||
      catalog.sourceKind !== "upload" || catalog.mediaType !== file.mediaType || catalog.originalName !== source.path ||
      binding.role !== "imported-source" || backing.kind !== "artifact-repo" || backing.provider !== source.provider ||
      backing.revision !== source.revision || backing.locator !== encodeArtifactRepoBackingLocator(source) ||
      backing.target?.provider !== source.provider || backing.target.repository !== source.repository ||
      backing.target.path !== source.path || backing.target.revision !== source.revision ||
      backing.verification?.exists !== true || !backing.verification.verifiedAt ||
      backing.verification.verifiedAt !== catalog.createdAt || binding.createdAt !== catalog.createdAt) {
    throw new Error("The verified provider artifact does not match the selected source.");
  }
  return file;
}

function isProviderSnapshot(snapshot: IngestionSourceSnapshot, file: IngestionTaskFileRecord) {
  const source = file.providerSource;
  return source && snapshot.locator.kind === "hugging-face" &&
    snapshot.locator.repository === source.repository && snapshot.locator.path === source.path &&
    snapshot.locator.revision === source.revision && snapshot.providerRevision === source.revision &&
    snapshot.locator.displayName === file.fileName && snapshot.sizeBytes === 0 && !snapshot.contentDigest;
}

async function readProviderWinner(transaction: StructuredDocumentStore, task: IngestionTaskRecord,
  proposedFile: IngestionTaskFileRecord, proposedSnapshot: IngestionSourceSnapshot, key: string) {
  const file = task.files.find(candidate => candidate.fileId === proposedFile.fileId);
  if (task.kind !== "hugging-face" || file?.status !== "finalized" ||
      stableJson(file.providerSource) !== stableJson(proposedFile.providerSource) ||
      file.output?.sourceSnapshotId !== proposedSnapshot.snapshotId || file.output.sourceId !== proposedSnapshot.sourceId) return;
  const stored = await transaction.readDocument<IngestionSourceSnapshot>(INGESTION_SOURCE_SNAPSHOT_NAMESPACE, key);
  if (!stored) return;
  const snapshot = normalizeIngestionSourceSnapshot(stored.value);
  if (!isProviderSnapshot(snapshot, file) || snapshot.snapshotId !== proposedSnapshot.snapshotId ||
      snapshot.sourceId !== proposedSnapshot.sourceId) return;
  assertTaskSnapshotRelationship(task, snapshot, { allowLegacyLicenseOmission: true });
  return { task: cloneStructuredJson(task), snapshot: cloneStructuredJson(snapshot) };
}

function assertTaskSnapshotRelationship(task: IngestionTaskRecord, snapshot: IngestionSourceSnapshot,
  options?: { readonly allowLegacyLicenseOmission: boolean }): void {
  const matchesOutput = task.files.some((file) => file.status === "finalized" && file.output?.sourceId === snapshot.sourceId
    && file.output.sourceSnapshotId === snapshot.snapshotId && file.output.key === snapshot.rawArtifactKey
    && file.output.mediaType === snapshot.mediaType && file.output.sizeBytes === snapshot.sizeBytes
    && file.output.digest === snapshot.contentDigest && file.output.providerRevision === snapshot.providerRevision
    && ((options?.allowLegacyLicenseOmission && file.output.providerLicenseIds === undefined) ||
      stableJson(file.output.providerLicenseIds ?? null) === stableJson(snapshot.providerLicenseIds ?? null))
    && stableJson(file.output.derivedArtifactKeys ?? []) === stableJson(snapshot.derivedArtifactKeys ?? []));
  if (task.workspaceId !== snapshot.workspaceId || task.organizationId !== snapshot.organizationId || !matchesOutput) throw new Error("Ingestion task snapshot must match a finalized task output in the same scope.");
}
const taskKey = (workspaceId: WorkspaceId, taskId: string) => `${workspaceId}/${taskId}`;
const snapshotKey = (workspaceId: WorkspaceId, snapshotId: string) => `${workspaceId}/${snapshotId}`;
const refreshKey = (workspaceId: WorkspaceId, refreshId: string) => `${workspaceId}/${refreshId}`;
function listLimit(value: number): number { if (!Number.isSafeInteger(value) || value < 1 || value > INGESTION_TASK_LIST_LIMIT) throw new Error(`Ingestion list limit must be between 1 and ${INGESTION_TASK_LIST_LIMIT}.`); return value; }
function timestamp(value: string): string { const normalized = String(value).trim(); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized) || Number.isNaN(Date.parse(normalized))) throw new Error("Ingestion cleanup cutoff must be an ISO-8601 UTC timestamp."); return normalized; }
function stableJson(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; return `{${Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`; }
