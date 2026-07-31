import type {
  ExecutionApprovalRepositoryPort,
  ExecutionAttemptRepositoryPort,
  ExecutionCancellationRequestRepositoryPort,
  ExecutionEventRepositoryPort,
  ExecutionResultRepositoryPort,
  ExecutionRetryRequestRepositoryPort,
  ExecutionRunRepositoryPort,
  ExecutionRuntimeReferenceRepositoryPort,
} from "../../../application/ports/execution-runs";
import {
  normalizeExecutionApprovalRecord,
  normalizeExecutionAttemptRecord,
  normalizeExecutionCancellationRequestRecord,
  normalizeExecutionEventRecord,
  normalizeExecutionResultRecord,
  normalizeExecutionRetryRequestRecord,
  normalizeExecutionRunRecord,
  normalizeExecutionRuntimeReferenceRecord,
  type ExecutionApprovalRecord,
  type ExecutionAttemptRecord,
  type ExecutionCancellationRequestRecord,
  type ExecutionEventRecord,
  type ExecutionResultRecord,
  type ExecutionRetryRequestRecord,
  type ExecutionRunRecord,
  type ExecutionRuntimeReferenceRecord,
} from "../../../contracts/execution-runs";
import { pageRecords } from "../user-library/local-user-library-repository-helpers";
import { LocalExecutionRunRecordStore } from "./local-execution-run-record-store";
import type { StructuredDocumentStore } from "../shared";
type UpdatedRecord = { id: string; updatedAt?: string; createdAt?: string };
type CreatedRecord = { id: string; createdAt?: string; at?: string };
const byUpdated = (a: UpdatedRecord, b: UpdatedRecord) =>
  (b.updatedAt ?? b.createdAt ?? "").localeCompare(
    a.updatedAt ?? a.createdAt ?? "",
  ) || a.id.localeCompare(b.id);
const byCreated = (a: CreatedRecord, b: CreatedRecord) =>
  (a.createdAt ?? a.at ?? "").localeCompare(b.createdAt ?? b.at ?? "") ||
  a.id.localeCompare(b.id);
export function createLocalExecutionRunRepositoryAdapters(o: {
  rootDir: string;
  now?: () => string;
  documents?: StructuredDocumentStore;
}) {
  const s = new LocalExecutionRunRecordStore(o);
  const runs = async () =>
    (await s.readCollection<ExecutionRunRecord>("execution-runs.json")).map(
      normalizeExecutionRunRecord,
    );
  const attempts = async () =>
    (
      await s.readCollection<ExecutionAttemptRecord>("execution-attempts.json")
    ).map(normalizeExecutionAttemptRecord);
  const events = async () =>
    (await s.readCollection<ExecutionEventRecord>("execution-events.json")).map(
      normalizeExecutionEventRecord,
    );
  const results = async () =>
    (
      await s.readCollection<ExecutionResultRecord>("execution-results.json")
    ).map(normalizeExecutionResultRecord);
  const approvals = async () =>
    (
      await s.readCollection<ExecutionApprovalRecord>(
        "execution-approvals.json",
      )
    ).map(normalizeExecutionApprovalRecord);
  const cancels = async () =>
    (
      await s.readCollection<ExecutionCancellationRequestRecord>(
        "execution-cancellation-requests.json",
      )
    ).map(normalizeExecutionCancellationRequestRecord);
  const retries = async () =>
    (
      await s.readCollection<ExecutionRetryRequestRecord>(
        "execution-retry-requests.json",
      )
    ).map(normalizeExecutionRetryRequestRecord);
  const runtimes = async () =>
    (
      await s.readCollection<ExecutionRuntimeReferenceRecord>(
        "execution-runtime-references.json",
      )
    ).map(normalizeExecutionRuntimeReferenceRecord);
  const executionRunRepository: ExecutionRunRepositoryPort = {
    async saveExecutionRun(r) {
      const n = normalizeExecutionRunRecord(r);
      await s.mutateCollection<ExecutionRunRecord, void>(
        "execution-runs.json",
        (current) => ({
          records: [
            ...current
              .map(normalizeExecutionRunRecord)
              .filter(
                (x) => !(x.workspaceId === n.workspaceId && x.id === n.id),
              ),
            n,
          ].sort(byUpdated),
          result: undefined,
        }),
      );
      return n;
    },
    async updateExecutionRun(r) {
      return this.saveExecutionRun(r);
    },
    async getExecutionRunById(workspaceId, id) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await runs()).find(
        (x) => x.workspaceId === workspaceId && x.id === id,
      );
    },
    async listExecutionRuns(q) {
      if (!q.workspaceId) throw new Error("workspaceId is required.");
      const f = (await runs()).filter(
        (x) =>
          x.workspaceId === q.workspaceId &&
          (!q.status || x.status === q.status) &&
          (!q.sourceExecutionPlanId ||
            x.sourceExecutionPlanId === q.sourceExecutionPlanId),
      );
      const p = pageRecords(f.sort(byUpdated), q.limit, q.cursor);
      return { runs: p.records, nextCursor: p.nextCursor };
    },
    async listActiveExecutionRuns(workspaceId) {
      return (await this.listExecutionRuns({ workspaceId })).runs.filter((x) =>
        ["queued", "running", "awaiting-approval"].includes(x.status),
      );
    },
    async listRetryableExecutionRuns(workspaceId) {
      return (
        await this.listExecutionRuns({ workspaceId, status: "retryable" })
      ).runs;
    },
    async archiveExecutionRun(workspaceId, id, archivedAt) {
      const r = await this.getExecutionRunById(workspaceId, id);
      if (!r) return;
      return this.saveExecutionRun({
        ...r,
        archivedAt,
        updatedAt: archivedAt,
        status: "archived",
      });
    },
  };
  const executionAttemptRepository: ExecutionAttemptRepositoryPort = {
    async saveExecutionAttempt(r) {
      const n = normalizeExecutionAttemptRecord(r);
      await s.mutateCollection<ExecutionAttemptRecord, void>(
        "execution-attempts.json",
        (current) => ({
          records: [
            ...current
              .map(normalizeExecutionAttemptRecord)
              .filter(
                (x) => !(x.workspaceId === n.workspaceId && x.id === n.id),
              ),
            n,
          ].sort(
            (a, b) => a.attemptNumber - b.attemptNumber || byCreated(a, b),
          ),
          result: undefined,
        }),
      );
      return n;
    },
    async updateExecutionAttempt(r) {
      return this.saveExecutionAttempt(r);
    },
    async getExecutionAttemptById(workspaceId, id) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await attempts()).find(
        (x) => x.workspaceId === workspaceId && x.id === id,
      );
    },
    async listExecutionAttemptsByRun(workspaceId, runId, status) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await attempts())
        .filter(
          (x) =>
            x.workspaceId === workspaceId &&
            x.executionRunId === runId &&
            (!status || x.status === status),
        )
        .sort((a, b) => a.attemptNumber - b.attemptNumber || byCreated(a, b));
    },
    async getLatestExecutionAttemptForRun(workspaceId, runId) {
      const xs = await this.listExecutionAttemptsByRun(workspaceId, runId);
      return xs[xs.length - 1];
    },
  };
  const executionEventRepository: ExecutionEventRepositoryPort = {
    async appendExecutionEvent(r) {
      const n = normalizeExecutionEventRecord(r);
      await s.mutateCollection<ExecutionEventRecord, void>(
        "execution-events.json",
        (current) => ({
          records: [
            ...current
              .map(normalizeExecutionEventRecord)
              .filter(
                (x) => !(x.workspaceId === n.workspaceId && x.id === n.id),
              ),
            n,
          ].sort(
            (a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id),
          ),
          result: undefined,
        }),
      );
      return n;
    },
    async getExecutionEventById(workspaceId, id) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await events()).find(
        (x) => x.workspaceId === workspaceId && x.id === id,
      );
    },
    async listExecutionEventsByRun(workspaceId, runId, limit, cursor) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      const p = pageRecords(
        (await events())
          .filter(
            (x) => x.workspaceId === workspaceId && x.executionRunId === runId,
          )
          .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)),
        limit,
        cursor,
      );
      return { events: p.records, nextCursor: p.nextCursor };
    },
    async listExecutionEventsByAttempt(workspaceId, attemptId) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await events())
        .filter(
          (x) =>
            x.workspaceId === workspaceId && x.executionAttemptId === attemptId,
        )
        .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    },
  };
  const executionResultRepository: ExecutionResultRepositoryPort = {
    async saveExecutionResult(r) {
      const n = normalizeExecutionResultRecord(r);
      await s.mutateCollection<ExecutionResultRecord, void>(
        "execution-results.json",
        (current) => ({
          records: [
            ...current
              .map(normalizeExecutionResultRecord)
              .filter(
                (x) => !(x.workspaceId === n.workspaceId && x.id === n.id),
              ),
            n,
          ].sort(byCreated),
          result: undefined,
        }),
      );
      return n;
    },
    async updateExecutionResult(r) {
      return this.saveExecutionResult(r);
    },
    async getExecutionResultById(workspaceId, id) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await results()).find(
        (x) => x.workspaceId === workspaceId && x.id === id,
      );
    },
    async listExecutionResultsByRun(workspaceId, runId) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await results())
        .filter(
          (x) => x.workspaceId === workspaceId && x.executionRunId === runId,
        )
        .sort(byCreated);
    },
    async getLatestExecutionResultForRun(workspaceId, runId) {
      const xs = await this.listExecutionResultsByRun(workspaceId, runId);
      return xs[xs.length - 1];
    },
  };
  const executionApprovalRepository: ExecutionApprovalRepositoryPort = {
    async saveExecutionApproval(r) {
      const n = normalizeExecutionApprovalRecord(r);
      await s.mutateCollection<ExecutionApprovalRecord, void>(
        "execution-approvals.json",
        (current) => ({
          records: [
            ...current
              .map(normalizeExecutionApprovalRecord)
              .filter(
                (x) => !(x.workspaceId === n.workspaceId && x.id === n.id),
              ),
            n,
          ].sort(byUpdated),
          result: undefined,
        }),
      );
      return n;
    },
    async updateExecutionApproval(r) {
      return this.saveExecutionApproval(r);
    },
    async getExecutionApprovalById(workspaceId, id) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await approvals()).find(
        (x) => x.workspaceId === workspaceId && x.id === id,
      );
    },
    async listExecutionApprovals(workspaceId, planId, runId, sessionId) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await approvals())
        .filter(
          (x) =>
            x.workspaceId === workspaceId &&
            (!planId || x.sourceExecutionPlanId === planId) &&
            (!runId || x.executionRunId === runId) &&
            (!sessionId || x.conversationSessionId === sessionId),
        )
        .sort(byUpdated);
    },
  };
  const executionCancellationRequestRepository: ExecutionCancellationRequestRepositoryPort =
    {
      async saveExecutionCancellationRequest(r) {
        const n = normalizeExecutionCancellationRequestRecord(r);
        await s.mutateCollection<ExecutionCancellationRequestRecord, void>(
          "execution-cancellation-requests.json",
          (current) => ({
            records: [
              ...current
                .map(normalizeExecutionCancellationRequestRecord)
                .filter(
                  (x) => !(x.workspaceId === n.workspaceId && x.id === n.id),
                ),
              n,
            ].sort(byCreated),
            result: undefined,
          }),
        );
        return n;
      },
      async getExecutionCancellationRequestById(workspaceId, id) {
        if (!workspaceId) throw new Error("workspaceId is required.");
        return (await cancels()).find(
          (x) => x.workspaceId === workspaceId && x.id === id,
        );
      },
      async listExecutionCancellationRequestsByRun(workspaceId, runId) {
        if (!workspaceId) throw new Error("workspaceId is required.");
        return (await cancels())
          .filter(
            (x) => x.workspaceId === workspaceId && x.executionRunId === runId,
          )
          .sort(byCreated);
      },
    };
  const executionRetryRequestRepository: ExecutionRetryRequestRepositoryPort = {
    async saveExecutionRetryRequest(r) {
      const n = normalizeExecutionRetryRequestRecord(r);
      await s.mutateCollection<ExecutionRetryRequestRecord, void>(
        "execution-retry-requests.json",
        (current) => ({
          records: [
            ...current
              .map(normalizeExecutionRetryRequestRecord)
              .filter(
                (x) => !(x.workspaceId === n.workspaceId && x.id === n.id),
              ),
            n,
          ].sort(byCreated),
          result: undefined,
        }),
      );
      return n;
    },
    async getExecutionRetryRequestById(workspaceId, id) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await retries()).find(
        (x) => x.workspaceId === workspaceId && x.id === id,
      );
    },
    async listExecutionRetryRequestsByRun(workspaceId, runId) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await retries())
        .filter(
          (x) =>
            x.workspaceId === workspaceId && x.originalExecutionRunId === runId,
        )
        .sort(byCreated);
    },
  };
  const executionRuntimeReferenceRepository: ExecutionRuntimeReferenceRepositoryPort =
    {
      async saveExecutionRuntimeReference(r) {
        const n = normalizeExecutionRuntimeReferenceRecord(r);
        await s.mutateCollection<ExecutionRuntimeReferenceRecord, void>(
          "execution-runtime-references.json",
          (current) => ({
            records: [
              ...current
                .map(normalizeExecutionRuntimeReferenceRecord)
                .filter(
                  (x) => !(x.workspaceId === n.workspaceId && x.id === n.id),
                ),
              n,
            ].sort((a, b) => a.id.localeCompare(b.id)),
            result: undefined,
          }),
        );
        return n;
      },
      async getExecutionRuntimeReferenceById(workspaceId, id) {
        if (!workspaceId) throw new Error("workspaceId is required.");
        return (await runtimes()).find(
          (x) => x.workspaceId === workspaceId && x.id === id,
        );
      },
      async listExecutionRuntimeReferences(workspaceId) {
        if (!workspaceId) throw new Error("workspaceId is required.");
        return (await runtimes())
          .filter((x) => x.workspaceId === workspaceId)
          .sort((a, b) => a.id.localeCompare(b.id));
      },
    };
  return {
    executionRunRepository,
    executionAttemptRepository,
    executionEventRepository,
    executionResultRepository,
    executionApprovalRepository,
    executionCancellationRequestRepository,
    executionRetryRequestRepository,
    executionRuntimeReferenceRepository,
  };
}
