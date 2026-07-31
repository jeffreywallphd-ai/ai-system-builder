import type { IngestionAcquisitionRepositoryPort } from "../../../application/ports/ingestion";
import {
  INGESTION_TASK_LIST_LIMIT,
  normalizeIngestionSourceRefreshRecord,
  normalizeIngestionSourceSnapshot,
  normalizeIngestionTaskRecord,
  type IngestionSourceRefreshRecord,
  type IngestionSourceSnapshot,
  type IngestionTaskRecord,
} from "../../../contracts/ingestion";
import type { WorkspaceId } from "../../../contracts/workspace";
import { StructuredDocumentConflictError, cloneStructuredJson, type StructuredDocumentStore } from "../shared";

export const INGESTION_TASK_NAMESPACE = "ingestion/acquisition-tasks";
export const INGESTION_SOURCE_SNAPSHOT_NAMESPACE = "ingestion/source-snapshots";
export const INGESTION_SOURCE_REFRESH_NAMESPACE = "ingestion/source-refreshes";

export function createStructuredIngestionAcquisitionRepository(documents: StructuredDocumentStore): IngestionAcquisitionRepositoryPort {
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
        await transaction.writeDocument(INGESTION_TASK_NAMESPACE, key, cloneStructuredJson(task), { expectedRevision: current.revision });
        return cloneStructuredJson(task);
      });
    },
    async saveTaskWithSourceSnapshot(input, expectedRevision, snapshotInput) {
      const task = normalizeIngestionTaskRecord(input);
      const snapshot = normalizeIngestionSourceSnapshot(snapshotInput);
      assertOrganizationScope(documents, task.organizationId);
      assertOrganizationScope(documents, snapshot.organizationId);
      assertTaskSnapshotRelationship(task, snapshot);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || task.revision !== expectedRevision + 1) throw new Error("Ingestion task updates require the next exact revision.");
      const taskDocumentKey = taskKey(task.workspaceId, task.taskId);
      const snapshotDocumentKey = snapshotKey(snapshot.workspaceId, snapshot.snapshotId);
      return documents.runInTransaction(async (transaction) => {
        const current = await transaction.readDocument<IngestionTaskRecord>(INGESTION_TASK_NAMESPACE, taskDocumentKey);
        if (!current) throw new Error("Ingestion task does not exist.");
        const existing = normalizeIngestionTaskRecord(current.value);
        if (existing.workspaceId !== task.workspaceId || existing.taskId !== task.taskId || existing.organizationId !== task.organizationId) throw new Error("Ingestion task identity is immutable.");
        if (existing.revision !== expectedRevision || current.revision !== expectedRevision) throw new StructuredDocumentConflictError(INGESTION_TASK_NAMESPACE, taskDocumentKey, expectedRevision);
        assertTransition(existing, task);
        const currentSnapshot = await transaction.readDocument<IngestionSourceSnapshot>(INGESTION_SOURCE_SNAPSHOT_NAMESPACE, snapshotDocumentKey);
        if (currentSnapshot && stableJson(normalizeIngestionSourceSnapshot(currentSnapshot.value)) !== stableJson(snapshot)) throw new StructuredDocumentConflictError(INGESTION_SOURCE_SNAPSHOT_NAMESPACE, snapshotDocumentKey, 0);
        await transaction.writeDocument(INGESTION_TASK_NAMESPACE, taskDocumentKey, cloneStructuredJson(task), { expectedRevision: current.revision });
        if (!currentSnapshot) await transaction.writeDocument(INGESTION_SOURCE_SNAPSHOT_NAMESPACE, snapshotDocumentKey, cloneStructuredJson(snapshot), { expectedRevision: 0 });
        return { task: cloneStructuredJson(task), snapshot: cloneStructuredJson(snapshot) };
      });
    },
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
      return snapshots.filter((snapshot) => snapshot.workspaceId === workspaceId && snapshot.sourceId === sourceId).sort((left, right) => right.capturedAt.localeCompare(left.capturedAt)).slice(0, listLimit(limit)).map(cloneStructuredJson);
    },
    async recordSourceRefresh(input) {
      const record = normalizeIngestionSourceRefreshRecord(input);
      assertOrganizationScope(documents, record.organizationId);
      return createImmutable(documents, INGESTION_SOURCE_REFRESH_NAMESPACE, refreshKey(record.workspaceId, record.refreshId), record, normalizeIngestionSourceRefreshRecord);
    },
    async recordSourceRefreshWithSnapshot(snapshotInput, refreshInput) {
      const snapshot = normalizeIngestionSourceSnapshot(snapshotInput);
      const refresh = normalizeIngestionSourceRefreshRecord(refreshInput);
      assertOrganizationScope(documents, snapshot.organizationId);
      assertOrganizationScope(documents, refresh.organizationId);
      if (refresh.outcome !== "changed" || refresh.currentSnapshotId !== snapshot.snapshotId || refresh.sourceId !== snapshot.sourceId || refresh.workspaceId !== snapshot.workspaceId || refresh.organizationId !== snapshot.organizationId) throw new Error("Changed source refreshes must commit their matching snapshot atomically.");
      const snapshotDocumentKey = snapshotKey(snapshot.workspaceId, snapshot.snapshotId);
      const refreshDocumentKey = refreshKey(refresh.workspaceId, refresh.refreshId);
      return documents.runInTransaction(async (transaction) => {
        const previous = await transaction.readDocument<IngestionSourceSnapshot>(INGESTION_SOURCE_SNAPSHOT_NAMESPACE, snapshotKey(refresh.workspaceId, refresh.previousSnapshotId!));
        if (!previous || normalizeIngestionSourceSnapshot(previous.value).sourceId !== refresh.sourceId) throw new Error("Changed source refreshes require their previous source snapshot.");
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
  if (previous.status === "cancelled" && !(previous.cleanupPending && next.status === "cancelled" && !next.cleanupPending)) throw new Error("Cancelled ingestion tasks are immutable after cleanup.");
  if (previous.status === "failed" && next.status !== "transferring" && next.status !== "failed") throw new Error("Failed ingestion tasks may only resume or retain failure state.");
  if (previous.createdAt !== next.createdAt || previous.checkpointExpiresAt !== next.checkpointExpiresAt || previous.kind !== next.kind || previous.files.length !== next.files.length) throw new Error("Ingestion task definition is immutable.");
  for (const before of previous.files) {
    const after = next.files.find((file) => file.fileId === before.fileId);
    if (!after || after.checkpointId !== before.checkpointId || after.fileName !== before.fileName || after.mediaType !== before.mediaType || after.totalBytes !== before.totalBytes || stableJson(after.providerSource) !== stableJson(before.providerSource) || stableJson(after.websiteSource) !== stableJson(before.websiteSource)) throw new Error("Ingestion task file definition is immutable.");
    if (after.acceptedBytes < before.acceptedBytes || after.nextChunkIndex < before.nextChunkIndex) throw new Error("Ingestion task progress must be monotonic.");
  }
}

function assertOrganizationScope(documents: StructuredDocumentStore, organizationId: string | undefined): void {
  if (documents.organizationId !== organizationId) throw new Error("Ingestion record organization must match the repository organization scope.");
}
function assertTaskSnapshotRelationship(task: IngestionTaskRecord, snapshot: IngestionSourceSnapshot): void {
  const matchesOutput = task.files.some((file) => file.output?.sourceId === snapshot.sourceId && file.output.sourceSnapshotId === snapshot.snapshotId);
  if (task.workspaceId !== snapshot.workspaceId || task.organizationId !== snapshot.organizationId || !matchesOutput) throw new Error("Ingestion task snapshot must match a finalized task output in the same scope.");
}
const taskKey = (workspaceId: WorkspaceId, taskId: string) => `${workspaceId}/${taskId}`;
const snapshotKey = (workspaceId: WorkspaceId, snapshotId: string) => `${workspaceId}/${snapshotId}`;
const refreshKey = (workspaceId: WorkspaceId, refreshId: string) => `${workspaceId}/${refreshId}`;
function listLimit(value: number): number { if (!Number.isSafeInteger(value) || value < 1 || value > INGESTION_TASK_LIST_LIMIT) throw new Error(`Ingestion list limit must be between 1 and ${INGESTION_TASK_LIST_LIMIT}.`); return value; }
function timestamp(value: string): string { const normalized = String(value).trim(); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized) || Number.isNaN(Date.parse(normalized))) throw new Error("Ingestion cleanup cutoff must be an ISO-8601 UTC timestamp."); return normalized; }
function stableJson(value: unknown): string { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; return `{${Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`; }
