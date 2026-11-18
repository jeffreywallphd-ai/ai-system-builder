import {createHash, randomUUID} from "node:crypto";
import type {HeadlessPlanReviewTarget} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import {isHeadlessHostIncarnationId, isDesktopHeadlessClientId, HEADLESS_MAX_BUILD_PLAN_STEPS,
  serializeHeadlessMutationInput, type HeadlessLocalDatasetPlanRequest} from "../../../contracts/headless";
import {readStrictPassiveRecord, hasKnownPassiveCredential} from "../../../contracts/shared";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import type {StructuredDocumentStore} from "../shared";
import {HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE} from "../system-builder/createStructuredHeadlessOperationStore";

const TASKS = "headless/data/dataset-plan-tasks";
const INDEX = "headless/data/dataset-plan-task-index";
const PLAN_INDEX = "headless/data/dataset-plan-task-plan-index";
const COUNTS = "headless/data/dataset-plan-task-counts";
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function unavailable(): never {throw new Error("The owned dataset task record is unavailable.");}
const isDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export interface DatasetPlanTaskEffect {
  readonly key: string;
  readonly target: HeadlessPlanReviewTarget;
  readonly approvalRevision: number;
  readonly step: number;
  readonly request: HeadlessLocalDatasetPlanRequest;
}

function identity(effect: DatasetPlanTaskEffect) {
  const {target: {scope, hostIncarnationId, fingerprint}, approvalRevision, step, request} = effect;
  if (!isHeadlessHostIncarnationId(effect.key) || request.operation !== "data.prepare-local-dataset" ||
      !isHeadlessHostIncarnationId(hostIncarnationId) || !isOrganizationId(scope.organizationId) || !isWorkspaceId(scope.workspaceId) ||
      !isDesktopHeadlessClientId(scope.registeredClientId) || typeof scope.principalId !== "string" || scope.principalId.length < 1 ||
      scope.principalId.length > 160 || hasKnownPassiveCredential(scope.principalId) ||
      request.input.hostIncarnationId !== hostIncarnationId || request.input.workspaceId !== scope.workspaceId ||
      !isDigest(fingerprint) || !Number.isSafeInteger(approvalRevision) || approvalRevision < 1 ||
      !Number.isSafeInteger(step) || step < 1 || step > HEADLESS_MAX_BUILD_PLAN_STEPS) unavailable();
  return {hostIncarnationId, workspaceId: scope.workspaceId, principalId: scope.principalId,
    registeredClientId: scope.registeredClientId, fingerprint, approvalRevision, step,
    inputDigest: sha(serializeHeadlessMutationInput(request))};
}

function key(effect: DatasetPlanTaskEffect) {return `${effect.target.scope.workspaceId}/${effect.key}`;}
function planIndexKey(owner: {readonly workspaceId: string; readonly hostIncarnationId: string; readonly principalId: string;
  readonly registeredClientId: string; readonly fingerprint: string; readonly step: number}) {
  return `${owner.workspaceId}/${sha(JSON.stringify([owner.hostIncarnationId, owner.principalId,
    owner.registeredClientId, owner.fingerprint, owner.step]))}`;
}
function partition(owner: StructuredDocumentStore, effect: DatasetPlanTaskEffect, mutation = false) {
  if (owner.organizationId !== effect.target.scope.organizationId || (mutation && owner.runInOwnedTransaction)) unavailable();
}
function timestamp(now: number) {if (!Number.isSafeInteger(now) || now < 1) unavailable(); return now;}

async function read(owner: StructuredDocumentStore, effect: DatasetPlanTaskEffect) {
  partition(owner, effect);
  const expected = identity(effect);
  const document = await owner.readDocument(TASKS, key(effect));
  if (!document) return;
  const record = decode(document.value, document.revision);
  const {approvalRevision: originalRevision, ...original} = record.owner;
  const {approvalRevision: requestedRevision, ...requested} = expected;
  if (JSON.stringify(original) !== JSON.stringify(requested) || originalRevision > requestedRevision ||
      (record.phase !== "accepted" && originalRevision !== requestedRevision)) unavailable();
  const indexed = await owner.readDocument(INDEX, `${expected.workspaceId}/${record.taskId}`);
  if (!indexed || indexed.revision !== 1) unavailable();
  const index = readStrictPassiveRecord(indexed.value, ["effectKey", "identityDigest"]);
  if (index.effectKey !== effect.key || index.identityDigest !== sha(JSON.stringify(record.owner))) unavailable();
  const planned = await owner.readDocument(PLAN_INDEX, planIndexKey(expected));
  if (!planned || planned.revision !== 1) unavailable();
  const planIndex = readStrictPassiveRecord(planned.value, ["effectKey", "identityDigest"]);
  if (planIndex.effectKey !== effect.key || planIndex.identityDigest !== index.identityDigest) unavailable();
  return record;
}

function decode(value: unknown, revision: number) {
  const row = readStrictPassiveRecord(value, ["version", "owner", "taskId", "sourceDigest", "phase", "createdAt", "updatedAt"]);
  const owner = readStrictPassiveRecord(row.owner, ["hostIncarnationId", "workspaceId", "principalId", "registeredClientId",
    "fingerprint", "approvalRevision", "step", "inputDigest"]);
  if (row.version !== 1 || !isHeadlessHostIncarnationId(row.taskId) || !isDigest(row.sourceDigest) ||
      !isHeadlessHostIncarnationId(owner.hostIncarnationId) || !isDesktopHeadlessClientId(owner.registeredClientId) ||
      !isWorkspaceId(owner.workspaceId) || typeof owner.principalId !== "string" || owner.principalId.length < 1 || owner.principalId.length > 160 ||
      hasKnownPassiveCredential(owner.principalId) || !isDigest(owner.fingerprint) || !isDigest(owner.inputDigest) ||
      typeof owner.approvalRevision !== "number" || !Number.isSafeInteger(owner.approvalRevision) || owner.approvalRevision < 1 ||
      typeof owner.step !== "number" || !Number.isSafeInteger(owner.step) || owner.step < 1 || owner.step > HEADLESS_MAX_BUILD_PLAN_STEPS ||
      (row.phase !== "reserved" && row.phase !== "issued" && row.phase !== "accepted") ||
      revision !== (row.phase === "reserved" ? 1 : row.phase === "issued" ? 2 : 3) ||
      typeof row.createdAt !== "number" || typeof row.updatedAt !== "number" ||
      timestamp(row.createdAt) > timestamp(row.updatedAt)) unavailable();
  return {version: 1 as const, owner: {hostIncarnationId: owner.hostIncarnationId as string, workspaceId: owner.workspaceId as string,
    principalId: owner.principalId as string, registeredClientId: owner.registeredClientId as string,
    fingerprint: owner.fingerprint as string, approvalRevision: owner.approvalRevision as number, step: owner.step as number,
    inputDigest: owner.inputDigest as string}, taskId: row.taskId as string, sourceDigest: row.sourceDigest as string,
    phase: row.phase as "reserved" | "issued" | "accepted", createdAt: row.createdAt as number, updatedAt: row.updatedAt as number};
}

/** Read-only replay. Never turns an interrupted reservation/issue into a new start. */
export async function inspectStructuredDatasetPlanTask(owner: StructuredDocumentStore, effect: DatasetPlanTaskEffect) {
  const record = await read(owner, effect);
  return !record ? {kind: "absent" as const} : record.phase === "accepted"
    ? {kind: "accepted" as const, reference: {workspaceId: effect.target.scope.workspaceId, taskId: record.taskId}}
    : {kind: "unconfirmed" as const};
}

/** Called only in the same root-owned transaction as exact plan/source authorization. */
export async function reserveStructuredDatasetPlanTask(owner: StructuredDocumentStore, effect: DatasetPlanTaskEffect,
  sourceDigest: string, now: number) {
  partition(owner, effect, true);
  if (!isDigest(sourceDigest)) unavailable();
  const existing = await inspectStructuredDatasetPlanTask(owner, effect);
  if (existing.kind !== "absent") return existing;
  const bound = identity(effect), time = timestamp(now);
  const countKey = `${bound.workspaceId}/${sha(JSON.stringify([bound.principalId, bound.registeredClientId]))}`;
  const count = await owner.readDocument(COUNTS, countKey);
  const used = count ? readStrictPassiveRecord(count.value, ["used"]).used : 0;
  if (typeof used !== "number" || !Number.isSafeInteger(used) || used < 0 || (count && count.revision !== used)) unavailable();
  if (used >= HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE) return {kind: "capacity" as const};
  const taskId = randomUUID();
  await owner.writeDocument(TASKS, key(effect), {version: 1, owner: bound, taskId, sourceDigest, phase: "reserved", createdAt: time, updatedAt: time}, {expectedRevision: 0});
  await owner.writeDocument(INDEX, `${bound.workspaceId}/${taskId}`, {effectKey: effect.key, identityDigest: sha(JSON.stringify(bound))}, {expectedRevision: 0});
  await owner.writeDocument(PLAN_INDEX, planIndexKey(bound), {effectKey: effect.key, identityDigest: sha(JSON.stringify(bound))}, {expectedRevision: 0});
  await owner.writeDocument(COUNTS, countKey, {used: used + 1}, {expectedRevision: count?.revision ?? 0});
  return {kind: "new" as const, taskId};
}

/** Acknowledged CAS, with the owning approval/source fence, admits one exact call. */
export async function issueStructuredDatasetPlanTask(owner: StructuredDocumentStore, effect: DatasetPlanTaskEffect,
  taskId: string, sourceDigest: string, now: number) {
  partition(owner, effect, true);
  const record = await read(owner, effect);
  if (!record || record.phase !== "reserved" || record.taskId !== taskId || record.sourceDigest !== sourceDigest) return false;
  if (timestamp(now) < record.updatedAt) return false;
  await owner.writeDocument(TASKS, key(effect), {...record, phase: "issued", updatedAt: timestamp(now)}, {expectedRevision: 1});
  return true;
}

/** Record an already admitted business outcome even if outward permission ended. */
export async function acceptStructuredDatasetPlanTask(owner: StructuredDocumentStore, effect: DatasetPlanTaskEffect,
  taskId: string, now: number) {
  partition(owner, effect, true);
  const record = await read(owner, effect);
  if (!record || record.taskId !== taskId || (record.phase !== "issued" && record.phase !== "accepted")) return false;
  if (timestamp(now) < record.updatedAt) return false;
  if (record.phase === "accepted") return true;
  await owner.writeDocument(TASKS, key(effect), {...record, phase: "accepted", updatedAt: timestamp(now)}, {expectedRevision: 2});
  return true;
}

/** Exact point index for an accepted task; no task/history enumeration or adoption. */
async function readOwnedDatasetPlanTaskRecord(owner: StructuredDocumentStore,
  scope: Pick<HeadlessPlanReviewTarget["scope"], "organizationId" | "workspaceId" | "principalId">,
  hostIncarnationId: string, taskId: string) {
  if (!isOrganizationId(scope.organizationId) || !isWorkspaceId(scope.workspaceId) || !scope.principalId ||
      owner.organizationId !== scope.organizationId || !isHeadlessHostIncarnationId(hostIncarnationId) || !isHeadlessHostIncarnationId(taskId)) return;
  const indexed = await owner.readDocument(INDEX, `${scope.workspaceId}/${taskId}`);
  if (!indexed || indexed.revision !== 1) return;
  const index = readStrictPassiveRecord(indexed.value, ["effectKey", "identityDigest"]);
  if (!isHeadlessHostIncarnationId(index.effectKey) || !isDigest(index.identityDigest)) return;
  const document = await owner.readDocument(TASKS, `${scope.workspaceId}/${index.effectKey}`);
  if (!document) return;
  const record = decode(document.value, document.revision), actor = record.owner;
  if (record.phase !== "accepted" || record.taskId !== taskId || actor.workspaceId !== scope.workspaceId ||
      actor.hostIncarnationId !== hostIncarnationId || actor.principalId !== scope.principalId ||
      sha(JSON.stringify(actor)) !== index.identityDigest) return;
  const planned = await owner.readDocument(PLAN_INDEX, planIndexKey(actor));
  if (!planned || planned.revision !== 1) return;
  const planIndex = readStrictPassiveRecord(planned.value, ["effectKey", "identityDigest"]);
  if (planIndex.effectKey !== index.effectKey || planIndex.identityDigest !== index.identityDigest) return;
  return record;
}

export async function readStructuredOwnedDatasetPlanTask(owner: StructuredDocumentStore,
  scope: HeadlessPlanReviewTarget["scope"], hostIncarnationId: string, taskId: string) {
  if (!isDesktopHeadlessClientId(scope.registeredClientId)) return;
  const record = await readOwnedDatasetPlanTaskRecord(owner, scope, hostIncarnationId, taskId);
  return record?.owner.registeredClientId === scope.registeredClientId ? {workspaceId: scope.workspaceId, taskId} : undefined;
}

/** Separate window consent may use another client; it never adopts execution authority. */
export async function readStructuredPresentableDatasetPlanTask(owner: StructuredDocumentStore,
  scope: Pick<HeadlessPlanReviewTarget["scope"], "organizationId" | "workspaceId" | "principalId">,
  hostIncarnationId: string, taskId: string) {
  const record = await readOwnedDatasetPlanTaskRecord(owner, scope, hostIncarnationId, taskId);
  return record ? {workspaceId: scope.workspaceId, taskId} : undefined;
}

/** Internal immutable input identity, after the same accepted-owner proof. */
export async function readStructuredOwnedDatasetPlanTaskSourceDigest(owner: StructuredDocumentStore,
  scope: HeadlessPlanReviewTarget["scope"], hostIncarnationId: string, taskId: string) {
  if (!isDesktopHeadlessClientId(scope.registeredClientId)) return;
  const record = await readOwnedDatasetPlanTaskRecord(owner, scope, hostIncarnationId, taskId);
  return record?.owner.registeredClientId === scope.registeredClientId ? record.sourceDigest : undefined;
}

/** Recover an acknowledged business receipt from a known plan step, without rerunning it. */
export async function readStructuredOwnedDatasetPlanTaskByPlan(owner: StructuredDocumentStore,
  scope: HeadlessPlanReviewTarget["scope"], hostIncarnationId: string, fingerprint: string, step: number) {
  if (owner.organizationId !== scope.organizationId || !isHeadlessHostIncarnationId(hostIncarnationId) ||
      !isDigest(fingerprint) || !Number.isSafeInteger(step) || step < 1 || step > HEADLESS_MAX_BUILD_PLAN_STEPS) return;
  const lookup = `${scope.workspaceId}/${sha(JSON.stringify([hostIncarnationId, scope.principalId,
    scope.registeredClientId, fingerprint, step]))}`;
  const indexed = await owner.readDocument(PLAN_INDEX, lookup);
  if (!indexed || indexed.revision !== 1) return;
  const index = readStrictPassiveRecord(indexed.value, ["effectKey", "identityDigest"]);
  if (!isHeadlessHostIncarnationId(index.effectKey) || !isDigest(index.identityDigest)) return;
  const document = await owner.readDocument(TASKS, `${scope.workspaceId}/${index.effectKey}`);
  if (!document) return;
  const record = decode(document.value, document.revision);
  if (record.owner.fingerprint !== fingerprint || record.owner.step !== step || sha(JSON.stringify(record.owner)) !== index.identityDigest) return;
  return readStructuredOwnedDatasetPlanTask(owner, scope, hostIncarnationId, record.taskId);
}
