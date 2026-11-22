import { createHash } from "node:crypto";
import type {
  HeadlessPlanReviewQuery, HeadlessPlanReviewRepository, HeadlessPlanReviewResult, HeadlessPlanReviewState,
  HeadlessPlanReviewTarget,
  HeadlessPlanReviewListEntry, HeadlessPlanReviewListResult, HeadlessPlanReviewListTarget,
} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import { HEADLESS_MAX_BUILD_PLAN_STEPS, isDesktopHeadlessClientId, isHeadlessHostIncarnationId,
  parseHeadlessBuildPlanProposal, type HeadlessBuildPlanRequest } from "../../../contracts/headless";
import {serializeHeadlessMutationInput, type HeadlessContextGenerationPlanRequest, type HeadlessContextQueryPlanRequest} from "../../../contracts/headless";
import type {ApprovedContextEmbeddingModelWitness} from "../../../application/ports/context-management";
import {readApprovedContextEmbeddingModelWitness} from "../../../application/use-cases/context-management/approved-context-embedding-model";
import { isOrganizationId } from "../../../contracts/organization";
import { copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord } from "../../../contracts/shared";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { StructuredDocumentStore } from "../shared";
import { HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE } from "./createStructuredHeadlessOperationStore";
import {readModelDownloadReviewBindings, type ModelDownloadReviewBinding} from "./headlessModelDownloadReviewBindings";
import {readModelTrainingReviewBindings, type ModelTrainingReviewBinding} from "./headlessModelTrainingReviewBindings";

const REVIEWS = "headless/system-builder/plan-reviews";
const COUNTS = "headless/system-builder/plan-review-counts";
const APPROVAL_LIST = "headless/system-builder/plan-approval-list";
const EXECUTION_FENCE = "headless/system-builder/plan-execution-fences";
const MAX_ACTIVE_PLAN_REVIEWS = 32;
const REVIEW_MS = 15 * 60 * 1_000;
const denied = { ok: false, code: "forbidden" } as const;
const expired = { ok: false, code: "expired" } as const;
const unconfirmed = { ok: false, code: "unconfirmed" } as const;
const capacity = { ok: false, code: "capacity" } as const;
type Failure = Extract<HeadlessPlanReviewResult, { ok: false }>;
type Action = "propose" | "read" | "decide";
type Proposal = Extract<ReturnType<typeof parseHeadlessBuildPlanProposal>, { ok: true }>;
export interface ContextPlanModelBinding {readonly step: number; readonly model: ApprovedContextEmbeddingModelWitness;}
type RecordValue = {readonly version: 1; readonly proposal: unknown; readonly state: HeadlessPlanReviewState} |
  {readonly version: 2; readonly proposal: unknown; readonly state: HeadlessPlanReviewState; readonly contextModels: readonly ContextPlanModelBinding[]} |
  {readonly version: 3; readonly proposal: unknown; readonly state: HeadlessPlanReviewState;
    readonly modelDownloads: readonly ModelDownloadReviewBinding[]; readonly contextModels?: readonly ContextPlanModelBinding[]} |
  {readonly version: 4; readonly proposal: unknown; readonly state: HeadlessPlanReviewState;
    readonly modelTrainings: readonly ModelTrainingReviewBinding[];
    readonly modelDownloads?: readonly ModelDownloadReviewBinding[]; readonly contextModels?: readonly ContextPlanModelBinding[]};

/** Metadata only inside the owned transaction. Provider IO must have finished
 * before propose(); compare that prepared data to this exact target and selection. */
export type BindModelDownloadReviews = (partition: StructuredDocumentStore, target: HeadlessPlanReviewTarget,
  requests: readonly HeadlessBuildPlanRequest[]) => Promise<readonly ModelDownloadReviewBinding[] | undefined>;

export type BindModelTrainingReviews = (partition: StructuredDocumentStore, target: HeadlessPlanReviewTarget,
  requests: readonly HeadlessBuildPlanRequest[]) => Promise<readonly ModelTrainingReviewBinding[] | undefined>;

/** Trusted metadata configuration only, never an untrusted wire capability. */
export interface ModelTrainingReviewOptions {
  readonly bind?: BindModelTrainingReviews;
  readonly allowStored?: boolean;
}

function readContextModels(value: unknown, requests: readonly HeadlessBuildPlanRequest[]): readonly ContextPlanModelBinding[] | undefined {
  try {
    const expected = requests.flatMap((request, index) => request.operation === "context.generate-rag" ? [{request, step: index + 1}] : []);
    const rows = copyBoundedPassiveData(value);
    if (!expected.length || !Array.isArray(rows) || rows.length !== expected.length) return;
    return Object.freeze(rows.map((row, index) => {
      const raw = readStrictPassiveRecord(row, ["step", "model"]), target = expected[index];
      const model = readApprovedContextEmbeddingModelWitness(raw.model);
      if (raw.step !== target.step || !model || model.modelRecordId !== target.request.input.settings.modelRecordId ||
          model.modelUpdatedAt !== target.request.input.settings.modelUpdatedAt) throw new Error("The selected Context model is unavailable.");
      return Object.freeze({step: target.step, model});
    }));
  } catch {return;}
}

class ReviewWriteRetired extends Error {}

export function createStructuredHeadlessPlanReviewRepository(
  documents: StructuredDocumentStore,
  policy: (owner: StructuredDocumentStore, target: HeadlessPlanReviewTarget, action: Action) => Promise<boolean>,
  now: () => number = Date.now,
  validateNewProposal?: (partition: StructuredDocumentStore) => Promise<true | false | "stale">,
  allowLocalFileSave = false,
  allowProviderFileSave = false,
  allowLocalDatasetPreparation = false,
  allowDatasetResultSave = false,
  allowContextPackGeneration = false,
  allowContextRagGeneration = false,
  bindContextModels?: (partition: StructuredDocumentStore, requests: readonly HeadlessBuildPlanRequest[]) =>
    Promise<readonly ContextPlanModelBinding[] | undefined>,
  allowContextResultSave = false,
  allowContextQuery = false,
  bindModelDownloads?: BindModelDownloadReviews,
  allowStoredModelDownloads = false,
  allowModelReferenceSave = false,
  training?: ModelTrainingReviewOptions,
): HeadlessPlanReviewRepository {
  const proposedTrainingBinder = training?.bind;
  const bindModelTrainings = typeof proposedTrainingBinder === "function" ? proposedTrainingBinder : undefined;
  const allowStoredModelTraining = training?.allowStored === true;
  if (documents.organizationId !== undefined || !documents.runInOwnedTransaction)
    throw new Error("Headless plan reviews require the platform transaction owner.");
  const runInOwnedTransaction = documents.runInOwnedTransaction.bind(documents);

  async function run<T>(
    input: HeadlessPlanReviewQuery, action: Action,
    visit: (store: StructuredDocumentStore, target: HeadlessPlanReviewTarget, key: string,
      requireFresh: (deadline: number) => boolean) => Promise<T>,
  ): Promise<T | Failure> {
    const target = { ...input.target, scope: { ...input.target.scope } };
    if (!validTarget(target) || !input.isCurrent()) return denied;
    const key = planKey(target);
    let deadline: number | undefined;
    function requireFresh(value: number) {
      deadline = value;
      return currentTimeBefore(value);
    }
    function currentTimeBefore(value: number) {
      const timestamp = now();
      return nonnegativeInteger(timestamp) && timestamp < value;
    }
    function checkFence() {
      if (!input.isCurrent() || (deadline !== undefined && !currentTimeBefore(deadline))) throw new ReviewWriteRetired();
    }
    try {
      const outcome = await runInOwnedTransaction(async owner => {
        deadline = undefined;
        checkFence();
        if (!await policy(owner, target, action)) return denied;
        checkFence();
        return visit(owner.forOrganization(target.scope.organizationId), target, key, requireFresh);
      }, checkFence);
      if (!input.isCurrent()) return denied;
      return deadline !== undefined && !currentTimeBefore(deadline) ? expired : outcome;
    } catch (error) {
      if (error instanceof ReviewWriteRetired)
        return input.isCurrent() && deadline !== undefined && !currentTimeBefore(deadline) ? expired : denied;
      return unconfirmed;
    }
  }

  return {
    async propose(input) {
      const proposal = decodeProposal(input.proposal, input.target, allowLocalFileSave && Boolean(validateNewProposal),
        allowProviderFileSave && Boolean(validateNewProposal), allowLocalDatasetPreparation && Boolean(validateNewProposal),
        allowDatasetResultSave && Boolean(validateNewProposal), allowContextPackGeneration && Boolean(validateNewProposal),
        allowContextRagGeneration && Boolean(validateNewProposal), allowContextResultSave && Boolean(validateNewProposal),
        allowContextQuery && Boolean(validateNewProposal), Boolean(bindModelDownloads && validateNewProposal),
        allowModelReferenceSave && Boolean(validateNewProposal), Boolean(bindModelTrainings && validateNewProposal));
      if (!proposal) return { ok: false, code: "invalid" };
      return run(input, "propose", async (store, target, key, requireFresh) => {
        const existing = await readReview(store, target, key);
        if (existing?.requests.some(request => request.operation === "models.download") && !bindModelDownloads) return denied;
        if (existing?.requests.some(request => request.operation === "models.train") && !bindModelTrainings) return denied;
        if (existing?.requests.some(request => request.operation === "models.save-download") && !allowModelReferenceSave) return denied;
        if (existing) return requireFresh(existing.state.expiresAt) ? snapshot(existing) : expired;
        const eligible = validateNewProposal ? await validateNewProposal(store) : true;
        if (eligible === "stale") return { ok: false, code: "stale" } as const;
        if (!eligible || !input.isCurrent()) return denied;
        const hasRag = proposal.requests.some(request => request.operation === "context.generate-rag");
        const contextModels = hasRag ? readContextModels(await bindContextModels?.(store, structuredClone(proposal.requests)), proposal.requests) : undefined;
        if ((hasRag && !contextModels) || !input.isCurrent()) return denied;
        const hasDownloads = proposal.requests.some(request => request.operation === "models.download");
        const modelDownloads = hasDownloads ? readModelDownloadReviewBindings(await bindModelDownloads?.(
          store, structuredClone(target), structuredClone(proposal.requests)), proposal.requests) : undefined;
        if ((hasDownloads && !modelDownloads) || !input.isCurrent()) return denied;
        const hasTraining = proposal.requests.some(request => request.operation === "models.train");
        const modelTrainings = hasTraining ? readModelTrainingReviewBindings(await bindModelTrainings?.(
          store, structuredClone(target), structuredClone(proposal.requests)), proposal.requests) : undefined;
        if ((hasTraining && !modelTrainings) || !input.isCurrent()) return denied;
        const countKey = sha256(JSON.stringify(scopeParts(target)));
        const count = await store.readDocument(COUNTS, countKey);
        const used = count ? readStrictPassiveRecord(count.value, ["value"]).value : 0;
        if (!nonnegativeInteger(used)) return unconfirmed;
        if (used >= HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE) return capacity;
        const createdAt = now();
        if (!nonnegativeInteger(createdAt) || createdAt > Number.MAX_SAFE_INTEGER - REVIEW_MS) return unconfirmed;
        const list = await readApprovalList(store, target);
        const currentRequests = list.requests.filter(request => request.expiresAt > createdAt);
        if (currentRequests.length >= MAX_ACTIVE_PLAN_REVIEWS) return capacity;
        const state: HeadlessPlanReviewState = { revision: 1, stepCount: proposal.requests.length,
          expiresAt: createdAt + REVIEW_MS, status: "pending", approvedSteps: 0 };
        if (!requireFresh(state.expiresAt)) return expired;
        const raw = {
          ...proposal.scope, steps: proposal.preview.steps.map(({ operation, input }) => ({ operation, ...input })),
        };
        const record: RecordValue = modelTrainings ? {version: 4, proposal: raw, state, modelTrainings,
          ...(modelDownloads ? {modelDownloads} : {}), ...(contextModels ? {contextModels} : {})} : modelDownloads ? {version: 3, proposal: raw, state, modelDownloads,
          ...(contextModels ? {contextModels} : {})} : contextModels ? {version: 2, proposal: raw, state, contextModels} : {version: 1, proposal: raw, state};
        await store.writeDocument(REVIEWS, key, record, { expectedRevision: 0 });
        await store.writeDocument(COUNTS, countKey, { value: used + 1 }, { expectedRevision: count?.revision ?? 0 });
        await store.writeDocument(APPROVAL_LIST, list.key, { requests: [{
          registeredClientId: target.scope.registeredClientId, fingerprint: target.fingerprint, expiresAt: state.expiresAt,
        }, ...currentRequests] }, { expectedRevision: list.revision });
        return snapshot({ state, preview: proposal.preview });
      });
    },
    async read(input) {
      return run(input, "read", async (store, target, key, requireFresh) => {
        const review = await readReview(store, target, key);
        if (!review) return denied;
        if (review.requests.some(request => request.operation === "models.download") && !bindModelDownloads && allowStoredModelDownloads !== true) return denied;
        if (review.requests.some(request => request.operation === "models.train") && !bindModelTrainings && !allowStoredModelTraining) return denied;
        if (review.requests.some(request => request.operation === "models.save-download") && !allowModelReferenceSave) return denied;
        return requireFresh(review.state.expiresAt) ? snapshot(review) : expired;
      });
    },
    async decide(input) {
      return run(input, "decide", async (store, target, key, requireFresh) => {
        const review = await readReview(store, target, key);
        if (!review) return denied;
        if (review.requests.some(request => request.operation === "models.download") && !bindModelDownloads && allowStoredModelDownloads !== true) return denied;
        if (review.requests.some(request => request.operation === "models.train") && !bindModelTrainings && !allowStoredModelTraining) return denied;
        if (review.requests.some(request => request.operation === "models.save-download") && !allowModelReferenceSave) return denied;
        if (!requireFresh(review.state.expiresAt)) return expired;
        const previous = review.state;
        const outcome = input.update({ ...previous });
        if (!outcome.ok) return outcome;
        const state = readState(outcome.state, previous.revision + 1, previous.stepCount);
        if (state.expiresAt !== previous.expiresAt) return unconfirmed;
        await store.writeDocument(REVIEWS, key, {...review.record, state} satisfies RecordValue,
          { expectedRevision: previous.revision });
        if (!await writeExecutionFence(store, key, previous.revision, state.revision))
          throw new Error("The approval execution fence changed.");
        if (state.status === "cancelled" || state.status === "denied" || state.status === "revoked") {
          const list = await readApprovalList(store, target);
          const requests = list.requests.filter(reference => reference.fingerprint !== target.fingerprint ||
            reference.registeredClientId !== target.scope.registeredClientId);
          if (requests.length !== list.requests.length)
            await store.writeDocument(APPROVAL_LIST, list.key, { requests }, { expectedRevision: list.revision });
        }
        return { ok: true, state } as const;
      });
    },
  };
}

/** Interactive approval owners may read/decide existing bound Model proposals.
 * They receive no proposal method and cannot replace provider preparation. */
export function createStructuredHeadlessStoredPlanReviewRepository(
  documents: StructuredDocumentStore,
  policy: Parameters<typeof createStructuredHeadlessPlanReviewRepository>[1],
  now: () => number = Date.now,
  allowModelDownloads = false,
  allowModelReferenceSave = false,
  allowModelTraining = false,
): Pick<HeadlessPlanReviewRepository, "read" | "decide"> {
  const store = createStructuredHeadlessPlanReviewRepository(documents, policy, now, undefined,
    false, false, false, false, false, false, undefined, false, false, undefined, allowModelDownloads === true, allowModelReferenceSave === true,
    {allowStored: allowModelTraining === true});
  return {read: store.read, decide: store.decide};
}

function validTarget(target: HeadlessPlanReviewTarget) {
  return validListTarget(target) && isDesktopHeadlessClientId(target.scope.registeredClientId) && validFingerprint(target.fingerprint);
}

function scopeParts({ scope }: HeadlessPlanReviewTarget) {
  return [scope.organizationId, scope.workspaceId, scope.principalId, scope.registeredClientId];
}

function planKey(target: HeadlessPlanReviewTarget) {
  return sha256(JSON.stringify([...scopeParts(target), target.hostIncarnationId, target.fingerprint]));
}

function sha256(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }

function decodeProposal(value: unknown, target: HeadlessPlanReviewTarget, allowLocalFileSave: boolean, allowProviderFileSave = false,
  allowLocalDatasetPreparation = false, allowDatasetResultSave = false, allowContextPackGeneration = false, allowContextRagGeneration = false,
  allowContextResultSave = false, allowContextQuery = false, allowModelDownload = false, allowModelReferenceSave = false, allowModelTraining = false) {
  const proposal = parseHeadlessBuildPlanProposal(value, target.hostIncarnationId,
    { allowLocalFileSave, allowProviderFileSave, allowLocalDatasetPreparation, allowDatasetResultSave, allowContextPackGeneration, allowContextRagGeneration,
      allowContextResultSave, allowContextQuery, allowModelDownload, allowModelReferenceSave, allowModelTraining });
  if (proposal.ok && proposal.scope.workspaceId === target.scope.workspaceId &&
      sha256(JSON.stringify(proposal.preview)) === target.fingerprint) return proposal;
}

async function readReview(store: StructuredDocumentStore, target: HeadlessPlanReviewTarget, key: string) {
  const document = await store.readDocument(REVIEWS, key);
  if (!document) return;
  const raw = readStrictPassiveRecord(document.value, ["version", "proposal", "state", "contextModels", "modelDownloads", "modelTrainings"]);
  const {version, proposal, state} = raw;
  const parsed = decodeProposal(proposal, target, true, true, true, true, true, true, true, true, version === 3 || version === 4, true, version === 4);
  if (!parsed) throw new Error("Stored plan review is unavailable.");
  const normalizedState = readState(state, document.revision, parsed.requests.length);
  const hasRag = parsed.requests.some(request => request.operation === "context.generate-rag");
  const hasDownloads = parsed.requests.some(request => request.operation === "models.download");
  const hasTraining = parsed.requests.some(request => request.operation === "models.train");
  const contextModels = version === 2 || (version === 3 || version === 4) && hasRag ? readContextModels(raw.contextModels, parsed.requests) : undefined;
  const modelDownloads = version === 3 || version === 4 && hasDownloads ? readModelDownloadReviewBindings(raw.modelDownloads, parsed.requests) : undefined;
  const modelTrainings = version === 4 && hasTraining ? readModelTrainingReviewBindings(raw.modelTrainings, parsed.requests) : undefined;
  if ((version === 1 && ("contextModels" in raw || hasRag)) ||
      (version !== 3 && version !== 4 && "modelDownloads" in raw) ||
      (version !== 4 && "modelTrainings" in raw) ||
      (version === 2 && !contextModels) ||
      (version === 3 && (!modelDownloads || (hasRag ? !contextModels : "contextModels" in raw))) ||
      (version === 4 && (!modelTrainings || (hasDownloads ? !modelDownloads : "modelDownloads" in raw) ||
        (hasRag ? !contextModels : "contextModels" in raw))) ||
      (version !== 1 && version !== 2 && version !== 3 && version !== 4)) throw new Error("Stored plan review is unavailable.");
  const record: RecordValue = version === 4 && modelTrainings ? {version: 4, proposal, state: normalizedState, modelTrainings,
    ...(modelDownloads ? {modelDownloads} : {}), ...(contextModels ? {contextModels} : {})} : version === 3 && modelDownloads ? {version: 3, proposal, state: normalizedState, modelDownloads,
    ...(contextModels ? {contextModels} : {})} : version === 2 && contextModels ? {version: 2, proposal, state: normalizedState, contextModels}
      : {version: 1, proposal, state: normalizedState};
  return { proposal, preview: parsed.preview, requests: parsed.requests,
    state: normalizedState, record };
}

/** Finite permission facts only; the caller must authorize this exact owner/target first. */
export async function readStructuredHeadlessPlanModelPermission(partition: StructuredDocumentStore, target: HeadlessPlanReviewTarget) {
  if (!validTarget(target) || partition.organizationId !== target.scope.organizationId) return;
  const review = await readReview(partition, target, planKey(target));
  // Existing public approval compositions have no training permission owner.
  // A stored private preview cannot silently activate that missing policy.
  if (review?.requests.some(request => request.operation === "models.train")) return;
  return review ? {requiresModelRead: review.requests.some(request => request.operation === "context.generate-rag" || request.operation === "context.query"),
    requiresArtifactWrite: review.requests.some(request => request.operation === "context.save-result"),
    ...(review.requests.some(request => request.operation === "models.download" || request.operation === "models.save-download") ? {requiresModelWrite: true as const} : {})} : undefined;
}

/** Historic definition, never historic permission. The caller must first prove
 * an indexed saved-result/accepted-task chain and current resource authority. */
export async function readStructuredRecordedContextGeneration(partition: StructuredDocumentStore,
  target: HeadlessPlanReviewTarget, step: number, expectedInputDigest: string) {
  if (!validTarget(target) || partition.organizationId !== target.scope.organizationId ||
      !Number.isSafeInteger(step) || step < 1 || step > HEADLESS_MAX_BUILD_PLAN_STEPS ||
      !/^[a-f0-9]{64}$/.test(expectedInputDigest)) return;
  const review = await readReview(partition, target, planKey(target));
  const request = review?.requests[step - 1];
  if (!request || (request.operation !== "context.generate-pack" && request.operation !== "context.generate-rag") ||
      sha256(serializeHeadlessMutationInput(request)) !== expectedInputDigest) return;
  const model = review!.record.version !== 1 ? review!.record.contextModels?.find(binding => binding.step === step)?.model : undefined;
  if (request.operation === "context.generate-rag" && !model) return;
  return {request: structuredClone(request) as HeadlessContextGenerationPlanRequest,
    ...(model ? {embeddingModel: structuredClone(model)} : {})};
}

/** An accepted query identity supplies lineage, never renewed permission. No question text is stored. */
export async function readStructuredRecordedContextQuery(partition: StructuredDocumentStore,
  target: HeadlessPlanReviewTarget, step: number, expectedInputDigest: string) {
  if (!validTarget(target) || partition.organizationId !== target.scope.organizationId ||
      !Number.isSafeInteger(step) || step < 1 || step > HEADLESS_MAX_BUILD_PLAN_STEPS ||
      !/^[a-f0-9]{64}$/.test(expectedInputDigest)) return;
  const review = await readReview(partition, target, planKey(target));
  const request = review?.requests[step - 1];
  return request?.operation === "context.query" && sha256(serializeHeadlessMutationInput(request)) === expectedInputDigest
    ? structuredClone(request) as HeadlessContextQueryPlanRequest : undefined;
}

/** Used by the execution adapter after current authorization in the same transaction. */
export async function readStructuredApprovedPlan(
  partition: StructuredDocumentStore, target: HeadlessPlanReviewTarget, expectedRevision: number, step: number,
) {
  if (!validTarget(target) || partition.organizationId !== target.scope.organizationId ||
      !nonnegativeInteger(expectedRevision) || expectedRevision < 1 ||
      !nonnegativeInteger(step) || step < 1 || step > HEADLESS_MAX_BUILD_PLAN_STEPS) return;
  const review = await readReview(partition, target, planKey(target));
  if (!review) return;
  const { state } = review;
  if (state.revision !== expectedRevision || !state.lastChannel || step > state.approvedSteps ||
      (state.status !== "approved" && !(state.status === "pending" && state.mode === "each-change"))) return;
  return { expiresAt: state.expiresAt, requests: review.requests,
    contextModels: review.record.version !== 1 ? review.record.contextModels ?? [] : [],
    modelDownloads: review.record.version === 3 || review.record.version === 4 ? review.record.modelDownloads ?? [] : [],
    ...(review.record.version === 4 ? {modelTrainings: review.record.modelTrainings} : {}) };
}

/** Serializes a real new write against approval changes, without changing its public decision revision. */
export async function fenceStructuredApprovedPlan(
  partition: StructuredDocumentStore, target: HeadlessPlanReviewTarget, expectedRevision: number,
) {
  if (!validTarget(target) || partition.organizationId !== target.scope.organizationId ||
      !nonnegativeInteger(expectedRevision) || expectedRevision < 1) return false;
  return writeExecutionFence(partition, planKey(target), expectedRevision, expectedRevision);
}

async function writeExecutionFence(
  partition: StructuredDocumentStore, key: string, priorApprovalRevision: number, approvalRevision: number,
) {
  const fence = await partition.readDocument(EXECUTION_FENCE, key);
  if (fence && readStrictPassiveRecord(fence.value, ["approvalRevision"]).approvalRevision !== priorApprovalRevision)
    return false;
  await partition.writeDocument(EXECUTION_FENCE, key, { approvalRevision }, { expectedRevision: fence?.revision ?? 0 });
  return true;
}

function readState(value: unknown, expectedRevision: number, expectedSteps: number): HeadlessPlanReviewState {
  const { revision, stepCount, expiresAt, status, mode, approvedSteps, lastChannel } =
    readStrictPassiveRecord(value, ["revision", "stepCount", "expiresAt", "status", "mode", "approvedSteps", "lastChannel"]);
  if (!nonnegativeInteger(revision) || revision < 1 || revision !== expectedRevision ||
      !nonnegativeInteger(stepCount) || stepCount < 1 || stepCount > HEADLESS_MAX_BUILD_PLAN_STEPS || stepCount !== expectedSteps ||
      !nonnegativeInteger(expiresAt) || expiresAt < REVIEW_MS || !nonnegativeInteger(approvedSteps) || approvedSteps > stepCount ||
      (mode !== undefined && mode !== "whole-plan" && mode !== "each-change") ||
      (mode === undefined && approvedSteps !== 0) ||
      (status === "approved" && (approvedSteps !== stepCount || mode === undefined)) ||
      (status === "pending" && (approvedSteps === stepCount || mode === "whole-plan")) ||
      (mode === "whole-plan" && (approvedSteps !== stepCount || (status !== "approved" && status !== "revoked"))) ||
      (lastChannel !== undefined && lastChannel !== "app-popup" && lastChannel !== "authenticated-chat") ||
      (status !== "pending" && status !== "approved" && status !== "denied" && status !== "cancelled" && status !== "revoked"))
    throw new Error("Stored plan review state is unavailable.");
  return { revision, stepCount, expiresAt, status, approvedSteps,
    ...(mode === undefined ? {} : { mode }), ...(lastChannel === undefined ? {} : { lastChannel }) };
}

function snapshot(review: { state: HeadlessPlanReviewState; preview: Proposal["preview"] }) {
  return { ok: true, snapshot: { state: review.state, preview: review.preview } } as const;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export async function listStructuredHeadlessPlanReviews(
  documents: StructuredDocumentStore,
  input: { readonly target: HeadlessPlanReviewListTarget; readonly isCurrent: () => boolean },
  policy: (owner: StructuredDocumentStore, target: HeadlessPlanReviewListTarget) => Promise<boolean>,
  now: () => number = Date.now,
): Promise<HeadlessPlanReviewListResult> {
  const { hostIncarnationId, scope: { organizationId, workspaceId, principalId } } = input.target;
  const target = { hostIncarnationId, scope: { organizationId, workspaceId, principalId } };
  if (documents.organizationId !== undefined || !documents.runInOwnedTransaction) return unconfirmed;
  if (!validListTarget(target) || !input.isCurrent()) return denied;
  const fence = () => {
    if (!input.isCurrent()) throw new ReviewWriteRetired();
  };
  try {
    const list = await documents.runInOwnedTransaction(async owner => {
      fence();
      if (!await policy(owner, target)) return undefined;
      fence();
      return readApprovalList(owner.forOrganization(organizationId), target);
    }, fence);
    if (!list || !input.isCurrent()) return denied;
    const observedAt = now();
    return nonnegativeInteger(observedAt)
      ? { ok: true, requests: list.requests.filter(request => request.expiresAt > observedAt) }
      : unconfirmed;
  } catch (error) {
    return error instanceof ReviewWriteRetired || !input.isCurrent() ? denied : unconfirmed;
  }
}

async function readApprovalList(store: StructuredDocumentStore, { hostIncarnationId, scope }: HeadlessPlanReviewListTarget) {
  const key = sha256(JSON.stringify([scope.organizationId, scope.workspaceId, scope.principalId, hostIncarnationId]));
  const document = await store.readDocument(APPROVAL_LIST, key);
  if (!document) return { key, revision: 0, requests: [] as readonly HeadlessPlanReviewListEntry[] };
  const { requests: stored } = readStrictPassiveRecord(document.value, ["requests"]);
  if (!Array.isArray(stored) || stored.length > MAX_ACTIVE_PLAN_REVIEWS) throw new Error("The approval list is unavailable.");
  const requests = stored.map(value => {
    const { registeredClientId, fingerprint, expiresAt } = readStrictPassiveRecord(value,
      ["registeredClientId", "fingerprint", "expiresAt"]);
    if (!isDesktopHeadlessClientId(registeredClientId) || !validFingerprint(fingerprint) ||
        !nonnegativeInteger(expiresAt) || expiresAt < REVIEW_MS) throw new Error("The plan reference is invalid.");
    return { registeredClientId, fingerprint, expiresAt };
  });
  if (new Set(requests.map(entry => JSON.stringify([entry.registeredClientId, entry.fingerprint]))).size !== requests.length)
    throw new Error("The approval list has duplicate references.");
  return { key, revision: document.revision, requests } as const;
}

function validListTarget({ hostIncarnationId, scope }: HeadlessPlanReviewListTarget) {
  const { organizationId, workspaceId, principalId } = scope;
  return isHeadlessHostIncarnationId(hostIncarnationId) && isOrganizationId(organizationId) &&
    isWorkspaceId(workspaceId) && typeof principalId === "string" && principalId.length > 0 &&
    principalId.length <= 160 && principalId === principalId.trim() &&
    !/[\u0000-\u001f\u007f]/.test(principalId) && !hasKnownPassiveCredential(principalId);
}

function validFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
