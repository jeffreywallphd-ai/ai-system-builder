/** Private original-task controls. No Root, worker, generic task or Save owner. */
import {isDeepStrictEqual, types} from "node:util";
import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {readStructuredOwnedTrainingPlanTask, readStructuredOwnedTrainingPlanTaskByPlan,
  readStructuredOwnedTrainingPlanTaskProposalDigest, readStructuredTrainingPlanTaskLineage} from "../../../adapters/persistence/system-builder/createStructuredHeadlessTrainingPlanTaskStore";
import type {HeadlessOperationScope} from "../../../application/ports/system-builder";
import type {ApprovedLocalTrainingControl, ApprovedLocalTrainingTask} from "../../../application/ports/model";
import {isDesktopHeadlessClientId, isHeadlessHostIncarnationId, readHeadlessTrainingTaskRequest,
  readHeadlessTrainingTaskValue, type HeadlessTrainingTaskResult, type HeadlessTrainingTaskValue} from "../../../contracts/headless";
import {isWorkspaceId} from "../../../contracts/workspace";
import {isOrganizationId} from "../../../contracts/organization";
import {MODEL_TRAINING_STATUSES, type ModelTrainingStatus} from "../../../contracts/model";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import {isHeadlessReadCurrent} from "./headlessReadCurrent";
import {runPreparedHeadlessModelTraining, type RetainedHeadlessTrainingTask, type StartHeadlessModelTraining} from "./headlessModelTrainingExecution";

type Run = Parameters<typeof runPreparedHeadlessModelTraining>[0];
type Selection = RetainedHeadlessTrainingTask["selection"];
export type OriginalTrainingRunOptions = Omit<Run, "retainTask">;
export interface OriginalTrainingTaskQuery {
  readonly documents: StructuredDocumentStore;
  readonly hostIncarnationId: string;
  readonly scope: HeadlessOperationScope;
  readonly request: unknown;
  readonly isCurrent: () => boolean;
  readonly authorize: (owner: StructuredDocumentStore, scope: HeadlessOperationScope, action: "read" | "cancel") => Promise<boolean>;
}
interface Slot {
  readonly scope: HeadlessOperationScope;
  readonly selection: Selection;
  mayHaveStarted: boolean;
  expectedTaskId?: string;
  proposalDigest?: string;
  task?: ApprovedLocalTrainingTask;
  cancellationAttempted: boolean;
}
const forbidden = {ok: false, code: "headless.forbidden"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;
const unconfirmed = {ok: false, code: "headless.operation-unconfirmed"} as const;
const failed = () => new Error("The original approved training task is unavailable.");
function need(value: unknown): void {if (value !== true) throw failed();}
function record(raw: unknown, keys: readonly string[]) {if (types.isProxy(raw)) throw failed(); return readStrictPassiveRecord(raw, keys);}
function copy<T>(raw: T): T {return copyBoundedPassiveData(raw) as T;}
function capture<Fn extends (...args: any[]) => any>(owner: object, key: string): Fn {
  need(!!owner && !types.isProxy(owner));
  for (let at: object | null = owner, depth = 0; at && at !== Object.prototype && depth < 8; at = Object.getPrototypeOf(at), depth++) {
    need(!types.isProxy(at)); const descriptor = Object.getOwnPropertyDescriptor(at, key);
    if (!descriptor) continue;
    need("value" in descriptor && typeof descriptor.value === "function" && !types.isProxy(descriptor.value));
    const method = descriptor.value;
    return ((...args: unknown[]) => Reflect.apply(method, owner, args)) as Fn;
  }
  throw failed();
}
function scope(raw: unknown): HeadlessOperationScope {
  const value = record(copy(raw), ["organizationId", "principalId", "workspaceId", "registeredClientId"]);
  need(Object.keys(value).length === 4 && isOrganizationId(value.organizationId) && isWorkspaceId(value.workspaceId) &&
    isDesktopHeadlessClientId(value.registeredClientId) && typeof value.principalId === "string" && value.principalId.length > 0 &&
    value.principalId.length <= 160 && !/[\x00-\x1f\x7f]/.test(value.principalId) && !hasKnownPassiveCredential(value.principalId));
  return Object.freeze(value) as unknown as HeadlessOperationScope;
}
function key(owner: HeadlessOperationScope, host: string, fingerprint: string, step: number) {
  need(isHeadlessHostIncarnationId(host) && /^[a-f0-9]{64}$/.test(fingerprint) && Number.isSafeInteger(step) && step > 0);
  // Same point identity as the dedicated ledger; approval revisions cannot adopt
  // another accepted task/proposal for this original client and plan step.
  return JSON.stringify([owner.organizationId, owner.principalId, owner.workspaceId, owner.registeredClientId, host, fingerprint, step]);
}
function summarize(raw: unknown, taskId: string, owner: HeadlessOperationScope, plan: {fingerprint: string; step: number}): HeadlessTrainingTaskValue {
  const value = record(raw, ["runId", "status", "reviewPending", "progress", "outputDirectory", "outputModelName", "outputModel",
    "generatedModelCandidate", "metrics", "checkpoints", "logs", "validationReportPath", "warnings", "error"]);
  need(value.runId === taskId && MODEL_TRAINING_STATUSES.includes(value.status as ModelTrainingStatus));
  need(value.reviewPending === undefined || typeof value.reviewPending === "boolean");
  const progress = value.progress === undefined ? {} : record(value.progress, ["stage", "message", "epoch", "totalEpochs", "batch", "totalBatches"]);
  const number = (name: string): number | null => {
    const fact = progress[name]; if (fact === undefined) return null;
    need(Number.isSafeInteger(fact) && (fact as number) >= 0); return fact as number;
  };
  const facts = {epoch: number("epoch"), totalEpochs: number("totalEpochs"), batch: number("batch"), totalBatches: number("totalBatches")};
  need(facts.totalEpochs === null || facts.totalEpochs === 0 || facts.epoch === null || facts.epoch <= facts.totalEpochs);
  need(facts.totalBatches === null || facts.totalBatches === 0 || facts.batch === null || facts.batch <= facts.totalBatches);
  const percent = facts.batch !== null && facts.totalBatches !== null && facts.totalBatches > 0 ? facts.batch / facts.totalBatches * 100 : null;
  // Deliberately do not inspect or copy candidate fields, paths, errors, logs,
  // metadata, raw training material or metrics (including loss/accuracy).
  const candidate = value.generatedModelCandidate;
  const pending = value.status === "succeeded" && value.reviewPending === true && candidate !== null && typeof candidate === "object" && !types.isProxy(candidate);
  const summary = {workspaceId: owner.workspaceId, taskId, plan, state: value.status as ModelTrainingStatus, percent, progress: facts,
    resultReview: pending ? "pending" as const : "not-ready" as const, registration: "requires-separate-approval" as const,
    runtimeReadiness: "not-checked" as const, outputQuality: "not-evaluated" as const};
  need(!!readHeadlessTrainingTaskValue(summary)); return summary;
}

export function createOriginalHeadlessTrainingTaskOwner(options: {readonly maximumRetainedTasks?: number} = {}) {
  const configuration = record(copy(options), ["maximumRetainedTasks"]);
  const maximum = (configuration.maximumRetainedTasks ?? 256) as number;
  need(Number.isSafeInteger(maximum) && maximum >= 1 && maximum <= 256);
  const slots = new Map<string, Slot>();
  const runOriginal = runPreparedHeadlessModelTraining;

  async function runPrepared(raw: OriginalTrainingRunOptions): ReturnType<typeof runPreparedHeadlessModelTraining> {
    let originalSlot: Slot | undefined, slotKey: string | undefined;
    try {
      const fields = record(raw, ["prepared", "request", "context", "canUse", "isHostCurrent", "stillBusinessAllowed", "getReaders", "resolveStart"]);
      const prepared = fields.prepared as Run["prepared"];
      const metadata = record(prepared, ["kind", "request", "binding", "scope", "selection", "expiresAt", "isCurrent", "isStartCurrent", "stillAllowed",
        "inspect", "reserve", "issue", "accept", "recordNotStarted", "readReceipt", "publishIfCurrent"]);
      const originalScope = scope(metadata.scope), selection = Object.freeze(copy(metadata.selection)) as Selection;
      slotKey = key(originalScope, selection.hostIncarnationId, selection.fingerprint, selection.step);
      const inspect = capture<Run["prepared"]["inspect"]>(prepared, "inspect");
      const resolveStart = capture<Run["resolveStart"]>(raw, "resolveStart");
      const getReaders = capture<Run["getReaders"]>(raw, "getReaders");
      const canUse = capture<Run["canUse"]>(raw, "canUse");
      const isHostCurrent = capture<Run["isHostCurrent"]>(raw, "isHostCurrent");
      const stillBusinessAllowed = capture<Run["stillBusinessAllowed"]>(raw, "stillBusinessAllowed");
      const capturedRequest = copy(fields.request) as Run["request"], context = copy(fields.context) as Run["context"];
      const result = await runOriginal({prepared, request: capturedRequest, context, canUse, isHostCurrent, stillBusinessAllowed, getReaders,
        async resolveStart() {
          // The original runner calls this only for an absent admitted effect.
          // Reserve BEFORE the resolver's first await, not after the task ACK.
          if (slots.has(slotKey!) || slots.size >= maximum) return undefined;
          originalSlot = {scope: originalScope, selection, mayHaveStarted: false, cancellationAttempted: false};
          slots.set(slotKey!, originalSlot);
          const start = await resolveStart();
          if (typeof start !== "function" || types.isProxy(start)) return undefined;
          const capturedSlot = originalSlot;
          return (async (...args: Parameters<StartHeadlessModelTraining>) => {
            need(slots.get(slotKey!) === capturedSlot && !capturedSlot.mayHaveStarted);
            const admission = args[1]; need(!!admission && !types.isProxy(admission));
            const task = Object.getOwnPropertyDescriptor(admission, "requestId"), proposal = Object.getOwnPropertyDescriptor(admission, "proposalDigest");
            need(!!task && "value" in task && isHeadlessHostIncarnationId(task.value) && !!proposal && "value" in proposal &&
              typeof proposal.value === "string" && /^sha256:[a-f0-9]{64}$/.test(proposal.value));
            capturedSlot.expectedTaskId = task!.value; capturedSlot.proposalDigest = proposal!.value;
            capturedSlot.mayHaveStarted = true;
            return Reflect.apply(start, undefined, args) as ReturnType<StartHeadlessModelTraining>;
          }) as StartHeadlessModelTraining;
        },
        retainTask(value: RetainedHeadlessTrainingTask) {
          const slot = originalSlot;
          if (!slot || slots.get(slotKey!) !== slot || slot.task || !slot.mayHaveStarted) return false;
          const retained = record(value, ["scope", "selection", "proposalDigest", "task"]);
          if (!isDeepStrictEqual(copy(retained.scope), slot.scope) || !isDeepStrictEqual(copy(retained.selection), slot.selection) || retained.proposalDigest !== slot.proposalDigest) return false;
          const task = retained.task as ApprovedLocalTrainingTask;
          const identity = record(task, ["requestId", "workspaceId", "read", "cancel"]);
          if (identity.requestId !== slot.expectedTaskId || identity.workspaceId !== slot.scope.workspaceId) return false;
          // Custody only; never renew the ended outward caller's admission here.
          slot.task = Object.freeze({requestId: task.requestId, workspaceId: task.workspaceId,
            read: capture<ApprovedLocalTrainingTask["read"]>(task, "read"), cancel: capture<ApprovedLocalTrainingTask["cancel"]>(task, "cancel")});
          return true;
        },
      });
      if (originalSlot && !originalSlot.task && originalSlot.mayHaveStarted) {
        // Only the captured original metadata owner can prove known non-start.
        const observed = await inspect();
        if (observed?.kind === "not-started" && slots.get(slotKey) === originalSlot) slots.delete(slotKey);
      }
      return result;
    } catch {return {result: unconfirmed};}
    finally {
      // This only releases host metadata capacity. The trusted resolver cannot
      // itself start tasks/acquire native custody; this is NOT IO retirement.
      if (originalSlot && !originalSlot.mayHaveStarted && !originalSlot.task && slots.get(slotKey!) === originalSlot) slots.delete(slotKey!);
    }
  }

  async function control(raw: OriginalTrainingTaskQuery, action: "read" | "cancel"): Promise<HeadlessTrainingTaskResult> {
    let effectPossible = false;
    try {
      const fields = record(raw, ["documents", "hostIncarnationId", "scope", "request", "isCurrent", "authorize"]);
      const originalScope = scope(fields.scope), host = fields.hostIncarnationId;
      if (!isHeadlessHostIncarnationId(host)) return forbidden;
      const parsed = readHeadlessTrainingTaskRequest(fields.request, host);
      if (!parsed.ok) return parsed;
      if (parsed.request.input.workspaceId !== originalScope.workspaceId || parsed.request.operation !== (action === "read" ? "models.training-task" : "models.cancel-training")) return forbidden;
      const documents = fields.documents as StructuredDocumentStore;
      const currentMethod = capture<OriginalTrainingTaskQuery["isCurrent"]>(raw, "isCurrent");
      const authorize = capture<OriginalTrainingTaskQuery["authorize"]>(raw, "authorize");
      const current = () => isHeadlessReadCurrent(currentMethod);
      if (!current() || documents.organizationId !== undefined) return forbidden;
      const transaction = capture<NonNullable<StructuredDocumentStore["runInOwnedTransaction"]>>(documents, "runInOwnedTransaction");
      const selected = parsed.request.input.selection;
      const fence = () => need(current());
      const admit = () => transaction(async owner => {
        if (!current() || await authorize(owner, originalScope, action) !== true || !current()) return;
        const partition = owner.forOrganization(originalScope.organizationId);
        const reference = selected.kind === "task" ? await readStructuredOwnedTrainingPlanTask(partition, originalScope, host, selected.taskId)
          : await readStructuredOwnedTrainingPlanTaskByPlan(partition, originalScope, host, selected.fingerprint, selected.step);
        if (!reference || !current()) return;
        const proposalDigest = await readStructuredOwnedTrainingPlanTaskProposalDigest(partition, originalScope, host, reference.taskId);
        const lineage = await readStructuredTrainingPlanTaskLineage(partition, originalScope, host, reference.taskId);
        if (!proposalDigest || !lineage || !current() || lineage.proposalDigest !== proposalDigest ||
            (selected.kind === "plan-step" && (lineage.target.fingerprint !== selected.fingerprint || lineage.step !== selected.step))) return;
        return {reference, proposalDigest, plan: {fingerprint: lineage.target.fingerprint, step: lineage.step}};
      }, fence);
      const admitted = await admit(); if (!admitted || !current()) return forbidden;
      const originalKey = key(originalScope, host, admitted.plan.fingerprint, admitted.plan.step);
      const slot = slots.get(originalKey), task = slot?.task;
      if (!slot || !task || slot.expectedTaskId !== admitted.reference.taskId || slot.proposalDigest !== admitted.proposalDigest) return unavailable;
      const same = () => current() && slots.get(originalKey) === slot && slot.task === task;
      const fresh = async () => {const value = await admit(); return !!value && same() && isDeepStrictEqual(value, admitted);};
      const caller: ApprovedLocalTrainingControl = Object.freeze({isCurrent: same, stillAllowed: fresh});
      let result: unknown;
      if (action === "cancel") {
        if (slot.cancellationAttempted) return unconfirmed;
        slot.cancellationAttempted = true; effectPossible = true;
        result = await task.cancel(caller);
        // An ACK never releases this slot or establishes physical settlement.
      } else result = await task.read(caller);
      if (!await fresh() || !same()) return effectPossible ? unconfirmed : forbidden;
      const summary = summarize(result, task.requestId, originalScope, admitted.plan);
      if (!await fresh() || !same()) return effectPossible ? unconfirmed : forbidden;
      return action === "read" ? {ok: true, operation: "models.training-task", value: summary}
        : {ok: true, operation: "models.cancel-training", value: {...summary, cancellation: "requested-unconfirmed"}};
    } catch {return effectPossible ? unconfirmed : unavailable;}
  }
  return Object.freeze({runPrepared, read: (query: OriginalTrainingTaskQuery) => control(query, "read"),
    cancel: (query: OriginalTrainingTaskQuery) => control(query, "cancel")});
}
