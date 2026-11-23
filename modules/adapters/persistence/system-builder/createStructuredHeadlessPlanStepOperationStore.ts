import { createHash } from "node:crypto";
import {isDeepStrictEqual, types} from "node:util";

import type {
  HeadlessPlanReviewQuery, HeadlessPlanReviewTarget,
} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import type { HeadlessOperationScope, HeadlessOperationStorePort } from "../../../application/ports/system-builder";
import type { IngestionAcquisitionRepositoryPort, IngestionFilePublicationAdmission } from "../../../application/ports/ingestion";
import type {PrepareHeadlessDatasetInputsUseCase} from "../../../application/use-cases/ingestion-acquisition/headless-dataset-preparation.use-case";
import type {PreviewHeadlessContextInputsUseCase} from "../../../application/use-cases/context-management/headless-context-preview.use-case";
import type {PreparedLocalDatasetResultInputs} from "../../../application/ports/dataset-version";
import type {DatasetVersionRecord} from "../../../contracts/dataset";
import {createStructuredDatasetVersionRepository} from "../dataset-version";
import { normalizeIngestionFilePublication, publicationUnavailable } from "../../../application/shared/ingestion-file-publication";
import { serializeHeadlessMutationInput, type HeadlessBuildPlanRequest, type HeadlessLocalFileSavePlanRequest,
  type HeadlessProviderFileSavePlanRequest, type HeadlessLocalDatasetPlanRequest, type HeadlessDatasetResultSavePlanRequest,
  type HeadlessContextGenerationPlanRequest, type HeadlessContextQueryPlanRequest, type HeadlessContextSource } from "../../../contracts/headless";
import {inspectStructuredDatasetResultSave, reserveStructuredDatasetResultSave, issueStructuredDatasetResultSave,
  commitStructuredDatasetResultSave, readCommittedStructuredDatasetResult, type DatasetResultSaveEffect} from "../ingestion/createStructuredHeadlessDatasetResultStore";
import {inspectStructuredDatasetPlanTask, reserveStructuredDatasetPlanTask, issueStructuredDatasetPlanTask,
  acceptStructuredDatasetPlanTask, type DatasetPlanTaskEffect} from "../ingestion/createStructuredHeadlessDatasetPlanTaskStore";
import {inspectStructuredContextPlanTask, reserveStructuredContextPlanTask, issueStructuredContextPlanTask,
  acceptStructuredContextPlanTask, recordStructuredContextTaskNotStarted, type ContextPlanTaskEffect} from "./createStructuredHeadlessContextPlanTaskStore";
import {
  issueStructuredLocalFilePlanEffect, readCommittedStructuredLocalFilePlanEffect, type LocalFilePlanEffect,
} from "../ingestion/createStructuredHeadlessLocalFilePlanStepStore";
import {
  matchesStructuredHeadlessLocalFileSelection, readStructuredHeadlessLocalFileSelection,
  matchesStructuredHeadlessProviderFileSelection, readStructuredHeadlessProviderFileSelection,
} from "../ingestion/createStructuredHeadlessLocalFileSelectionRepository";
import { publishStructuredProviderFilePlanEffect, readCommittedStructuredProviderFilePlanEffect,
  type OwnedProviderPublication, type ProviderFilePlanEffect } from "../ingestion/createStructuredHeadlessProviderFilePlanStepStore";
import type { StructuredDocumentStore } from "../shared";
import { createStructuredHeadlessOperationStore, hasStructuredHeadlessOperationReceipt } from "./createStructuredHeadlessOperationStore";
import { fenceStructuredApprovedPlan, readStructuredApprovedPlan } from "./createStructuredHeadlessPlanReviewRepository";
import {readCommittedStructuredContextResult, type ContextResultSaveEffect} from "./createStructuredHeadlessContextResultStore";
import type {HeadlessContextResultSavePlanRequest} from "../../../contracts/headless";
import {inspectStructuredModelPlanTask, reserveStructuredModelPlanTask, issueStructuredModelPlanTask,
  acceptStructuredModelPlanTask, recordStructuredModelTaskNotStarted, type ModelPlanTaskEffect} from "./createStructuredHeadlessModelPlanTaskStore";
import type {HeadlessModelDownloadPlanRequest, HeadlessModelReferenceSavePlanRequest} from "../../../contracts/headless";
import {captureModelReferenceSaveEffect, inspectStructuredModelReferenceSave,
  type ModelReferenceSaveEffect} from "./createStructuredHeadlessModelReferenceStore";
import {inspectStructuredTrainingPlanTask, reserveStructuredTrainingPlanTask, issueStructuredTrainingPlanTask,
  acceptStructuredTrainingPlanTask, recordStructuredTrainingTaskNotStarted, type TrainingPlanTaskEffect} from "./createStructuredHeadlessTrainingPlanTaskStore";
import {readModelTrainingReviewBindings, type ModelTrainingReviewBinding} from "./headlessModelTrainingReviewBindings";
import type {HeadlessModelTrainingPlanRequest} from "../../../contracts/headless";
import type {PrepareHeadlessModelTrainingPlanUseCase} from "../../../application/use-cases/model/headless-model-training-plan.use-case";
import {copyHeadlessModelWorkflowData} from "../../../application/use-cases/model/headless-model-download-preview.use-case";
import {readStrictPassiveRecord} from "../../../contracts/shared";

const denied = { kind: "denied" } as const;

type Authorize = (owner: StructuredDocumentStore, scope: HeadlessOperationScope, request?: HeadlessBuildPlanRequest) => Promise<boolean>;

type StepQuery = HeadlessPlanReviewQuery & {
  readonly approvalRevision: number;
  readonly step: number;
};
type CompiledDataset = Extract<Awaited<ReturnType<PrepareHeadlessDatasetInputsUseCase["execute"]>>, {ok: true}>["prepared"];
export type CompileApprovedDataset = (owner: StructuredDocumentStore, request: HeadlessLocalDatasetPlanRequest,
  scope: HeadlessOperationScope) => Promise<CompiledDataset | undefined>;
export type CompileApprovedDatasetResult = (owner: StructuredDocumentStore, request: HeadlessDatasetResultSavePlanRequest,
  scope: HeadlessOperationScope) => Promise<PreparedLocalDatasetResultInputs | undefined>;
type CompiledContext = Extract<Awaited<ReturnType<PreviewHeadlessContextInputsUseCase["execute"]>>, {ok: true; operation: "context.preview-generation"}>["prepared"];
export type CompileApprovedContext = (owner: StructuredDocumentStore, request: HeadlessContextGenerationPlanRequest,
  scope: HeadlessOperationScope) => Promise<CompiledContext | undefined>;

export interface CompiledApprovedContextQuery {
  readonly artifactId: string; readonly artifactDigest: string; readonly artifactSizeBytes: number;
  readonly embeddingModel: import("../../../application/ports/context-management").ApprovedContextEmbeddingModelWitness;
  readonly sources: readonly {readonly artifactId: string; readonly digest: string}[];
  readonly publicSources: readonly {readonly reference: HeadlessContextSource; readonly digest: string}[];
}
export type CompileApprovedContextQuery = (owner: StructuredDocumentStore, request: HeadlessContextQueryPlanRequest,
  scope: HeadlessOperationScope) => Promise<CompiledApprovedContextQuery | undefined>;

type CompiledTraining = Extract<Awaited<ReturnType<PrepareHeadlessModelTrainingPlanUseCase["execute"]>>, {ok: true}>["prepared"];
/** Pure compilation plus metadata reads through this supplied transaction owner.
 * Never prepare bytes/files, initialize runtime or use an ambient/nested store. */
export type CompileApprovedTrainingMetadata = (owner: StructuredDocumentStore, request: HeadlessModelTrainingPlanRequest,
  scope: HeadlessOperationScope) => Promise<CompiledTraining | undefined>;

/** Legacy hosts remain explicitly unable to execute Model-containing plans. */
export async function prepareStructuredHeadlessPlanStep(...input: Parameters<typeof prepareStoredPlanStep>) {
  input[12] = false;
  input[13] = false;
  input[14] = undefined;
  const prepared = await prepareStoredPlanStep(...input);
  return prepared?.kind === "model-download" || prepared?.kind === "model-reference" || prepared?.kind === "model-training" ? undefined : prepared;
}

/** Internal opt-in owner; public hosts must not select it before their exact
 * Model admission/status/save composition is qualified. */
export async function prepareStructuredHeadlessPlanStepWithModels(...input: Parameters<typeof prepareStoredPlanStep>) {
  // Preserve the original download-only wrapper's omitted gate. A caller which
  // opts into reference saving must still be able to explicitly disable downloads.
  if (input[12] === undefined) input[12] = true;
  input[14] = undefined;
  const prepared = await prepareStoredPlanStep(...input);
  return prepared?.kind === "model-training" ? undefined : prepared;
}

/** Internal metadata protocol only. This advertises no route or runtime support.
 * Both older wrappers discard this compiler and refuse the whole training plan. */
export async function prepareStructuredHeadlessPlanStepWithTraining(...input: Parameters<typeof prepareStoredPlanStep>) {
  if (typeof input[14] !== "function" || types.isProxy(input[14])) return;
  return prepareStoredPlanStep(...input);
}

/** Prepare the stored request, then independently enforce the same exact plan inside the mutation transaction. */
async function prepareStoredPlanStep(
  documents: StructuredDocumentStore, query: StepQuery, authorize: Authorize, now: () => number = Date.now,
  publication: "serialized-owner" | "stable-reads" = "serialized-owner",
  allowLocalFileSave = false,
  publishProvider?: OwnedProviderPublication,
  compileDataset?: CompileApprovedDataset,
  compileResult?: CompileApprovedDatasetResult,
  compileContext?: CompileApprovedContext,
  contextResultRootDirectory?: string,
  compileQuery?: CompileApprovedContextQuery,
  allowModelDownload = false,
  allowModelReferenceSave = false,
  compileTraining?: CompileApprovedTrainingMetadata,
) {
  const { approvalRevision, step, isCurrent } = query;
  const target: HeadlessPlanReviewTarget = { ...query.target, scope: { ...query.target.scope } };
  const ownedTransaction = documents.runInOwnedTransaction?.bind(documents);
  const stableReads = documents.publishWithStableReads?.bind(documents);
  if (!ownedTransaction || documents.organizationId !== undefined || !isCurrent() ||
      (publication === "stable-reads" && !stableReads) ||
      !Number.isSafeInteger(step) || step < 1 || !Number.isSafeInteger(approvalRevision) || approvalRevision < 1) return;

  const timestampBefore = (deadline: number) => {
    const time = now();
    return Number.isSafeInteger(time) && time >= 0 && time < deadline;
  };

  async function select(owner: StructuredDocumentStore) {
    if (!isCurrent() || !await authorize(owner, target.scope) || !isCurrent()) return;
    const partition = owner.forOrganization(target.scope.organizationId);
    const approved = await readStructuredApprovedPlan(partition, target, approvalRevision, step);
    if (!approved || !isCurrent() || !timestampBefore(approved.expiresAt)) return;
    if (!compileTraining && approved.requests.some(candidate => candidate.operation === "models.train")) return;
    if (allowModelDownload !== true && approved.requests.some(candidate => candidate.operation === "models.download")) return;
    if ((allowModelReferenceSave !== true || !contextResultRootDirectory) && approved.requests.some(candidate => candidate.operation === "models.save-download")) return;
    const request = approved.requests[step - 1];
    if (!request || (!allowLocalFileSave && approved.requests.some(candidate => candidate.operation === "data.save-local-source")) ||
        (!publishProvider && approved.requests.some(candidate => candidate.operation === "data.save-provider-source")) ||
        (!compileDataset && approved.requests.some(candidate => candidate.operation === "data.prepare-local-dataset")) ||
        (!compileResult && approved.requests.some(candidate => candidate.operation === "data.save-prepared-dataset")) ||
        (!compileContext && approved.requests.some(candidate => candidate.operation === "context.generate-pack" || candidate.operation === "context.generate-rag")) ||
        (!contextResultRootDirectory && approved.requests.some(candidate => candidate.operation === "context.save-result")) ||
        (!compileQuery && approved.requests.some(candidate => candidate.operation === "context.query")) ||
        ((request.operation === "data.save-local-source" || request.operation === "data.save-provider-source" ||
          request.operation === "data.prepare-local-dataset" || request.operation === "data.save-prepared-dataset" ||
          request.operation === "context.generate-pack" || request.operation === "context.generate-rag" || request.operation === "context.save-result" || request.operation === "context.query" || request.operation === "models.download" || request.operation === "models.save-download" || request.operation === "models.train") &&
          !await authorize(owner, target.scope, request))) return;
    for (let index = 0; index < step - 1; index++) {
      const previous = approved.requests[index];
      if (!previous) return;
      const previousTraining = approved.modelTrainings?.find(binding => binding.step === index + 1);
      const received = previous.operation === "models.train"
        ? previousTraining && (await inspectStructuredTrainingPlanTask(partition, trainingTaskEffect(target, previous,
          index + 1, approvalRevision, previousTraining))).kind === "accepted"
        : previous.operation === "models.save-download"
        ? (await inspectStructuredModelReferenceSave(partition, modelReferenceEffect(target, previous, index + 1, approvalRevision))).kind === "committed"
        : previous.operation === "models.download"
        ? (await inspectStructuredModelPlanTask(partition, modelTaskEffect(target, previous, index + 1, approvalRevision))).kind === "accepted"
        : previous.operation === "data.save-local-source"
        ? await readCommittedStructuredLocalFilePlanEffect(partition, localFileEffect(target, previous, index + 1))
        : previous.operation === "data.save-provider-source"
          ? await readCommittedStructuredProviderFilePlanEffect(partition, providerFileEffect(target, previous, index + 1))
          : previous.operation === "data.prepare-local-dataset"
            ? (await inspectStructuredDatasetPlanTask(partition, datasetTaskEffect(target, previous, index + 1, approvalRevision))).kind === "accepted"
            : previous.operation === "data.save-prepared-dataset"
              ? await readCommittedStructuredDatasetResult(partition, datasetResultEffect(target, previous, index + 1, approvalRevision))
            : previous.operation === "context.generate-pack" || previous.operation === "context.generate-rag" || previous.operation === "context.query"
              ? (await inspectStructuredContextPlanTask(partition, contextTaskEffect(target, previous, index + 1, approvalRevision))).kind === "accepted"
            : previous.operation === "context.save-result"
              ? await readCommittedStructuredContextResult(partition, contextResultRootDirectory!, contextResultEffect(target, previous, index + 1, approvalRevision))
          : await hasStructuredHeadlessOperationReceipt(partition, target.scope, previous.operation,
          stepKey(target, previous, index + 1), sum(serializeHeadlessMutationInput(previous)));
      if (!received) return;
      if (!isCurrent() || !timestampBefore(approved.expiresAt)) return;
    }
    const contextModel = approved.contextModels.find(binding => binding.step === step)?.model;
    if (request.operation === "context.generate-rag" && !contextModel) return;
    if (request.operation === "models.download" && approved.modelDownloads.find(binding => binding.step === step)?.manifestDigest !==
        request.input.sourceManifest.manifestDigest) return;
    const trainingBinding = approved.modelTrainings?.find(binding => binding.step === step);
    if (request.operation === "models.train" && !trainingBinding) return;
    return { request, expiresAt: approved.expiresAt, contextModel, trainingBinding };
  }

  let deadline: number | undefined;
  const current = () => isCurrent() && (deadline === undefined || timestampBefore(deadline));
  let prepared: Awaited<ReturnType<typeof select>>;
  try {
    prepared = await ownedTransaction(async owner => {
      const result = await select(owner);
      deadline = result?.expiresAt;
      return result;
    }, () => {
      if (!current()) throw new Error("The approved plan step is no longer current.");
    });
  } catch { return; }
  if (!prepared || !current()) return;
  const { request } = prepared;
  const key = stepKey(target, request, step);
  const fingerprint = sum(serializeHeadlessMutationInput(request));

  async function publishIfCurrent(publish: () => boolean, verify?: (owner: StructuredDocumentStore) => Promise<boolean>) {
    if (!current()) return false;
    try {
      async function approvedForPublication(owner: StructuredDocumentStore) {
        const latest = await select(owner);
        return Boolean(latest && latest.expiresAt === deadline &&
          (!verify || await verify(owner.forOrganization(target.scope.organizationId))) && current());
      }
      const send = () => current() && publish();
      if (publication === "stable-reads") return await stableReads!(approvedForPublication, send);
      return await ownedTransaction!(async owner => await approvedForPublication(owner) && send(), () => {});
    } catch { return false; }
  }

  if (request.operation === "models.train") {
    if (!prepared.trainingBinding || !compileTraining) return;
    const trainingRequest = freezeModelData(structuredClone(request));
    const trainingScope = freezeModelData(structuredClone(target.scope));
    const binding = freezeModelData(structuredClone(prepared.trainingBinding));
    const effect = trainingTaskEffect(freezeModelData(structuredClone(target)), trainingRequest, step, approvalRevision, binding);
    const proposalDigest = binding.proposalDigest;
    const protect = () => {if (!current()) throw new Error("The approved training request ended.");};
    let originalTaskId: string | undefined, issueAttempted = false, issueInFlight = false, issuedKnown = false, issueUnconfirmed = false;
    let outcome: "none" | "accepted" | "not-started" | "unconfirmed" = "none";
    const outcomeNow = (): "none" | "accepted" | "not-started" | "unconfirmed" => outcome;
    async function authorizedRecord(owner: StructuredDocumentStore, fresh = false) {
      const selected = await select(owner);
      if (!selected || selected.expiresAt !== deadline || selected.request.operation !== "models.train" ||
          !isDeepStrictEqual(selected.trainingBinding, binding) || !current()) return;
      if (fresh) {
        const compiled = await compileTraining!(owner, trainingRequest, trainingScope);
        if (!current() || !matchesTrainingMetadata(compiled, trainingRequest, binding) ||
            !await authorize(owner, target.scope, trainingRequest) || !current()) return;
      }
      return owner.forOrganization(target.scope.organizationId);
    }
    return {kind: "model-training" as const, request: freezeModelData(structuredClone(request)),
      binding: freezeModelData(structuredClone(binding)), scope: freezeModelData(structuredClone(target.scope)),
      selection: Object.freeze({hostIncarnationId: target.hostIncarnationId, workspaceId: target.scope.workspaceId,
        fingerprint: target.fingerprint, approvalRevision, step}),
      expiresAt: prepared.expiresAt, isCurrent: current,
      // Local original-reservation lifetime only: not an issue ACK, fresh async
      // policy/metadata check or native proof. Historical queries stay separate.
      isStartCurrent: () => current() && originalTaskId !== undefined && !issueInFlight && !issueUnconfirmed &&
        (!issueAttempted || issuedKnown) && outcomeNow() === "none",
      async stillAllowed() {
        try {return await ownedTransaction(async owner => Boolean(await authorizedRecord(owner)), protect);} catch {return false;}
      },
      async inspect() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner);
          return partition ? inspectStructuredTrainingPlanTask(partition, effect) : undefined;
        }, protect);} catch {return undefined;}
      },
      async reserve() {
        try {
          const reserved = await ownedTransaction(async owner => {
            const partition = await authorizedRecord(owner); if (!partition) return;
            const previous = await inspectStructuredTrainingPlanTask(partition, effect);
            if (previous.kind !== "absent") return previous;
            if (!await authorizedRecord(owner, true) || !current() ||
                !await fenceStructuredApprovedPlan(partition, target, approvalRevision) || !current()) return;
            return reserveStructuredTrainingPlanTask(partition, effect, proposalDigest, now());
          }, protect);
          if (reserved?.kind === "new") {originalTaskId = reserved.taskId; return {...reserved, proposalDigest};}
          return reserved;
        } catch {return undefined;}
      },
      async issue(taskId: string, expectedProposalDigest: string): Promise<"issued" | "denied" | "unconfirmed"> {
        if (originalTaskId !== taskId || expectedProposalDigest !== proposalDigest) return "denied";
        if (outcome !== "none") return "denied";
        if (issueAttempted) return "unconfirmed";
        issueAttempted = true; issueInFlight = true;
        try {
          const result = await ownedTransaction(async owner => {
            const partition = await authorizedRecord(owner, true);
            if (!partition || !current() || !await fenceStructuredApprovedPlan(partition, target, approvalRevision) || !current()) return "denied" as const;
            return await issueStructuredTrainingPlanTask(partition, effect, taskId, proposalDigest, now()) ? "issued" as const : "unconfirmed" as const;
          }, protect);
          const terminal = outcomeNow();
          if (terminal !== "none") {
            issuedKnown = false; issueUnconfirmed = terminal !== "not-started";
            return terminal === "not-started" ? "denied" : "unconfirmed";
          }
          issuedKnown = result === "issued"; issueUnconfirmed = result === "unconfirmed";
          return result;
        } catch {issueUnconfirmed = true; return "unconfirmed";}
        finally {issueInFlight = false;}
      },
      async accept(taskId: string) {
        if (originalTaskId !== taskId || issueInFlight || !issuedKnown || issueUnconfirmed) return false;
        if (outcome === "accepted") return true;
        if (outcome !== "none") return false;
        outcome = "unconfirmed";
        try {
          const accepted = await ownedTransaction(owner => acceptStructuredTrainingPlanTask(
            owner.forOrganization(target.scope.organizationId), effect, taskId, now()), () => {});
          if (accepted) outcome = "accepted";
          return accepted;
        } catch {return false;}
      },
      async recordNotStarted(taskId: string, expectedProposalDigest: string) {
        if (originalTaskId !== taskId || expectedProposalDigest !== proposalDigest || issueInFlight || issueUnconfirmed) return false;
        if (outcome === "not-started") return true;
        if (outcome !== "none") return false;
        outcome = "unconfirmed";
        try {
          const recorded = await ownedTransaction(owner => recordStructuredTrainingTaskNotStarted(
            owner.forOrganization(target.scope.organizationId), effect, taskId, proposalDigest, now()), () => {});
          if (recorded) outcome = "not-started";
          return recorded;
        } catch {return false;}
      },
      async readReceipt() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner); if (!partition) return;
          const value = await inspectStructuredTrainingPlanTask(partition, effect);
          return value.kind === "accepted" ? value.reference : undefined;
        }, protect);} catch {return undefined;}
      },
      publishIfCurrent(publish: () => boolean) {
        return publishIfCurrent(publish, async partition => (await inspectStructuredTrainingPlanTask(partition, effect)).kind === "accepted");
      },
    };
  }

  if (request.operation === "models.save-download") {
    const effect = captureModelReferenceSaveEffect(modelReferenceEffect(target, request, step, approvalRevision));
    return {kind: "model-reference" as const, request: freezeModelData(structuredClone(request)), effect,
      expiresAt: prepared.expiresAt, isCurrent: current,
      async authorizeSaveOwned(owner: StructuredDocumentStore, selected: ModelReferenceSaveEffect) {
        if (!isDeepStrictEqual(selected, effect) || !current()) return false;
        const latest = await select(owner);
        return Boolean(latest && latest.expiresAt === deadline && current() &&
          await fenceStructuredApprovedPlan(owner.forOrganization(target.scope.organizationId), target, approvalRevision) && current());
      },
      async stillAllowed() {
        try {return await ownedTransaction(async owner => Boolean(await select(owner)) && current(),
          () => {if (!current()) throw new Error("The approved Model reference save ended.");});} catch {return false;}
      },
      publishIfCurrent(publish: () => boolean) {
        return publishIfCurrent(publish, async partition => (await inspectStructuredModelReferenceSave(partition, effect)).kind === "committed");
      },
    };
  }

  if (request.operation === "models.download") {
    const effect = modelTaskEffect(target, request, step, approvalRevision);
    const sourceDigest = request.input.sourceManifest.manifestDigest.slice("sha256:".length);
    const protect = () => {if (!current()) throw new Error("The approved Model download ended.");};
    async function authorizedRecord(owner: StructuredDocumentStore) {
      const selected = await select(owner);
      return selected && selected.expiresAt === deadline && current() ? owner.forOrganization(target.scope.organizationId) : undefined;
    }
    return {kind: "model-download" as const, request: freezeModelData(structuredClone(request)),
      scope: freezeModelData(structuredClone(target.scope)),
      selection: Object.freeze({hostIncarnationId: target.hostIncarnationId, workspaceId: target.scope.workspaceId,
        fingerprint: target.fingerprint, approvalRevision, step}),
      expiresAt: prepared.expiresAt, isCurrent: current,
      async stillAllowed() {
        try {return await ownedTransaction(async owner => Boolean(await authorizedRecord(owner)), protect);} catch {return false;}
      },
      async inspect() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner);
          return partition ? inspectStructuredModelPlanTask(partition, effect) : undefined;
        }, protect);} catch {return undefined;}
      },
      async reserve() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner); if (!partition) return;
          const previous = await inspectStructuredModelPlanTask(partition, effect);
          if (previous.kind !== "absent") return previous;
          if (!await fenceStructuredApprovedPlan(partition, target, approvalRevision) || !current()) return;
          const reserved = await reserveStructuredModelPlanTask(partition, effect, sourceDigest, now());
          return reserved.kind === "new" ? {...reserved, sourceDigest} : reserved;
        }, protect);} catch {return undefined;}
      },
      async issue(taskId: string, expectedSourceDigest: string): Promise<"issued" | "denied" | "unconfirmed"> {
        try {
          const issued = await ownedTransaction(async owner => {
            const partition = await authorizedRecord(owner);
            if (!partition || expectedSourceDigest !== sourceDigest || !current() ||
                !await fenceStructuredApprovedPlan(partition, target, approvalRevision)) return false;
            return issueStructuredModelPlanTask(partition, effect, taskId, sourceDigest, now());
          }, protect);
          return issued ? "issued" : "denied";
        } catch {return "unconfirmed";}
      },
      async accept(taskId: string) {
        try {return await ownedTransaction(owner => acceptStructuredModelPlanTask(owner.forOrganization(target.scope.organizationId),
          effect, taskId, now()), () => {});} catch {return false;}
      },
      async recordNotStarted(taskId: string, expectedSourceDigest: string) {
        if (expectedSourceDigest !== sourceDigest) return false;
        try {return await ownedTransaction(owner => recordStructuredModelTaskNotStarted(owner.forOrganization(target.scope.organizationId),
          effect, taskId, sourceDigest, now()), () => {});} catch {return false;}
      },
      async readReceipt() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner); if (!partition) return;
          const value = await inspectStructuredModelPlanTask(partition, effect);
          return value.kind === "accepted" ? value.reference : undefined;
        }, protect);} catch {return undefined;}
      },
      publishIfCurrent(publish: () => boolean) {
        return publishIfCurrent(publish, async partition => (await inspectStructuredModelPlanTask(partition, effect)).kind === "accepted");
      },
    };
  }

  if (request.operation === "context.save-result") {
    const effect = contextResultEffect(target, request, step, approvalRevision);
    return {kind: "context-result" as const, request: structuredClone(request), effect: structuredClone(effect),
      expiresAt: prepared.expiresAt, isCurrent: current,
      async authorizeSaveOwned(owner: StructuredDocumentStore, selected: ContextResultSaveEffect) {
        if (!isDeepStrictEqual(selected, effect) || !current()) return false;
        const latest = await select(owner);
        return Boolean(latest && latest.expiresAt === deadline && current() &&
          await fenceStructuredApprovedPlan(owner.forOrganization(target.scope.organizationId), target, approvalRevision) && current());
      },
      async stillAllowed() {
        try {return await ownedTransaction(async owner => Boolean(await select(owner)) && current(),
          () => {if (!current()) throw new Error("The approved Context save ended.");});} catch {return false;}
      },
      publishIfCurrent(publish: () => boolean) {
        return publishIfCurrent(publish, async partition => Boolean(await readCommittedStructuredContextResult(partition, contextResultRootDirectory!, effect)));
      },
    };
  }

  if (request.operation === "data.save-local-source") {
    const effect = localFileEffect(target, request, step);
    const protect = () => {
      if (!current()) throw new Error("The approved local file step is no longer current.");
    };
    const issuePublication: NonNullable<IngestionFilePublicationAdmission["issue"]> = (input, expected) => {
      const next = normalizeIngestionFilePublication(input);
      const checkpointDeadline = Date.parse(next.checkpointExpiresAt ?? "");
      function protectIssue() {
        protect();
        if (!timestampBefore(checkpointDeadline)) publicationUnavailable();
      }
      return ownedTransaction(async owner => {
        protectIssue();
        const confirmed = await select(owner);
        if (!confirmed || confirmed.expiresAt !== deadline || !current()) publicationUnavailable();
        const partition = owner.forOrganization(target.scope.organizationId);
        if (!await fenceStructuredApprovedPlan(partition, target, approvalRevision)) publicationUnavailable();
        return issueStructuredLocalFilePlanEffect(partition, effect, next, expected, now());
      }, protectIssue);
    };
    return { kind: "local-file" as const, request: structuredClone(request),
      isCurrent: current, expiresAt: prepared.expiresAt, issuePublication,
      async inspect() {
        return ownedTransaction(async owner => {
          if (!(await select(owner)) || !current()) return;
          const partition = owner.forOrganization(target.scope.organizationId);
          if (!await matchesStructuredHeadlessLocalFileSelection(partition, effect.selection)) return;
          const receipt = await readCommittedStructuredLocalFilePlanEffect(partition, effect);
          if (receipt) return { kind: "replayed" as const, receipt };
          const projected = await readStructuredHeadlessLocalFileSelection(partition, effect.selection, now);
          if (projected?.ok) return { kind: "staged" as const, preview: projected.value };
        }, protect);
      },
      async stillAllowed() {
        return ownedTransaction(async owner => Boolean(await select(owner)) && current() &&
          await matchesStructuredHeadlessLocalFileSelection(owner.forOrganization(target.scope.organizationId), effect.selection), protect);
      },
      async readReceipt() {
        return ownedTransaction(async owner => (await select(owner)) && current()
          ? readCommittedStructuredLocalFilePlanEffect(owner.forOrganization(target.scope.organizationId), effect)
          : undefined, protect);
      },
      publishIfCurrent(publish: () => boolean) {
        return publishIfCurrent(publish, async partition =>
          await matchesStructuredHeadlessLocalFileSelection(partition, effect.selection) &&
          Boolean(await readCommittedStructuredLocalFilePlanEffect(partition, effect)));
      },
    };
  }

  if (request.operation === "data.save-provider-source") {
    if (!publishProvider) return;
    const effect = providerFileEffect(target, request, step);
    let selectionDeadline: number | undefined;
    const protect = () => {
      if (!current()) throw new Error("The approved provider file step is no longer current.");
    };
    const protectPublication = () => {
      protect();
      if (selectionDeadline === undefined || !timestampBefore(selectionDeadline))
        throw new Error("The approved provider selection expired.");
    };
    return { kind: "provider-file" as const, request: structuredClone(request),
      isCurrent: current, expiresAt: prepared.expiresAt,
      async inspect() {
        return ownedTransaction(async owner => {
          if (!await select(owner) || !current()) return;
          const partition = owner.forOrganization(target.scope.organizationId);
          const receipt = await readCommittedStructuredProviderFilePlanEffect(partition, effect);
          if (receipt) return { kind: "replayed" as const, receipt: receipt.reference };
          const projected = await readStructuredHeadlessProviderFileSelection(partition, effect.selection, now);
          if (projected?.ok) {
            selectionDeadline = projected.value.selectionExpiresAt;
            return { kind: "staged" as const, preview: projected.value };
          }
        }, protect);
      },
      async stillAllowed() {
        return ownedTransaction(async owner => Boolean(await select(owner)) && current() &&
          await matchesStructuredHeadlessProviderFileSelection(owner.forOrganization(target.scope.organizationId), effect.selection), protect);
      },
      async publish(...input: Parameters<NonNullable<IngestionAcquisitionRepositoryPort["saveTaskWithProviderArtifact"]>>) {
        protectPublication();
        return ownedTransaction(async owner => {
          if (!await select(owner) || !current()) throw new Error("The approved provider import ended.");
          const partition = owner.forOrganization(target.scope.organizationId);
          if (!await fenceStructuredApprovedPlan(partition, target, approvalRevision))
            throw new Error("The approved provider import ended.");
          return publishStructuredProviderFilePlanEffect(partition, effect, publishProvider, input, now);
        }, protectPublication);
      },
      async readReceipt() {
        return ownedTransaction(async owner => {
          if (!await select(owner) || !current()) return;
          return (await readCommittedStructuredProviderFilePlanEffect(owner.forOrganization(target.scope.organizationId), effect))?.reference;
        }, protect);
      },
      publishIfCurrent(publish: () => boolean) {
        return publishIfCurrent(publish, async partition => Boolean(await readCommittedStructuredProviderFilePlanEffect(partition, effect)));
      },
    };
  }

  if (request.operation === "data.save-prepared-dataset") {
    const effect = datasetResultEffect(target, request, step, approvalRevision);
    const protect = () => {if (!current()) throw new Error("The approved dataset save ended.");};
    const resultDigest = (compiled: PreparedLocalDatasetResultInputs) => {
      const {saveAvailable: _availability, ...review} = compiled.review;
      return sum(JSON.stringify([compiled.admittedSourceDigest, review, request.input.outputBaseName]));
    };
    async function authorizedRecord(owner: StructuredDocumentStore) {
      const selected = await select(owner);
      return selected && selected.expiresAt === deadline && current() ? owner.forOrganization(target.scope.organizationId) : undefined;
    }
    return {
      kind: "dataset-result" as const, request: structuredClone(request), expiresAt: prepared.expiresAt, isCurrent: current,
      async stillAllowed() {
        try {return await ownedTransaction(async owner => Boolean(await authorizedRecord(owner)), protect);} catch {return false;}
      },
      async inspect() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner);
          return partition ? inspectStructuredDatasetResultSave(partition, effect) : undefined;
        }, protect);} catch {return undefined;}
      },
      async reserve() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner); if (!partition) return;
          const existing = await inspectStructuredDatasetResultSave(partition, effect);
          if (existing.kind !== "absent") return existing;
          const compiled = await compileResult!(owner, request, target.scope);
          if (!compiled?.review.saveAvailable || !current() || !await fenceStructuredApprovedPlan(partition, target, approvalRevision)) return;
          const sourceDigest = resultDigest(compiled);
          const reserved = await reserveStructuredDatasetResultSave(partition, effect, compiled.review, sourceDigest, now());
          return reserved.kind === "new" ? {...reserved, sourceDigest} : reserved;
        }, protect);} catch {return undefined;}
      },
      async issue(saveId: string, expectedSourceDigest: string): Promise<"issued" | "denied" | "unconfirmed"> {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner); if (!partition) return "denied" as const;
          const compiled = await compileResult!(owner, request, target.scope);
          if (!compiled || resultDigest(compiled) !== expectedSourceDigest || !current() ||
              !await fenceStructuredApprovedPlan(partition, target, approvalRevision)) return "denied" as const;
          return await issueStructuredDatasetResultSave(partition, effect, saveId, expectedSourceDigest, now())
            ? "issued" as const : "unconfirmed" as const;
        }, protect);} catch {return "unconfirmed";}
      },
      async commit(saveId: string, expectedSourceDigest: string, version: DatasetVersionRecord) {
        try {
          return await ownedTransaction(async owner => {
            const partition = await authorizedRecord(owner); if (!partition) throw new Error("Dataset publication is unavailable.");
            const compiled = await compileResult!(owner, request, target.scope);
            if (!compiled || resultDigest(compiled) !== expectedSourceDigest || !current() ||
                !await fenceStructuredApprovedPlan(partition, target, approvalRevision)) throw new Error("Dataset publication is unavailable.");
            return commitStructuredDatasetResultSave(partition, effect, saveId, expectedSourceDigest, version, now());
          }, protect);
        } catch {
          // One read-only reconciliation of this private attempt may confirm a
          // lost acknowledgement. It never retries publication or adopts an
          // ordinary version, and grants no authority to release a response.
          return ownedTransaction(async owner => {
            const partition = owner.forOrganization(target.scope.organizationId);
            const reference = await readCommittedStructuredDatasetResult(partition, effect, {saveId, sourceDigest: expectedSourceDigest});
            if (!reference || reference.versionId !== version.versionId || reference.versionDigest !== version.versionDigest)
              throw new Error("Dataset publication is unconfirmed.");
            const stored = await createStructuredDatasetVersionRepository(partition).readVersion(target.scope.workspaceId, reference.versionId);
            if (!stored) throw new Error("Dataset publication is unconfirmed.");
            return {version: stored, created: false};
          }, () => {});
        }
      },
      async readReceipt() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner);
          return partition ? readCommittedStructuredDatasetResult(partition, effect) : undefined;
        }, protect);} catch {return undefined;}
      },
      publishIfCurrent(publish: () => boolean) {
        return publishIfCurrent(publish, async partition => Boolean(await readCommittedStructuredDatasetResult(partition, effect)));
      },
    };
  }

  if (request.operation === "data.prepare-local-dataset") {
    const effect = datasetTaskEffect(target, request, step, approvalRevision);
    const protect = () => {if (!current()) throw new Error("The approved dataset step ended.");};
    const sourceDigest = (compiled: CompiledDataset) => sum(JSON.stringify([compiled.command, compiled.admissionSources]));
    async function authorizedRecord(owner: StructuredDocumentStore) {
      const selected = await select(owner);
      if (!selected || selected.expiresAt !== deadline || !current()) return;
      return owner.forOrganization(target.scope.organizationId);
    }
    return {
      kind: "local-dataset" as const, request: structuredClone(request), expiresAt: prepared.expiresAt,
      isCurrent: current,
      async stillAllowed() {
        try {return await ownedTransaction(async owner => Boolean(await authorizedRecord(owner)), protect);}
        catch {return false;}
      },
      async inspect() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner);
          return partition ? inspectStructuredDatasetPlanTask(partition, effect) : undefined;
        }, protect);} catch {return undefined;}
      },
      async reserve() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner);
          if (!partition) return;
          const previous = await inspectStructuredDatasetPlanTask(partition, effect);
          if (previous.kind !== "absent") return previous;
          const compiled = await compileDataset!(owner, request, target.scope);
          if (!compiled || !current()) return;
          if (!await fenceStructuredApprovedPlan(partition, target, approvalRevision)) return;
          const digest = sourceDigest(compiled);
          const reserved = await reserveStructuredDatasetPlanTask(partition, effect, digest, now());
          return reserved.kind === "new" ? {...reserved, compiled, sourceDigest: digest} : reserved;
        }, protect);} catch {return undefined;}
      },
      async issue(taskId: string, expectedSourceDigest: string): Promise<"issued" | "denied" | "unconfirmed"> {
        try {
          const issued = await ownedTransaction(async owner => {
            const partition = await authorizedRecord(owner);
            if (!partition) return false;
            const compiled = await compileDataset!(owner, request, target.scope);
            if (!compiled || sourceDigest(compiled) !== expectedSourceDigest || !current() ||
                !await fenceStructuredApprovedPlan(partition, target, approvalRevision)) return false;
            return issueStructuredDatasetPlanTask(partition, effect, taskId, expectedSourceDigest, now());
          }, protect);
          return issued ? "issued" : "denied";
        } catch {return "unconfirmed";}
      },
      async accept(taskId: string) {
        // Already admitted outcome recording does not depend on the caller's
        // continuing authority to see the result or approve another step.
        try {return await ownedTransaction(owner => acceptStructuredDatasetPlanTask(
          owner.forOrganization(target.scope.organizationId), effect, taskId, now()), () => {});}
        catch {return false;}
      },
      async readReceipt() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner);
          if (!partition) return;
          const result = await inspectStructuredDatasetPlanTask(partition, effect);
          return result.kind === "accepted" ? result.reference : undefined;
        }, protect);} catch {return undefined;}
      },
      publishIfCurrent(publish: () => boolean) {
        return publishIfCurrent(publish, async partition => (await inspectStructuredDatasetPlanTask(partition, effect)).kind === "accepted");
      },
    };
  }

  if (request.operation === "context.generate-pack" || request.operation === "context.generate-rag") {
    const effect = contextTaskEffect(target, request, step, approvalRevision);
    const approvedContextModel = prepared.contextModel;
    const protect = () => {if (!current()) throw new Error("The approved Context step ended.");};
    const sourceDigest = (compiled: CompiledContext) => sum(JSON.stringify(compiled.command.kind === "rag-database"
      ? [compiled.command, compiled.admissionSources, compiled.embeddingModel] : [compiled.command, compiled.admissionSources]));
    const matchesApprovedModel = (compiled: CompiledContext) => request.operation !== "context.generate-rag" ||
      Boolean(approvedContextModel && compiled.embeddingModel && JSON.stringify(compiled.embeddingModel) === JSON.stringify(approvedContextModel));
    async function authorizedRecord(owner: StructuredDocumentStore) {
      const selected = await select(owner);
      if (!selected || selected.expiresAt !== deadline || !current() ||
          JSON.stringify(selected.contextModel) !== JSON.stringify(approvedContextModel)) return;
      return owner.forOrganization(target.scope.organizationId);
    }
    return {
      kind: "context-pack" as const, request: structuredClone(request), expiresAt: prepared.expiresAt,
      isCurrent: current,
      async stillAllowed() {
        try {return await ownedTransaction(async owner => Boolean(await authorizedRecord(owner)), protect);}
        catch {return false;}
      },
      async validateInputs() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner);
          if (!partition) return false;
          const compiled = await compileContext!(owner, request, target.scope);
          return Boolean(compiled && matchesApprovedModel(compiled) && current());
        }, protect);} catch {return false;}
      },
      async inspect() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner);
          return partition ? inspectStructuredContextPlanTask(partition, effect) : undefined;
        }, protect);} catch {return undefined;}
      },
      async reserve() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner);
          if (!partition) return;
          const previous = await inspectStructuredContextPlanTask(partition, effect);
          if (previous.kind !== "absent") return previous;
          const compiled = await compileContext!(owner, request, target.scope);
          if (!compiled || !matchesApprovedModel(compiled) || !current()) return;
          if (!await fenceStructuredApprovedPlan(partition, target, approvalRevision)) return;
          const digest = sourceDigest(compiled);
          const reserved = await reserveStructuredContextPlanTask(partition, effect, digest, now());
          return reserved.kind === "new" ? {...reserved, compiled, sourceDigest: digest} : reserved;
        }, protect);} catch {return undefined;}
      },
      async issue(taskId: string, expectedSourceDigest: string): Promise<"issued" | "denied" | "unconfirmed"> {
        try {
          const issued = await ownedTransaction(async owner => {
            const partition = await authorizedRecord(owner);
            if (!partition) return false;
            const compiled = await compileContext!(owner, request, target.scope);
            if (!compiled || !matchesApprovedModel(compiled) || sourceDigest(compiled) !== expectedSourceDigest || !current() ||
                !await fenceStructuredApprovedPlan(partition, target, approvalRevision)) return false;
            return issueStructuredContextPlanTask(partition, effect, taskId, expectedSourceDigest, now());
          }, protect);
          return issued ? "issued" : "denied";
        } catch {return "unconfirmed";}
      },
      async accept(taskId: string) {
        // Already admitted outcome recording does not depend on the caller's
        // continuing authority to see the result or approve another step.
        try {return await ownedTransaction(owner => acceptStructuredContextPlanTask(
          owner.forOrganization(target.scope.organizationId), effect, taskId, now()), () => {});}
        catch {return false;}
      },
      async recordNotStarted(taskId: string, sourceDigest: string) {
        // Record this already observed owning-call outcome after revocation as
        // well. It never grants another start or outward disclosure authority.
        try {return await ownedTransaction(owner => recordStructuredContextTaskNotStarted(
          owner.forOrganization(target.scope.organizationId), effect, taskId, sourceDigest, now()), () => {});}
        catch {return false;}
      },
      async readReceipt() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner);
          if (!partition) return;
          const result = await inspectStructuredContextPlanTask(partition, effect);
          return result.kind === "accepted" ? result.reference : undefined;
        }, protect);} catch {return undefined;}
      },
      publishIfCurrent(publish: () => boolean) {
        return publishIfCurrent(publish, async partition => (await inspectStructuredContextPlanTask(partition, effect)).kind === "accepted");
      },
    };
  }

  if (request.operation === "context.query") {
    const effect = contextTaskEffect(target, request, step, approvalRevision);
    const protect = () => {if (!current()) throw new Error("The approved Context step ended.");};
    const sourceDigest = (compiled: CompiledApprovedContextQuery) => sum(JSON.stringify(compiled));
    async function authorizedRecord(owner: StructuredDocumentStore) {
      const selected = await select(owner);
      if (!selected || selected.expiresAt !== deadline || !current()) return;
      return owner.forOrganization(target.scope.organizationId);
    }
    return {
      kind: "context-query" as const, request: structuredClone(request), expiresAt: prepared.expiresAt,
      isCurrent: current,
      async stillAllowed() {
        try {return await ownedTransaction(async owner => Boolean(await authorizedRecord(owner)), protect);}
        catch {return false;}
      },
      async validateInputs() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner);
          if (!partition) return false;
          const compiled = await compileQuery!(owner, request, target.scope);
          return Boolean(compiled && current());
        }, protect);} catch {return false;}
      },
      async inspect() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner);
          return partition ? inspectStructuredContextPlanTask(partition, effect) : undefined;
        }, protect);} catch {return undefined;}
      },
      async reserve() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner);
          if (!partition) return;
          const previous = await inspectStructuredContextPlanTask(partition, effect);
          if (previous.kind !== "absent") return previous;
          const compiled = await compileQuery!(owner, request, target.scope);
          if (!compiled || !current()) return;
          if (!await fenceStructuredApprovedPlan(partition, target, approvalRevision)) return;
          const digest = sourceDigest(compiled);
          const reserved = await reserveStructuredContextPlanTask(partition, effect, digest, now());
          return reserved.kind === "new" ? {...reserved, compiled, sourceDigest: digest} : reserved;
        }, protect);} catch {return undefined;}
      },
      async issue(taskId: string, expectedSourceDigest: string): Promise<"issued" | "denied" | "unconfirmed"> {
        try {
          const issued = await ownedTransaction(async owner => {
            const partition = await authorizedRecord(owner);
            if (!partition) return false;
            const compiled = await compileQuery!(owner, request, target.scope);
            if (!compiled || sourceDigest(compiled) !== expectedSourceDigest || !current() ||
                !await fenceStructuredApprovedPlan(partition, target, approvalRevision)) return false;
            return issueStructuredContextPlanTask(partition, effect, taskId, expectedSourceDigest, now());
          }, protect);
          return issued ? "issued" : "denied";
        } catch {return "unconfirmed";}
      },
      async accept(taskId: string) {
        // Already admitted outcome recording does not depend on the caller's
        // continuing authority to see the result or approve another step.
        try {return await ownedTransaction(owner => acceptStructuredContextPlanTask(
          owner.forOrganization(target.scope.organizationId), effect, taskId, now()), () => {});}
        catch {return false;}
      },
      async recordNotStarted(taskId: string, sourceDigest: string) {
        // Record this already observed owning-call outcome after revocation as
        // well. It never grants another start or outward disclosure authority.
        try {return await ownedTransaction(owner => recordStructuredContextTaskNotStarted(
          owner.forOrganization(target.scope.organizationId), effect, taskId, sourceDigest, now()), () => {});}
        catch {return false;}
      },
      async readReceipt() {
        try {return await ownedTransaction(async owner => {
          const partition = await authorizedRecord(owner);
          if (!partition) return;
          const result = await inspectStructuredContextPlanTask(partition, effect);
          return result.kind === "accepted" ? result.reference : undefined;
        }, protect);} catch {return undefined;}
      },
      publishIfCurrent(publish: () => boolean) {
        return publishIfCurrent(publish, async partition => (await inspectStructuredContextPlanTask(partition, effect)).kind === "accepted");
      },
    };
  }

  const normalOperations = createStructuredHeadlessOperationStore(documents, now, {
    async authorize(owner, scope, operation) {
      if (!current() || !sameScope(scope, target.scope) || operation !== request.operation) return false;
      const confirmed = await select(owner);
      return Boolean(confirmed && current() && confirmed.expiresAt === deadline &&
        confirmed.request.operation === operation && stepKey(target, confirmed.request, step) === key &&
        sum(serializeHeadlessMutationInput(confirmed.request)) === fingerprint);
    },
    async fenceMutation(owner) {
      return current() && await fenceStructuredApprovedPlan(owner.forOrganization(target.scope.organizationId), target, approvalRevision);
    },
  });
  const operations: Pick<HeadlessOperationStorePort, "run"> = {
    async run(input) {
      if (!current() || !input.isCurrent() || !sameScope(input.scope, target.scope) || input.operation !== request.operation ||
          input.key !== request.input.idempotencyKey || input.fingerprint !== fingerprint) return denied;
      return normalOperations.run({ ...input, key, isCurrent: () => current() && input.isCurrent() });
    },
  };
  return {
    kind: "system" as const,
    request: structuredClone(request), isCurrent: current, operations, expiresAt: prepared.expiresAt,
    publishIfCurrent: (publish: () => boolean) => publishIfCurrent(publish),
  };
}

function sameScope(left: HeadlessOperationScope, right: HeadlessOperationScope) {
  return left.organizationId === right.organizationId && left.workspaceId === right.workspaceId &&
    left.principalId === right.principalId && left.registeredClientId === right.registeredClientId;
}

function sum(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }

function stepKey(target: HeadlessPlanReviewTarget, request: HeadlessBuildPlanRequest, step: number) {
  const family = request.operation === "models.train" ? "aisb-approved-model-training-step-v1" :
    request.operation === "models.save-download" ? "aisb-approved-model-reference-step-v1" :
    request.operation === "models.download" ? "aisb-approved-model-download-step-v1" :
    request.operation === "context.query" ? "aisb-approved-context-query-step-v1" :
    request.operation === "context.save-result" ? "aisb-approved-context-result-step-v1" :
    request.operation === "context.generate-rag" ? "aisb-approved-context-rag-step-v1" :
    request.operation === "context.generate-pack" ? "aisb-approved-context-pack-step-v1" :
    request.operation === "data.save-prepared-dataset" ? "aisb-approved-dataset-result-step-v1" :
    request.operation === "data.prepare-local-dataset" ? "aisb-approved-local-dataset-step-v1" :
    request.operation === "data.save-provider-source" ? "aisb-approved-provider-file-step-v1" :
    request.operation === "data.save-local-source" ? "aisb-approved-local-file-step-v1" : "aisb-approved-system-step-v1";
  const parts = [family, target.hostIncarnationId, target.fingerprint, step, request.input.idempotencyKey];
  const hex = sum(JSON.stringify(request.operation === "data.prepare-local-dataset" || request.operation === "data.save-prepared-dataset" ||
    request.operation === "context.generate-pack" || request.operation === "context.generate-rag" || request.operation === "context.save-result" || request.operation === "context.query" || request.operation === "models.download" || request.operation === "models.save-download" || request.operation === "models.train" ?
    [...parts, target.scope.organizationId, target.scope.workspaceId, target.scope.principalId, target.scope.registeredClientId] : parts));
  // Keep the existing validated internal UUID shape. The plan and ordinal
  // reserve a different key even when two proposals reuse a supplied key.
  return [hex.slice(0, 8), hex.slice(8, 12), "4" + hex.slice(13, 16),
    "8" + hex.slice(17, 20), hex.slice(20, 32)].join("-");
}

function modelTaskEffect(target: HeadlessPlanReviewTarget, request: HeadlessModelDownloadPlanRequest,
  step: number, approvalRevision: number): ModelPlanTaskEffect {
  return {key: stepKey(target, request, step), target, request, step, approvalRevision};
}
function trainingTaskEffect(target: HeadlessPlanReviewTarget, request: HeadlessModelTrainingPlanRequest,
  step: number, approvalRevision: number, binding: ModelTrainingReviewBinding): TrainingPlanTaskEffect {
  return {key: stepKey(target, request, step), target, request, step, approvalRevision, binding};
}
function matchesTrainingMetadata(value: unknown, request: HeadlessModelTrainingPlanRequest, stored: ModelTrainingReviewBinding): boolean {
  try {
    const row = readStrictPassiveRecord(copyHeadlessModelWorkflowData(value), ["request", "inputs", "proposalDigest",
      "trainingApprovalRequired", "resultSaveApprovalRequired", "installationPermission", "publicationPermission"]);
    if (Object.keys(row).length !== 7 || !isDeepStrictEqual(row.request, request) || row.trainingApprovalRequired !== true ||
        row.resultSaveApprovalRequired !== true || row.installationPermission !== "not-granted" || row.publicationPermission !== "not-granted") return false;
    const fresh = readModelTrainingReviewBindings([{step: 1, inputs: row.inputs, proposalDigest: row.proposalDigest}], [request])?.[0];
    // Compare every fact, preserving array order. The original stored encoding
    // and digest remain the effect identity even when fresh compilation is canonical.
    return Boolean(fresh && isDeepStrictEqual(fresh.inputs, stored.inputs));
  } catch {return false;}
}
function modelReferenceEffect(target: HeadlessPlanReviewTarget, request: HeadlessModelReferenceSavePlanRequest,
  step: number, approvalRevision: number): ModelReferenceSaveEffect {
  return {key: stepKey(target, request, step), target, step, approvalRevision, taskId: request.input.taskId,
    manifestDigest: request.input.sourceManifest.manifestDigest, name: request.input.name};
}
function freezeModelData<T>(value: T): T {
  if (value && typeof value === "object") {for (const child of Object.values(value)) freezeModelData(child); Object.freeze(value);}
  return value;
}

function contextTaskEffect(target: HeadlessPlanReviewTarget, request: HeadlessContextGenerationPlanRequest | HeadlessContextQueryPlanRequest,
  step: number, approvalRevision: number): ContextPlanTaskEffect {
  return {key: stepKey(target, request, step), target, request, step, approvalRevision};
}

function contextResultEffect(target: HeadlessPlanReviewTarget, request: HeadlessContextResultSavePlanRequest,
  step: number, approvalRevision: number): ContextResultSaveEffect {
  return {key: stepKey(target, request, step), target, step, approvalRevision,
    taskId: request.input.taskId, reportFingerprint: request.input.reportFingerprint};
}

function datasetTaskEffect(target: HeadlessPlanReviewTarget, request: HeadlessLocalDatasetPlanRequest,
  step: number, approvalRevision: number): DatasetPlanTaskEffect {
  return {key: stepKey(target, request, step), target, request, step, approvalRevision};
}

function datasetResultEffect(target: HeadlessPlanReviewTarget, request: HeadlessDatasetResultSavePlanRequest,
  step: number, approvalRevision: number): DatasetResultSaveEffect {
  return {key: stepKey(target, request, step), target, request, step, approvalRevision};
}

function localFileEffect(target: HeadlessPlanReviewTarget, request: HeadlessLocalFileSavePlanRequest, step: number): LocalFilePlanEffect {
  const { idempotencyKey: _key, ...selected } = request.input;
  const { organizationId, principalId, registeredClientId } = target.scope;
  return { key: stepKey(target, request, step), selection: { organizationId, principalId, registeredClientId, target: selected } };
}

function providerFileEffect(target: HeadlessPlanReviewTarget, request: HeadlessProviderFileSavePlanRequest, step: number): ProviderFilePlanEffect {
  const { idempotencyKey: _key, ...selected } = request.input;
  const { organizationId, principalId, registeredClientId } = target.scope;
  return { key: stepKey(target, request, step), selection: { organizationId, principalId, registeredClientId, target: selected } };
}
