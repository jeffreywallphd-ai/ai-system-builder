import { createStructuredSystemBuilderRepository } from "../../../adapters/persistence/system-builder";
import type { prepareStructuredHeadlessPlanStep } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import type { HeadlessPlanReviewSnapshotResult } from "../../../application/ports/system-builder/headless-build-plan-review.port";
import type { GovernedIngestionTaskUseCases } from "../../../application/use-cases/ingestion-acquisition/governed-ingestion-tasks.use-case";
import { PrepareHeadlessDatasetInputsUseCase } from "../../../application/use-cases/ingestion-acquisition/headless-dataset-preparation.use-case";
import type { PrepareTrainingDatasetFromArtifactsUseCase } from "../../../application/use-cases/prepare-training-dataset-from-artifacts.use-case";
import type { ApplicationRequestContext } from "../../../application/ports";
import type {PreparedLocalDatasetResultInputs} from "../../../application/ports/dataset-version";
import type {HeadlessOperationScope} from "../../../application/ports/system-builder";
import {ReadHeadlessDatasetTaskStatusUseCase} from "../../../application/use-cases/ingestion-acquisition/headless-dataset-task-status.use-case";
import {ReadHeadlessDatasetTaskReviewUseCase} from "../../../application/use-cases/ingestion-acquisition/headless-dataset-task-review.use-case";
import type {HeadlessDatasetTaskStatusRequest} from "../../../contracts/headless";
import {readStructuredOwnedDatasetPlanTask, readStructuredOwnedDatasetPlanTaskByPlan,
  readStructuredOwnedDatasetPlanTaskSourceDigest} from "../../../adapters/persistence/ingestion/createStructuredHeadlessDatasetPlanTaskStore";
import { readHeadlessPlanStepResult, type HeadlessBuildPlanRequest, type HeadlessLocalFileSavePlanRequest,
  type HeadlessProviderFileSavePlanRequest, type HeadlessLocalDatasetPlanRequest, type HeadlessContextGenerationPlanRequest,
  type HeadlessPlanReviewAgentResult, type HeadlessPlanStepRequest, type HeadlessDatasetResultSavePlanRequest,
  readHeadlessDatasetTaskReviewValue } from "../../../contracts/headless";
import type { WorkspaceId } from "../../../contracts/workspace";
import type {HeadlessContextResultSavePlanRequest} from "../../../contracts/headless";
import { composeIngestionAcquisitionRepository } from "./composeIngestionAcquisitionRepository";

type PreparedLocalFileStep = Extract<NonNullable<Awaited<ReturnType<typeof prepareStructuredHeadlessPlanStep>>>, { kind: "local-file" }>;
type FinalizeApprovedLocalFile = GovernedIngestionTaskUseCases["finalizeApprovedLocalFile"];
type PreparedProviderFileStep = Extract<NonNullable<Awaited<ReturnType<typeof prepareStructuredHeadlessPlanStep>>>, { kind: "provider-file" }>;
type FinalizeApprovedProviderFile = GovernedIngestionTaskUseCases["finalizeApprovedProviderFile"];
type PreparedDatasetStep = Extract<NonNullable<Awaited<ReturnType<typeof prepareStructuredHeadlessPlanStep>>>, { kind: "local-dataset" }>;
type PreparedDatasetResultStep = Extract<NonNullable<Awaited<ReturnType<typeof prepareStructuredHeadlessPlanStep>>>, { kind: "dataset-result" }>;
export type StartHeadlessDataset = PrepareTrainingDatasetFromArtifactsUseCase["startAdmittedLocalProvidedDataset"];
export type HeadlessDatasetResultOwner = Pick<PrepareTrainingDatasetFromArtifactsUseCase,
  "peekAdmittedLocalDatasetReview" | "saveAdmittedLocalProvidedDataset">;

function acceptedDatasetTaskLookup(documents: StructuredDocumentStore) {
  if (documents.organizationId !== undefined || !documents.runInOwnedTransaction)
    throw new Error("Dataset task status requires the platform owner.");
  return async (request: Pick<HeadlessDatasetTaskStatusRequest, "input">, context: ApplicationRequestContext, registeredClientId: string) => {
    if (!context.organizationId || !context.principalId || context.workspaceId !== request.input.workspaceId) return;
    const scope = {organizationId: context.organizationId, principalId: context.principalId, registeredClientId,
      workspaceId: request.input.workspaceId};
    const {hostIncarnationId, selection} = request.input;
    const receipt = await documents.runInOwnedTransaction!(async owner => {
      const partition = owner.forOrganization(scope.organizationId);
      return selection.kind === "task"
        ? readStructuredOwnedDatasetPlanTask(partition, scope, hostIncarnationId, selection.taskId)
        : readStructuredOwnedDatasetPlanTaskByPlan(partition, scope, hostIncarnationId, selection.fingerprint, selection.step);
    }, () => {});
    return receipt?.taskId;
  };
}

export function composeHeadlessDatasetTaskStatus(documents: StructuredDocumentStore,
  getProcessor: () => Promise<Pick<PrepareTrainingDatasetFromArtifactsUseCase, "readAdmittedLocalDatasetStatus">>) {
  return new ReadHeadlessDatasetTaskStatusUseCase(acceptedDatasetTaskLookup(documents),
    async (taskId, context) => (await getProcessor()).readAdmittedLocalDatasetStatus(taskId, context));
}

export function composeHeadlessDatasetTaskReview(documents: StructuredDocumentStore,
  getProcessor: () => Promise<Pick<PrepareTrainingDatasetFromArtifactsUseCase, "readAdmittedLocalDatasetStatus" | "peekAdmittedLocalDatasetReview">>) {
  return new ReadHeadlessDatasetTaskReviewUseCase(acceptedDatasetTaskLookup(documents), async (taskId, context) => {
    const processor = await getProcessor();
    const existing = processor.peekAdmittedLocalDatasetReview(taskId, context);
    if (existing) return {taskId, state: "review-required", review: existing};
    const status = await processor.readAdmittedLocalDatasetStatus(taskId, context);
    if (!status) return;
    const review = processor.peekAdmittedLocalDatasetReview(taskId, context);
    return review ? {taskId, state: "review-required", review} : {...status, review: null};
  });
}

/** Read metadata through the transaction's existing organization partition. No runtime or file IO. */
export async function compileHeadlessDatasetPlanInputs(rootDirectory: string, documents: StructuredDocumentStore,
  request: HeadlessLocalDatasetPlanRequest, context: ApplicationRequestContext, stillAllowed: () => Promise<boolean>) {
  const {idempotencyKey: _key, ...input} = request.input;
  return new PrepareHeadlessDatasetInputsUseCase(composeIngestionAcquisitionRepository(rootDirectory, documents)).execute({
    version: request.version, operation: "data.preview-dataset-preparation", input,
  }, {hostIncarnationId: input.hostIncarnationId, context, stillAllowed});
}

/** Pure owner metadata after exact accepted task/actor/client association. */
export async function compileHeadlessDatasetResultInputs(documents: StructuredDocumentStore,
  request: HeadlessDatasetResultSavePlanRequest, scope: HeadlessOperationScope,
  getProcessor: () => Promise<HeadlessDatasetResultOwner>, stillAllowed: () => Promise<boolean>): Promise<PreparedLocalDatasetResultInputs | undefined> {
  const {hostIncarnationId, workspaceId, taskId, reportFingerprint} = request.input;
  if (workspaceId !== scope.workspaceId || !await stillAllowed()) return;
  const admittedSourceDigest = await readStructuredOwnedDatasetPlanTaskSourceDigest(documents, scope, hostIncarnationId, taskId);
  if (!admittedSourceDigest || !await stillAllowed()) return;
  const summary = (await getProcessor()).peekAdmittedLocalDatasetReview(taskId, scope);
  const decoded = readHeadlessDatasetTaskReviewValue({taskId, state: "review-required", review: summary}, {kind: "task", taskId});
  const review = decoded?.review;
  if (!review || review.reportFingerprint !== reportFingerprint || !review.approvalAllowed || review.status === "blocked" || !await stillAllowed()) return;
  return {review, admittedSourceDigest};
}

/** One admitted artifact attempt; only the atomic causal receipt confirms save. */
export async function runPreparedHeadlessDatasetResult(options: {
  readonly prepared: PreparedDatasetResultStep;
  readonly request: HeadlessPlanStepRequest;
  readonly context: ApplicationRequestContext;
  readonly canUse: () => Promise<boolean>;
  readonly getProcessor: () => Promise<HeadlessDatasetResultOwner>;
}) {
  const {prepared, request, context, canUse, getProcessor} = options;
  const forbidden = {result: {ok: false, code: "headless.forbidden"}} as const;
  const unconfirmed = {result: {ok: false, code: "headless.operation-unconfirmed"}} as const;
  if (!prepared.isCurrent() || !await canUse()) return forbidden;
  const observed = await prepared.inspect(); if (!observed) return unconfirmed;
  let kind: "committed" | "replayed" = "replayed";
  let reference = observed.kind === "committed" ? observed.reference : undefined;
  if (observed.kind === "absent") {
    if (!await prepared.stillAllowed() || !await canUse()) return forbidden;
    const reserved = await prepared.reserve(); if (!reserved) return unconfirmed;
    if (reserved.kind === "committed") reference = reserved.reference;
    else if (reserved.kind === "capacity") return {result: {ok: false, code: "headless.operation-capacity"}} as const;
    else if (reserved.kind === "new") {
      const {saveId, sourceDigest} = reserved, input = prepared.request.input;
      if (!context.organizationId || !context.principalId || context.workspaceId !== input.workspaceId) return forbidden;
      const processor = await getProcessor();
      await processor.saveAdmittedLocalProvidedDataset({requestId: input.taskId, reportFingerprint: input.reportFingerprint,
        outputBaseName: input.outputBaseName}, context, {workspaceId: input.workspaceId,
        organizationId: context.organizationId, principalId: context.principalId, effectId: saveId, taskId: input.taskId,
        reportFingerprint: input.reportFingerprint, outputBaseName: input.outputBaseName, isCurrent: prepared.isCurrent,
        stillAllowed: async () => prepared.isCurrent() && await canUse() && await prepared.stillAllowed(),
        issue: () => prepared.issue(saveId, sourceDigest), commit: version => prepared.commit(saveId, sourceDigest, version)});
      // A post-commit staging-cleanup error cannot erase the causal save.
      // Conversely an ordinary version cannot supply this receipt.
      reference = await prepared.readReceipt();
      kind = "committed";
    }
  }
  if (!prepared.isCurrent() || !await canUse() || !await prepared.stillAllowed()) return forbidden;
  if (!reference) return unconfirmed;
  const {fingerprint, approvalRevision, step} = request.input;
  return {result: readHeadlessPlanStepResult({ok: true, value: {kind, operation: "data.save-prepared-dataset", reference,
    fingerprint, approvalRevision, step, expiresAt: prepared.expiresAt}}, request.input,
    {allowLocalFileSave: false, allowDatasetResultSave: true}), publishIfCurrent: prepared.publishIfCurrent};
}

/** Only a new durable reservation can call the existing processing owner. */
export async function runPreparedHeadlessLocalDataset(options: {
  readonly prepared: PreparedDatasetStep;
  readonly request: HeadlessPlanStepRequest;
  readonly context: ApplicationRequestContext;
  readonly canUse: () => Promise<boolean>;
  readonly resolveStart: () => Promise<StartHeadlessDataset | undefined>;
}) {
  const {prepared, request, context, canUse, resolveStart} = options;
  const forbidden = {result: {ok: false, code: "headless.forbidden"}} as const;
  const unconfirmed = {result: {ok: false, code: "headless.operation-unconfirmed"}} as const;
  if (!prepared.isCurrent() || !await canUse()) return forbidden;
  const observed = await prepared.inspect();
  if (!observed) return unconfirmed;
  let kind: "started" | "replayed" = "replayed";
  let reference = observed.kind === "accepted" ? observed.reference : undefined;
  if (observed.kind === "absent") {
    const start = await resolveStart();
    if (!start || !prepared.isCurrent() || !await canUse() || !await prepared.stillAllowed()) return forbidden;
    const reserved = await prepared.reserve();
    if (!reserved) return unconfirmed;
    if (reserved.kind === "accepted") reference = reserved.reference;
    else if (reserved.kind === "new") {
      const taskId = reserved.taskId;
      const result = await start(reserved.compiled.command, context, {
        taskId, sources: reserved.compiled.admissionSources, isCurrent: prepared.isCurrent,
        stillAllowed: async () => prepared.isCurrent() && await canUse() && await prepared.stillAllowed(),
        issue: () => prepared.issue(taskId, reserved.sourceDigest),
      });
      if (!result.ok || result.value.requestId !== taskId || result.value.accepted !== true ||
          (result.value.status !== "queued" && result.value.status !== "running")) return unconfirmed;
      // Persist the issued business outcome even if the caller has since lost access.
      if (!await prepared.accept(taskId)) return unconfirmed;
      kind = "started";
      reference = await prepared.readReceipt();
    }
  }
  if (!prepared.isCurrent() || !await canUse() || !await prepared.stillAllowed()) return forbidden;
  if (!reference) return unconfirmed;
  const {fingerprint, approvalRevision, step} = request.input;
  return {result: readHeadlessPlanStepResult({ok: true, value: {kind, operation: "data.prepare-local-dataset",
    reference, fingerprint, approvalRevision, step, expiresAt: prepared.expiresAt}}, request.input,
    {allowLocalFileSave: false, allowLocalDatasetPreparation: true}), publishIfCurrent: prepared.publishIfCurrent};
}

/** Run the exact stored selection through the owning ingestion service and confirm its durable receipt. */
export async function runPreparedHeadlessLocalFile(options: {
  readonly prepared: PreparedLocalFileStep;
  readonly request: HeadlessPlanStepRequest;
  readonly context: Parameters<FinalizeApprovedLocalFile>[1];
  readonly canUse: () => Promise<boolean>;
  readonly resolveFinalize: () => Promise<FinalizeApprovedLocalFile | undefined>;
}) {
  const { prepared, request, context, canUse, resolveFinalize } = options;
  const forbidden = { result: { ok:false, code:"headless.forbidden" } } as const;
  const unconfirmed = { result: { ok:false, code:"headless.operation-unconfirmed" } } as const;
  if (!await canUse() || !prepared.isCurrent()) return forbidden;
  const observed = await prepared.inspect();
  if (!observed) return unconfirmed;
  let kind: "committed" | "replayed" = "replayed";
  let reference = observed.kind === "replayed" ? observed.receipt : undefined;
  if (observed.kind === "staged") {
    const finalize = await resolveFinalize();
    if (!finalize || !await canUse() || !await prepared.stillAllowed()) return forbidden;
    const outcome = await finalize({
      preview: observed.preview,
      stillAllowed: async () => await canUse() && await prepared.stillAllowed(),
      isCurrent: prepared.isCurrent,
      issuePublication: prepared.issuePublication,
    }, context);
    if (!outcome.ok) return outcome.code === "headless.forbidden" ? forbidden : unconfirmed;
    reference = await prepared.readReceipt();
    kind = "committed";
  }
  if (!reference) return unconfirmed;
  if (!prepared.isCurrent() || !await canUse() || !await prepared.stillAllowed()) return forbidden;
  const { fingerprint, approvalRevision, step } = request.input;
  return { result: readHeadlessPlanStepResult({ ok: true, value: { kind, operation: "data.save-local-source",
    reference, fingerprint, approvalRevision, step, expiresAt: prepared.expiresAt } }, request.input,
    { allowLocalFileSave: true }), publishIfCurrent: prepared.publishIfCurrent };
}

export async function runPreparedHeadlessProviderFile(options: {
  readonly prepared: PreparedProviderFileStep;
  readonly request: HeadlessPlanStepRequest;
  readonly context: Parameters<FinalizeApprovedProviderFile>[1];
  readonly canUse: () => Promise<boolean>;
  readonly resolveFinalize: () => Promise<FinalizeApprovedProviderFile | undefined>;
}) {
  const { prepared, request, context, canUse, resolveFinalize } = options;
  const forbidden = { result: { ok: false, code: "headless.forbidden" } } as const;
  const unconfirmed = { result: { ok: false, code: "headless.operation-unconfirmed" } } as const;
  if (!await canUse() || !prepared.isCurrent()) return forbidden;
  const observed = await prepared.inspect();
  if (!observed) return unconfirmed;
  let kind: "committed" | "replayed" = "replayed";
  let reference = observed.kind === "replayed" ? observed.receipt : undefined;
  if (observed.kind === "staged") {
    const finalize = await resolveFinalize();
    if (!finalize || !await canUse() || !await prepared.stillAllowed()) return forbidden;
    const outcome = await finalize({
      preview: observed.preview,
      stillAllowed: async () => await canUse() && await prepared.stillAllowed(),
      isCurrent: prepared.isCurrent,
      publish: prepared.publish,
    }, context);
    if (!outcome.ok) return outcome.code === "headless.forbidden" ? forbidden : unconfirmed;
    reference = await prepared.readReceipt();
    kind = "committed";
  }
  if (!reference) return unconfirmed;
  if (!prepared.isCurrent() || !await canUse() || !await prepared.stillAllowed()) return forbidden;
  const { fingerprint, approvalRevision, step } = request.input;
  return { result: readHeadlessPlanStepResult({ ok: true, value: { kind, operation: "data.save-provider-source",
    reference, fingerprint, approvalRevision, step, expiresAt: prepared.expiresAt } }, request.input,
    { allowLocalFileSave: false, allowProviderFileSave: true }), publishIfCurrent: prepared.publishIfCurrent };
}

/** The owning plan transaction calls this only for a new proposal. */
export async function validateHeadlessPlanSavedSources(
  documents: StructuredDocumentStore, workspaceId: WorkspaceId,
  requests: readonly HeadlessBuildPlanRequest[], isCurrent: () => boolean,
  validateLocalFile?: (request: HeadlessLocalFileSavePlanRequest) => Promise<true | false | "stale">,
  validateProviderFile?: (request: HeadlessProviderFileSavePlanRequest) => Promise<true | false | "stale">,
  validateDataset?: (request: HeadlessLocalDatasetPlanRequest) => Promise<true | false | "stale">,
  validateDatasetResult?: (request: HeadlessDatasetResultSavePlanRequest) => Promise<true | false | "stale">,
  validateContext?: (request: HeadlessContextGenerationPlanRequest) => Promise<true | false | "stale">,
  validateContextResult?: (request: HeadlessContextResultSavePlanRequest) => Promise<true | false | "stale">,
  validateContextQuery?: (request: import("../../../contracts/headless").HeadlessContextQueryPlanRequest) => Promise<true | false | "stale">,
  validateModelDownload?: (request: import("../../../contracts/headless").HeadlessModelDownloadPlanRequest) => Promise<true | false | "stale">,
  validateModelReferenceSave?: (request: import("../../../contracts/headless").HeadlessModelReferenceSavePlanRequest) => Promise<true | false | "stale">,
): Promise<true | false | "stale"> {
  const systems = createStructuredSystemBuilderRepository(documents);
  for (const request of requests) {
    const { operation, input } = request;
    if (!isCurrent() || input.workspaceId !== workspaceId) return false;
    if (operation === "models.save-download") {
      if (!validateModelReferenceSave) return false;
      const eligible = await validateModelReferenceSave(request);
      if (eligible !== true) return eligible;
      continue;
    }
    // The opt-in validator compares only provider facts already prepared outside
    // this transaction. A caller's inline source claims supply no authority.
    if (operation === "models.download") {
      if (!validateModelDownload) return false;
      const eligible = await validateModelDownload(request);
      if (eligible !== true) return eligible;
      continue;
    }
    if (operation === "context.query") {
      if (!validateContextQuery) return false;
      const eligible = await validateContextQuery(request);
      if (eligible !== true) return eligible;
      continue;
    }
    if (operation === "context.save-result") {
      if (!validateContextResult) return false;
      const eligible = await validateContextResult(request);
      if (eligible !== true) return eligible;
      continue;
    }
    if (operation === "context.generate-pack" || operation === "context.generate-rag") {
      if (!validateContext) return false;
      const eligible = await validateContext(request);
      if (eligible !== true) return eligible;
      continue;
    }
    if (operation === "data.save-prepared-dataset") {
      if (!validateDatasetResult) return false;
      const eligible = await validateDatasetResult(request);
      if (eligible !== true) return eligible;
      continue;
    }
    if (operation === "data.save-local-source") {
      if (!validateLocalFile) return false;
      const eligible = await validateLocalFile(request);
      if (eligible !== true) return eligible;
      continue;
    }
    if (operation === "data.save-provider-source") {
      if (!validateProviderFile) return false;
      const eligible = await validateProviderFile(request);
      if (eligible !== true) return eligible;
      continue;
    }
    if (operation === "data.prepare-local-dataset") {
      if (!validateDataset) return false;
      const eligible = await validateDataset(request);
      if (eligible !== true) return eligible;
      continue;
    }
    if (operation === "systems.create") continue;
    const record = await systems.readRecord(workspaceId, input.systemId);
    if (!isCurrent()) return false;
    if (!record || record.targetWorkspaceId !== workspaceId || record.systemId !== input.systemId ||
        record.status === "archived" || record.revision !== input.baseRecordRevision ||
        record.currentRevisionId !== input.baseRevisionId) return "stale";
    const revision = await systems.readRevision(workspaceId, input.systemId, input.baseRevisionId);
    if (!isCurrent()) return false;
    if (!revision || revision.targetWorkspaceId !== workspaceId || revision.systemId !== input.systemId ||
        revision.revisionId !== input.baseRevisionId ||
        revision.composition.compositionId !== record.composition.compositionId) return "stale";
  }
  return isCurrent();
}

export function projectHeadlessPlanReview(result: HeadlessPlanReviewSnapshotResult, fingerprint: string): HeadlessPlanReviewAgentResult {
  if (!result.ok) {
    switch (result.code) {
      case "forbidden": return { ok: false, code: "headless.forbidden" };
      case "invalid": return { ok: false, code: "headless.invalid-request" };
      case "expired": return { ok: false, code: "headless.plan-expired" };
      case "stale": return { ok: false, code: "headless.stale" };
      case "capacity": return { ok: false, code: "headless.operation-capacity" };
      default: return { ok: false, code: "headless.unavailable" };
    }
  }
  const { revision, stepCount, expiresAt, status, approvedSteps, mode } = result.snapshot.state;
  return { ok: true, value: { fingerprint, revision, stepCount, expiresAt, status, approvedSteps,
    ...(mode === undefined ? {} : { mode }) } };
}
