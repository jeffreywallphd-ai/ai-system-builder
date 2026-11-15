import { createHash } from "node:crypto";
import type {
  HeadlessPlanReviewQuery, HeadlessPlanReviewRepository, HeadlessPlanReviewResult, HeadlessPlanReviewState,
  HeadlessPlanReviewTarget,
  HeadlessPlanReviewListEntry, HeadlessPlanReviewListResult, HeadlessPlanReviewListTarget,
} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import { HEADLESS_MAX_BUILD_PLAN_STEPS, isDesktopHeadlessClientId, isHeadlessHostIncarnationId,
  parseHeadlessBuildPlanProposal } from "../../../contracts/headless";
import { isOrganizationId } from "../../../contracts/organization";
import { hasKnownPassiveCredential, readStrictPassiveRecord } from "../../../contracts/shared";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { StructuredDocumentStore } from "../shared";
import { HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE } from "./createStructuredHeadlessOperationStore";

const REVIEWS = "headless/system-builder/plan-reviews";
const COUNTS = "headless/system-builder/plan-review-counts";
const APPROVAL_LIST = "headless/system-builder/plan-approval-list";
const MAX_ACTIVE_PLAN_REVIEWS = 32;
const REVIEW_MS = 15 * 60 * 1_000;
const denied = { ok: false, code: "forbidden" } as const;
const expired = { ok: false, code: "expired" } as const;
const unconfirmed = { ok: false, code: "unconfirmed" } as const;
const capacity = { ok: false, code: "capacity" } as const;
type Failure = Extract<HeadlessPlanReviewResult, { ok: false }>;
type Action = "propose" | "read" | "decide";
type Proposal = Extract<ReturnType<typeof parseHeadlessBuildPlanProposal>, { ok: true }>;
type RecordValue = { readonly version: 1; readonly proposal: unknown; readonly state: HeadlessPlanReviewState };

class ReviewWriteRetired extends Error {}

export function createStructuredHeadlessPlanReviewRepository(
  documents: StructuredDocumentStore,
  policy: (owner: StructuredDocumentStore, target: HeadlessPlanReviewTarget, action: Action) => Promise<boolean>,
  now: () => number = Date.now,
  validateNewProposal?: (partition: StructuredDocumentStore) => Promise<true | false | "stale">,
): HeadlessPlanReviewRepository {
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
      const proposal = decodeProposal(input.proposal, input.target);
      if (!proposal) return { ok: false, code: "invalid" };
      return run(input, "propose", async (store, target, key, requireFresh) => {
        const existing = await readReview(store, target, key);
        if (existing) return requireFresh(existing.state.expiresAt) ? snapshot(existing) : expired;
        const eligible = validateNewProposal ? await validateNewProposal(store) : true;
        if (eligible === "stale") return { ok: false, code: "stale" } as const;
        if (!eligible || !input.isCurrent()) return denied;
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
        await store.writeDocument(REVIEWS, key, { version: 1, proposal: raw, state } satisfies RecordValue, { expectedRevision: 0 });
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
        return requireFresh(review.state.expiresAt) ? snapshot(review) : expired;
      });
    },
    async decide(input) {
      return run(input, "decide", async (store, target, key, requireFresh) => {
        const review = await readReview(store, target, key);
        if (!review) return denied;
        if (!requireFresh(review.state.expiresAt)) return expired;
        const previous = review.state;
        const outcome = input.update({ ...previous });
        if (!outcome.ok) return outcome;
        const state = readState(outcome.state, previous.revision + 1, previous.stepCount);
        if (state.expiresAt !== previous.expiresAt) return unconfirmed;
        await store.writeDocument(REVIEWS, key, { version: 1, proposal: review.proposal, state } satisfies RecordValue,
          { expectedRevision: previous.revision });
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

function decodeProposal(value: unknown, target: HeadlessPlanReviewTarget) {
  const proposal = parseHeadlessBuildPlanProposal(value, target.hostIncarnationId);
  if (proposal.ok && proposal.scope.workspaceId === target.scope.workspaceId &&
      sha256(JSON.stringify(proposal.preview)) === target.fingerprint) return proposal;
}

async function readReview(store: StructuredDocumentStore, target: HeadlessPlanReviewTarget, key: string) {
  const document = await store.readDocument(REVIEWS, key);
  if (!document) return;
  const { version, proposal, state } = readStrictPassiveRecord(document.value, ["version", "proposal", "state"]);
  const parsed = decodeProposal(proposal, target);
  if (version !== 1 || !parsed) throw new Error("Stored plan review is unavailable.");
  return { proposal, preview: parsed.preview, state: readState(state, document.revision, parsed.requests.length) };
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
