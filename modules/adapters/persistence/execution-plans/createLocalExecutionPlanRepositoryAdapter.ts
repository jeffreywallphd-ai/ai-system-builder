import { createWorkspaceId } from "../../../contracts/workspace";
import {
  normalizeExecutionPlanId,
  normalizeExecutionPlanRecord,
  type ExecutionPlanRecord,
} from "../../../contracts/execution-plans";
import type {
  ExecutionPlanListQuery,
  ExecutionPlanRepositoryPort,
} from "../../../application/ports/execution-plans";
import {
  LocalExecutionPlanRecordStore,
  type LocalExecutionPlanRecordStoreOptions,
  cloneJson,
} from "./local-execution-plan-record-store";

const MAX_LIMIT = 200;
export function createLocalExecutionPlanRepositoryAdapter(
  options: LocalExecutionPlanRecordStoreOptions,
): ExecutionPlanRepositoryPort {
  const store = new LocalExecutionPlanRecordStore(options);
  return {
    async saveExecutionPlan(plan) {
      const normalized = normalizeExecutionPlanRecord(plan);
      await store.mutatePlans((plans) => ({
        records: upsert(plans, normalized),
        result: undefined,
      }));
      return cloneJson(normalized);
    },
    async updateExecutionPlan(plan) {
      const normalized = normalizeExecutionPlanRecord(plan);
      await store.mutatePlans((plans) => ({
        records: upsert(plans, normalized),
        result: undefined,
      }));
      return cloneJson(normalized);
    },
    async getExecutionPlanById(workspaceId, executionPlanId) {
      const ws = requireWorkspace(workspaceId);
      const id = normalizeExecutionPlanId(executionPlanId);
      const record = (await store.readPlans()).find(
        (p) => p.workspaceId === ws && p.id === id,
      );
      return record ? cloneJson(record) : undefined;
    },
    async listExecutionPlans(query) {
      const normalizedQuery = {
        ...query,
        workspaceId: requireWorkspace(query.workspaceId),
        ...(query.sourceRuntimeReadinessBindingId
          ? {
              sourceRuntimeReadinessBindingId:
                query.sourceRuntimeReadinessBindingId.trim(),
            }
          : {}),
        ...(query.sourceCompositionPlanId
          ? { sourceCompositionPlanId: query.sourceCompositionPlanId.trim() }
          : {}),
        ...(query.text ? { text: query.text.trim() } : {}),
      };
      const ordered = (await store.readPlans())
        .filter((p) => matches(p, normalizedQuery))
        .sort(
          (a, b) =>
            b.updatedAt.localeCompare(a.updatedAt) ||
            b.createdAt.localeCompare(a.createdAt) ||
            a.id.localeCompare(b.id),
        );
      const start = query.cursor ? Number.parseInt(query.cursor, 10) : 0;
      if (Number.isNaN(start) || start < 0)
        throw new Error("Execution plan cursor is invalid.");
      const limit = Math.min(Math.max(query.limit ?? 50, 1), MAX_LIMIT);
      const page = ordered.slice(start, start + limit);
      const nextCursor =
        start + limit < ordered.length ? String(start + limit) : undefined;
      return { plans: cloneJson(page), nextCursor };
    },
    async archiveExecutionPlan(workspaceId, executionPlanId, archivedAt) {
      const ws = requireWorkspace(workspaceId);
      const id = normalizeExecutionPlanId(executionPlanId);
      const archived = await store.mutatePlans<ExecutionPlanRecord | undefined>(
        (plans) => {
          const i = plans.findIndex((p) => p.workspaceId === ws && p.id === id);
          if (i < 0) return { records: plans, result: undefined };
          const next: ExecutionPlanRecord = normalizeExecutionPlanRecord({
            ...plans[i],
            status: "archived",
            archivedAt,
            updatedAt: archivedAt,
          });
          const copy = [...plans];
          copy[i] = next;
          return { records: copy, result: next };
        },
      );
      return archived ? cloneJson(archived) : undefined;
    },
  };
}
const upsert = (
  plans: readonly ExecutionPlanRecord[],
  plan: ExecutionPlanRecord,
) => {
  const i = plans.findIndex(
    (p) => p.workspaceId === plan.workspaceId && p.id === plan.id,
  );
  if (i < 0) return [...plans, plan];
  const c = [...plans];
  c[i] = plan;
  return c;
};
const requireWorkspace = (w: string) => createWorkspaceId(w);
function matches(p: ExecutionPlanRecord, q: ExecutionPlanListQuery): boolean {
  if (p.workspaceId !== q.workspaceId) return false;
  if (q.status && p.status !== q.status) return false;
  if (
    q.sourceRuntimeReadinessBindingId &&
    p.sourceRuntimeReadinessBindingId !== q.sourceRuntimeReadinessBindingId
  )
    return false;
  if (
    q.sourceCompositionPlanId &&
    p.sourceCompositionPlanId !== q.sourceCompositionPlanId
  )
    return false;
  if (q.stepKind && !p.steps.some((s) => s.kind === q.stepKind)) return false;
  if (q.stepStatus && !p.steps.some((s) => s.status === q.stepStatus))
    return false;
  if (
    q.adapterReferenceKind &&
    !p.adapterReferences.some((a) => a.kind === q.adapterReferenceKind)
  )
    return false;
  if (
    q.safetyGateStatus &&
    !p.safetyGates.some((g) => g.status === q.safetyGateStatus)
  )
    return false;
  if (
    q.archived !== undefined &&
    (q.archived ? p.status !== "archived" : p.status === "archived")
  )
    return false;
  if (q.text) {
    const t = q.text.toLowerCase();
    const hay = [
      ...p.steps.map((s) => s.label ?? ""),
      ...p.steps.map((s) => s.summary ?? ""),
      ...p.inputs.map((i) => i.label ?? ""),
      ...p.outputs.map((o) => o.label ?? ""),
      ...p.adapterReferences.map((a) => a.label ?? ""),
      ...p.safetyGates.map((g) => g.label ?? ""),
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(t)) return false;
  }
  return true;
}
