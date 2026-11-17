import { createHash } from "node:crypto";

import type {
  HeadlessPlanReviewQuery, HeadlessPlanReviewTarget,
} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import type { HeadlessOperationScope, HeadlessOperationStorePort } from "../../../application/ports/system-builder";
import type { IngestionFilePublicationAdmission } from "../../../application/ports/ingestion";
import { normalizeIngestionFilePublication, publicationUnavailable } from "../../../application/shared/ingestion-file-publication";
import { serializeHeadlessMutationInput, type HeadlessBuildPlanRequest, type HeadlessLocalFileSavePlanRequest } from "../../../contracts/headless";
import {
  issueStructuredLocalFilePlanEffect, readCommittedStructuredLocalFilePlanEffect, type LocalFilePlanEffect,
} from "../ingestion/createStructuredHeadlessLocalFilePlanStepStore";
import {
  matchesStructuredHeadlessLocalFileSelection, readStructuredHeadlessLocalFileSelection,
} from "../ingestion/createStructuredHeadlessLocalFileSelectionRepository";
import type { StructuredDocumentStore } from "../shared";
import { createStructuredHeadlessOperationStore, hasStructuredHeadlessOperationReceipt } from "./createStructuredHeadlessOperationStore";
import { fenceStructuredApprovedPlan, readStructuredApprovedPlan } from "./createStructuredHeadlessPlanReviewRepository";

const denied = { kind: "denied" } as const;

type Authorize = (owner: StructuredDocumentStore, scope: HeadlessOperationScope, request?: HeadlessBuildPlanRequest) => Promise<boolean>;

type StepQuery = HeadlessPlanReviewQuery & {
  readonly approvalRevision: number;
  readonly step: number;
};

/** Prepare the stored request, then independently enforce the same exact plan inside the mutation transaction. */
export async function prepareStructuredHeadlessPlanStep(
  documents: StructuredDocumentStore, query: StepQuery, authorize: Authorize, now: () => number = Date.now,
  publication: "serialized-owner" | "stable-reads" = "serialized-owner",
  allowLocalFileSave = false,
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
        (request.operation === "data.save-local-source" && !await authorize(owner, target.scope, request))) return;
    for (let index = 0; index < step - 1; index++) {
      const previous = approved.requests[index];
      if (!previous) return;
      const received = previous.operation === "data.save-local-source"
        ? await readCommittedStructuredLocalFilePlanEffect(partition, localFileEffect(target, previous, index + 1))
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
  const family = request.operation === "data.save-local-source" ? "aisb-approved-local-file-step-v1" : "aisb-approved-system-step-v1";
  const hex = sum(JSON.stringify([family, target.hostIncarnationId,
    target.fingerprint, step, request.input.idempotencyKey]));
  // Keep the existing validated internal UUID shape. The plan and ordinal
  // reserve a different key even when two proposals reuse a supplied key.
  return [hex.slice(0, 8), hex.slice(8, 12), "4" + hex.slice(13, 16),
    "8" + hex.slice(17, 20), hex.slice(20, 32)].join("-");
}

function localFileEffect(target: HeadlessPlanReviewTarget, request: HeadlessLocalFileSavePlanRequest, step: number): LocalFilePlanEffect {
  const { idempotencyKey: _key, ...selected } = request.input;
  const { organizationId, principalId, registeredClientId } = target.scope;
  return { key: stepKey(target, request, step), selection: { organizationId, principalId, registeredClientId, target: selected } };
}
