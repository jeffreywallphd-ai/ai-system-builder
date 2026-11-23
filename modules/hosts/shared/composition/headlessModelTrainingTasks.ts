/** Private original-task controls. No Root, worker, generic task or Save owner. */
import {isDeepStrictEqual, types} from "node:util";
import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {readStructuredOwnedTrainingPlanTask, readStructuredOwnedTrainingPlanTaskByPlan,
  readStructuredOwnedTrainingPlanTaskProposalDigest, readStructuredTrainingPlanTaskLineage} from "../../../adapters/persistence/system-builder/createStructuredHeadlessTrainingPlanTaskStore";
import type {HeadlessOperationScope} from "../../../application/ports/system-builder";
import type {ApprovedLocalTrainingControl, ApprovedLocalTrainingTask, ApprovedLocalTrainingCompletionReview} from "../../../application/ports/model";
import {isDesktopHeadlessClientId, isHeadlessHostIncarnationId, readHeadlessTrainingTaskRequest,
  readHeadlessTrainingTaskValue, isHeadlessModelRecordId, isHeadlessModelTimestamp,
  readHeadlessTrainingCompletionRequest, readHeadlessTrainingCompletionResult, type HeadlessTrainingCompletionResult,
  type HeadlessTrainingTaskResult, type HeadlessTrainingTaskValue, type HeadlessTrainingTaskReadRequest} from "../../../contracts/headless";
import {isWorkspaceId} from "../../../contracts/workspace";
import {isOrganizationId} from "../../../contracts/organization";
import {MODEL_TRAINING_STATUSES, MODEL_TRAINING_METHODS, type ModelTrainingStatus} from "../../../contracts/model";
import {DATASET_PREPARATION_TASK_TYPES} from "../../../contracts/runtime";
import {normalizeDatasetId, normalizeDatasetVersionId, normalizeDatasetVersionDigest} from "../../../contracts/dataset";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import {isHeadlessReadCurrent} from "./headlessReadCurrent";
import {copyHeadlessModelPlanData} from "./headlessModelDownloadReview";
import {runPreparedHeadlessModelTraining, type RetainedHeadlessTrainingTask, type StartHeadlessModelTraining} from "./headlessModelTrainingExecution";

type Run = Parameters<typeof runPreparedHeadlessModelTraining>[0];
type Selection = RetainedHeadlessTrainingTask["selection"];
export type OriginalTrainingRunOptions = Omit<Run, "retainTask">;
/** Trusted original-task callback, captured by read composition before waits.
 * No factory/setup fallback; its reply still needs independent closed decoding.
 * The original owner can observe existing work and retire its owned lifecycle. */
export type OwnedHeadlessTrainingTaskReader = (query: {readonly scope: HeadlessOperationScope;
  readonly selection: HeadlessTrainingTaskReadRequest["input"]["selection"];
  readonly isCurrent: () => boolean}) => Promise<unknown>;
/** Only the captured original completion cache; no task observation or fallback. */
export type OwnedHeadlessTrainingCompletionReader = OwnedHeadlessTrainingTaskReader;
export interface OriginalTrainingTaskQuery {
  readonly documents: StructuredDocumentStore;
  readonly hostIncarnationId: string;
  readonly scope: HeadlessOperationScope;
  readonly request: unknown;
  readonly isCurrent: () => boolean;
  readonly authorize: (owner: StructuredDocumentStore, scope: HeadlessOperationScope, action: "read" | "cancel") => Promise<boolean>;
}
/** Internal host result only. This is not a public tool/transport response. */
export type OriginalTrainingCompletionQueryResult = {readonly ok: true; readonly value: ApprovedLocalTrainingCompletionReview} |
  Extract<HeadlessTrainingTaskResult, {ok: false}>;
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
function optionalCompletion(owner: ApprovedLocalTrainingTask): ApprovedLocalTrainingTask["reviewCompletion"] {
  for (let at: object | null = owner, depth = 0; at && at !== Object.prototype && depth < 8; at = Object.getPrototypeOf(at), depth++) {
    need(!types.isProxy(at));
    if (Object.getOwnPropertyDescriptor(at, "reviewCompletion"))
      return capture<NonNullable<ApprovedLocalTrainingTask["reviewCompletion"]>>(owner, "reviewCompletion");
  }
  return undefined;
}
function completion(raw: unknown, taskId: string, workspaceId: string, proposalDigest: string): ApprovedLocalTrainingCompletionReview {
  const full = (value: unknown, fields: readonly string[]) => {
    const result = record(value, fields); need(Object.keys(result).length === fields.length); return result;
  };
  const row = record(raw, ["kind", "requestId", "workspaceId", "provenance", "candidate", "comparison", "verification", "registration"]);
  if (row.kind === "not-ready") {need(Object.keys(row).length === 1); return {kind: "not-ready"};}
  need(row.kind === "ready" && Object.keys(row).length === 8 && row.requestId === taskId && row.workspaceId === workspaceId &&
    row.registration === "requires-separate-approval");
  const provenance = full(row.provenance, ["modelRecordId", "modelUpdatedAt", "datasetId", "versionId", "versionDigest", "recipeDigest", "proposalDigest",
    "trainingTask", "method", "trainingInputCount", "validationInputCount", "inputBytes", "recipeBytes"]);
  need(isHeadlessModelRecordId(provenance.modelRecordId) && isHeadlessModelTimestamp(provenance.modelUpdatedAt) &&
    typeof provenance.datasetId === "string" && normalizeDatasetId(provenance.datasetId) === provenance.datasetId &&
    typeof provenance.versionId === "string" && normalizeDatasetVersionId(provenance.versionId) === provenance.versionId &&
    typeof provenance.versionDigest === "string" && normalizeDatasetVersionDigest(provenance.versionDigest) === provenance.versionDigest && provenance.proposalDigest === proposalDigest &&
    typeof provenance.recipeDigest === "string" && /^sha256:[a-f0-9]{64}$/.test(provenance.recipeDigest) &&
    MODEL_TRAINING_METHODS.includes(provenance.method as never) && DATASET_PREPARATION_TASK_TYPES.includes(provenance.trainingTask as never));
  const integer = (value: unknown, minimum: number, maximum: number): value is number => Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
  need(integer(provenance.trainingInputCount, 1, 16) && integer(provenance.validationInputCount, 0, 16) &&
    provenance.trainingInputCount + provenance.validationInputCount <= 16 && integer(provenance.inputBytes, 1, 256 * 1024 ** 2) &&
    integer(provenance.recipeBytes, 1, 512 * 1024) && provenance.inputBytes + provenance.recipeBytes <= 256 * 1024 ** 2);
  const candidate = full(row.candidate, ["requestedName", "artifactForm", "serializationFormat", "recordedSizeBytes"]);
  need([provenance.modelRecordId, provenance.datasetId, provenance.versionId, candidate.requestedName]
    .every(value => typeof value === "string" && !hasKnownPassiveCredential(value)));
  need(typeof candidate.requestedName === "string" && candidate.requestedName.length > 0 && candidate.requestedName.length <= 200 &&
    !/[\x00-\x1f\x7f]/.test(candidate.requestedName) &&
    [null, "adapter", "merged-model", "full-model", "checkpoint"].includes(candidate.artifactForm as never) &&
    [null, "safetensors", "sharded-safetensors", "adapter-safetensors"].includes(candidate.serializationFormat as never) &&
    (candidate.recordedSizeBytes === null || integer(candidate.recordedSizeBytes, 0, Number.MAX_SAFE_INTEGER)));
  const comparison = record(row.comparison, ["state", "report"]);
  if (comparison.state === "not-recorded") need(Object.keys(comparison).length === 1);
  else {
    need(comparison.state === "recorded" && Object.keys(comparison).length === 2);
    const report = full(comparison.report, ["protocol", "maximumRows", "sampleCount", "baselineLoss", "trainedLoss", "lossDelta", "interpretation"]);
    const loss = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
    need(report.protocol === "fixed-first-32-validation-loss-v1" && report.maximumRows === 32 && integer(report.sampleCount, 1, 32) &&
      loss(report.baselineLoss) && loss(report.trainedLoss) && typeof report.lossDelta === "number" && Number.isFinite(report.lossDelta) &&
      report.lossDelta === report.trainedLoss - report.baselineLoss && report.interpretation === "measurement-only");
  }
  const verification = full(row.verification, ["inputs", "retainedFiles", "runtimeReadiness", "hardware", "outputQuality"]);
  need(verification.inputs === "recorded-not-rechecked" && verification.retainedFiles === "not-checked" && verification.runtimeReadiness === "not-checked" &&
    verification.hardware === "not-recorded" && verification.outputQuality === "not-evaluated");
  return row as unknown as ApprovedLocalTrainingCompletionReview;
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
          const identity = record(task, ["requestId", "workspaceId", "read", "cancel", "reviewCompletion"]);
          if (identity.requestId !== slot.expectedTaskId || identity.workspaceId !== slot.scope.workspaceId) return false;
          // Custody only; never renew the ended outward caller's admission here.
          const reviewCompletion = optionalCompletion(task);
          slot.task = Object.freeze({requestId: task.requestId, workspaceId: task.workspaceId,
            read: capture<ApprovedLocalTrainingTask["read"]>(task, "read"), cancel: capture<ApprovedLocalTrainingTask["cancel"]>(task, "cancel"),
            ...(reviewCompletion ? {reviewCompletion} : {})});
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

  function control(raw: OriginalTrainingTaskQuery, action: "review"): Promise<OriginalTrainingCompletionQueryResult>;
  function control(raw: OriginalTrainingTaskQuery, action: "read-completion"): Promise<HeadlessTrainingCompletionResult>;
  function control(raw: OriginalTrainingTaskQuery, action: "read" | "cancel"): Promise<HeadlessTrainingTaskResult>;
  async function control(raw: OriginalTrainingTaskQuery, action: "read" | "cancel" | "review" | "read-completion"): Promise<HeadlessTrainingTaskResult | OriginalTrainingCompletionQueryResult | HeadlessTrainingCompletionResult> {
    let effectPossible = false;
    try {
      const fields = record(raw, ["documents", "hostIncarnationId", "scope", "request", "isCurrent", "authorize"]);
      const originalScope = scope(fields.scope), host = fields.hostIncarnationId;
      if (!isHeadlessHostIncarnationId(host)) return forbidden;
      const parsed = action === "read-completion" ? readHeadlessTrainingCompletionRequest(fields.request, host)
        : readHeadlessTrainingTaskRequest(fields.request, host);
      if (!parsed.ok) return parsed;
      if (parsed.request.input.workspaceId !== originalScope.workspaceId || parsed.request.operation !== (action === "cancel" ? "models.cancel-training" : action === "read-completion" ? "models.review-training" : "models.training-task")) return forbidden;
      const documents = fields.documents as StructuredDocumentStore;
      const currentMethod = capture<OriginalTrainingTaskQuery["isCurrent"]>(raw, "isCurrent");
      const authorize = capture<OriginalTrainingTaskQuery["authorize"]>(raw, "authorize");
      const current = () => isHeadlessReadCurrent(currentMethod);
      if (!current() || documents.organizationId !== undefined) return forbidden;
      const transaction = capture<NonNullable<StructuredDocumentStore["runInOwnedTransaction"]>>(documents, "runInOwnedTransaction");
      const selected = parsed.request.input.selection;
      const fence = () => need(current());
      const admit = () => transaction(async owner => {
        if (!current() || await authorize(owner, originalScope, action === "cancel" ? "cancel" : "read") !== true || !current()) return;
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
      if (action === "review" || action === "read-completion") {
        if (!task.reviewCompletion) return unavailable; // No ordinary read or runtime fallback.
        const owned = copyHeadlessModelPlanData(await task.reviewCompletion(caller)); // Reject proxies; own reply BEFORE policy waits.
        if (!await fresh() || !same()) return forbidden;
        const value = completion(owned, task.requestId, originalScope.workspaceId, admitted.proposalDigest);
        if (!await fresh() || !same()) return forbidden;
        if (action === "review") return {ok: true, value};
        if (value.kind === "not-ready") return {ok: false, code: "headless.source-not-ready"};
        const {kind: _kind, requestId: _requestId, ...history} = value;
        // The accepted ledger supplies plan/task identity. Never use caller data
        // to fill a missing cache or poll/settle the original runtime here.
        return readHeadlessTrainingCompletionResult({ok: true, operation: "models.review-training",
          value: {...history, taskId: task.requestId, plan: admitted.plan}}, parsed.request.input);
      }
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
    cancel: (query: OriginalTrainingTaskQuery) => control(query, "cancel"),
    readCompletion: (query: OriginalTrainingTaskQuery) => control(query, "read-completion"),
    reviewCompletion: (query: OriginalTrainingTaskQuery) => control(query, "review")});
}
