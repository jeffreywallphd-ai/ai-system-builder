import type { ExecutionPlanProvenanceEntry } from "../../../contracts/execution-plans";

export const createExecutionPlanProvenanceEvent = (kind: ExecutionPlanProvenanceEntry["kind"], at: string, refs: Omit<ExecutionPlanProvenanceEntry, "kind" | "at">): ExecutionPlanProvenanceEntry => ({ kind, at, ...refs });
