import { createHash } from "node:crypto";

import type {
  HeadlessPlanReviewQuery, HeadlessPlanReviewTarget,
} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import type { HeadlessOperationScope, HeadlessOperationStorePort } from "../../../application/ports/system-builder";
import { serializeHeadlessMutationInput, type HeadlessSystemManagementRequest } from "../../../contracts/headless";
import type { StructuredDocumentStore } from "../shared";
import { createStructuredHeadlessOperationStore, hasStructuredHeadlessOperationReceipt } from "./createStructuredHeadlessOperationStore";
import { fenceStructuredApprovedPlan, readStructuredApprovedPlan } from "./createStructuredHeadlessPlanReviewRepository";

const denied = { kind: "denied" } as const;

type Authorize = (owner: StructuredDocumentStore, scope: HeadlessOperationScope) => Promise<boolean>;

type StepQuery = HeadlessPlanReviewQuery & {
  readonly approvalRevision: number;
  readonly step: number;
};

/** Prepare the stored request, then independently enforce the same exact plan inside the mutation transaction. */
export async function prepareStructuredHeadlessPlanStep(
  documents: StructuredDocumentStore, query: StepQuery, authorize: Authorize, now: () => number = Date.now,
  publication: "serialized-owner" | "stable-reads" = "serialized-owner",
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
    if (!request) return;
    for (let index = 0; index < step - 1; index++) {
      const previous = approved.requests[index];
      if (!previous || !await hasStructuredHeadlessOperationReceipt(partition, target.scope, previous.operation,
        stepKey(target, previous, index + 1), sum(serializeHeadlessMutationInput(previous)))) return;
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
    request: structuredClone(request), isCurrent: current, operations, expiresAt: prepared.expiresAt,
    async publishIfCurrent(publish: () => boolean) {
      if (!current()) return false;
      try {
        async function approvedForPublication(owner: StructuredDocumentStore) {
          const latest = await select(owner);
          return Boolean(latest && latest.expiresAt === deadline && current());
        }
        const send = () => current() && publish();
        if (publication === "stable-reads")
          return await stableReads!(approvedForPublication, send);
        // In Desktop, the SQLite owner serializes this read and synchronous
        // reply against a concurrent decision, even after the effect committed.
        return await ownedTransaction(async owner => await approvedForPublication(owner) && send(), () => {});
      } catch { return false; }
    },
  };
}

function sameScope(left: HeadlessOperationScope, right: HeadlessOperationScope) {
  return left.organizationId === right.organizationId && left.workspaceId === right.workspaceId &&
    left.principalId === right.principalId && left.registeredClientId === right.registeredClientId;
}

function sum(value: string) { return createHash("sha256").update(value, "utf8").digest("hex"); }

function stepKey(target: HeadlessPlanReviewTarget, request: HeadlessSystemManagementRequest, step: number) {
  const hex = sum(JSON.stringify(["aisb-approved-system-step-v1", target.hostIncarnationId,
    target.fingerprint, step, request.input.idempotencyKey]));
  // Keep the existing validated internal UUID shape. The plan and ordinal
  // reserve a different key even when two proposals reuse a supplied key.
  return [hex.slice(0, 8), hex.slice(8, 12), "4" + hex.slice(13, 16),
    "8" + hex.slice(17, 20), hex.slice(20, 32)].join("-");
}
