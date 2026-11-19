import {HEADLESS_CONTRACT_VERSION, readHeadlessContextTaskValue, readHeadlessPlanStepRequest,
  readHeadlessPlanStepResult, type HeadlessPlanStepTarget} from "../../../../../modules/contracts/headless";
import {copyBoundedPassiveData, readStrictPassiveRecord} from "../../../../../modules/contracts/shared";

/** Correlate observed replies; this parser alone is never physical execution. */
export function readConfirmedFailedContextBuild(input: {
  target: HeadlessPlanStepTarget; started: unknown; terminal: unknown; replayed: unknown;
}): Readonly<{taskId: string}> | undefined {
  try {
    const target = readHeadlessPlanStepRequest({version: HEADLESS_CONTRACT_VERSION, operation: "plan.run-step", input: input.target}, input.target.hostIncarnationId);
    if (!target.ok) return;
    const exact = target.request.input, options = {allowLocalFileSave: false, allowContextRagGeneration: true};
    const started = readHeadlessPlanStepResult(input.started, exact, options);
    if (!started.ok || started.value.kind !== "started" || started.value.operation !== "context.generate-rag") return;
    const taskId = started.value.reference.taskId;
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(input.terminal), ["ok", "operation", "value"]);
    if (outer.ok !== true || outer.operation !== "context.task") return;
    const task = readHeadlessContextTaskValue(outer.value, {kind: "task", taskId});
    if (!task || task.state !== "failed" || task.review !== null || "query" in task) return;
    const replayed = readHeadlessPlanStepResult(input.replayed, exact, options);
    if (!replayed.ok || replayed.value.kind !== "replayed" || !("operation" in replayed.value) || replayed.value.operation !== "context.generate-rag"
      || replayed.value.reference.taskId !== taskId || replayed.value.expiresAt !== started.value.expiresAt) return;
    return Object.freeze({taskId});
  } catch {return;}
}
