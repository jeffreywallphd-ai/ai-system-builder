import { createHash } from "node:crypto";

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
  type HeadlessContextPackPlanRequest } from "../../../contracts/headless";
import {inspectStructuredDatasetResultSave, reserveStructuredDatasetResultSave, issueStructuredDatasetResultSave,
  commitStructuredDatasetResultSave, readCommittedStructuredDatasetResult, type DatasetResultSaveEffect} from "../ingestion/createStructuredHeadlessDatasetResultStore";
import {inspectStructuredDatasetPlanTask, reserveStructuredDatasetPlanTask, issueStructuredDatasetPlanTask,
  acceptStructuredDatasetPlanTask, type DatasetPlanTaskEffect} from "../ingestion/createStructuredHeadlessDatasetPlanTaskStore";
import {inspectStructuredContextPlanTask, reserveStructuredContextPlanTask, issueStructuredContextPlanTask,
  acceptStructuredContextPlanTask, type ContextPlanTaskEffect} from "./createStructuredHeadlessContextPlanTaskStore";
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
export type CompileApprovedContext = (owner: StructuredDocumentStore, request: HeadlessContextPackPlanRequest,
  scope: HeadlessOperationScope) => Promise<CompiledContext | undefined>;

/** Prepare the stored request, then independently enforce the same exact plan inside the mutation transaction. */
export async function prepareStructuredHeadlessPlanStep(
  documents: StructuredDocumentStore, query: StepQuery, authorize: Authorize, now: () => number = Date.now,
  publication: "serialized-owner" | "stable-reads" = "serialized-owner",
  allowLocalFileSave = false,
  publishProvider?: OwnedProviderPublication,
  compileDataset?: CompileApprovedDataset,
  compileResult?: CompileApprovedDatasetResult,
  compileContext?: CompileApprovedContext,
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
    const request = approved.requests[step - 1];
    if (!request || (!allowLocalFileSave && approved.requests.some(candidate => candidate.operation === "data.save-local-source")) ||
        (!publishProvider && approved.requests.some(candidate => candidate.operation === "data.save-provider-source")) ||
        (!compileDataset && approved.requests.some(candidate => candidate.operation === "data.prepare-local-dataset")) ||
        (!compileResult && approved.requests.some(candidate => candidate.operation === "data.save-prepared-dataset")) ||
        (!compileContext && approved.requests.some(candidate => candidate.operation === "context.generate-pack")) ||
        ((request.operation === "data.save-local-source" || request.operation === "data.save-provider-source" ||
          request.operation === "data.prepare-local-dataset" || request.operation === "data.save-prepared-dataset" ||
          request.operation === "context.generate-pack") &&
          !await authorize(owner, target.scope, request))) return;
    for (let index = 0; index < step - 1; index++) {
      const previous = approved.requests[index];
      if (!previous) return;
      const received = previous.operation === "data.save-local-source"
        ? await readCommittedStructuredLocalFilePlanEffect(partition, localFileEffect(target, previous, index + 1))
        : previous.operation === "data.save-provider-source"
          ? await readCommittedStructuredProviderFilePlanEffect(partition, providerFileEffect(target, previous, index + 1))
          : previous.operation === "data.prepare-local-dataset"
            ? (await inspectStructuredDatasetPlanTask(partition, datasetTaskEffect(target, previous, index + 1, approvalRevision))).kind === "accepted"
            : previous.operation === "data.save-prepared-dataset"
              ? await readCommittedStructuredDatasetResult(partition, datasetResultEffect(target, previous, index + 1, approvalRevision))
            : previous.operation === "context.generate-pack"
              ? (await inspectStructuredContextPlanTask(partition, contextTaskEffect(target, previous, index + 1, approvalRevision))).kind === "accepted"
          : await hasStructuredHeadlessOperationReceipt(partition, target.scope, previous.operation,
          stepKey(target, previous, index + 1), sum(serializeHeadlessMutationInput(previous)));
      if (!received) return;
      if (!isCurrent() || !timestampBefore(approved.expiresAt)) return;
    }
    return { request, expiresAt: approved.expiresAt };
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

  if (request.operation === "context.generate-pack") {
    const effect = contextTaskEffect(target, request, step, approvalRevision);
    const protect = () => {if (!current()) throw new Error("The approved Context step ended.");};
    const sourceDigest = (compiled: CompiledContext) => sum(JSON.stringify([compiled.command, compiled.admissionSources]));
    async function authorizedRecord(owner: StructuredDocumentStore) {
      const selected = await select(owner);
      if (!selected || selected.expiresAt !== deadline || !current()) return;
      return owner.forOrganization(target.scope.organizationId);
    }
    return {
      kind: "context-pack" as const, request: structuredClone(request), expiresAt: prepared.expiresAt,
      isCurrent: current,
      async stillAllowed() {
        try {return await ownedTransaction(async owner => Boolean(await authorizedRecord(owner)), protect);}
        catch {return false;}
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
            const compiled = await compileContext!(owner, request, target.scope);
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
  const family = request.operation === "context.generate-pack" ? "aisb-approved-context-pack-step-v1" :
    request.operation === "data.save-prepared-dataset" ? "aisb-approved-dataset-result-step-v1" :
    request.operation === "data.prepare-local-dataset" ? "aisb-approved-local-dataset-step-v1" :
    request.operation === "data.save-provider-source" ? "aisb-approved-provider-file-step-v1" :
    request.operation === "data.save-local-source" ? "aisb-approved-local-file-step-v1" : "aisb-approved-system-step-v1";
  const parts = [family, target.hostIncarnationId, target.fingerprint, step, request.input.idempotencyKey];
  const hex = sum(JSON.stringify(request.operation === "data.prepare-local-dataset" || request.operation === "data.save-prepared-dataset" || request.operation === "context.generate-pack" ?
    [...parts, target.scope.organizationId, target.scope.workspaceId, target.scope.principalId, target.scope.registeredClientId] : parts));
  // Keep the existing validated internal UUID shape. The plan and ordinal
  // reserve a different key even when two proposals reuse a supplied key.
  return [hex.slice(0, 8), hex.slice(8, 12), "4" + hex.slice(13, 16),
    "8" + hex.slice(17, 20), hex.slice(20, 32)].join("-");
}

function contextTaskEffect(target: HeadlessPlanReviewTarget, request: HeadlessContextPackPlanRequest,
  step: number, approvalRevision: number): ContextPlanTaskEffect {
  return {key: stepKey(target, request, step), target, request, step, approvalRevision};
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
