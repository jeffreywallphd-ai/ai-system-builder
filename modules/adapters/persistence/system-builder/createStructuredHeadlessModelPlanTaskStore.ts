import {createHash, randomUUID} from "node:crypto";
import {types} from "node:util";
import type {HeadlessPlanReviewTarget} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import {isHeadlessHostIncarnationId, isDesktopHeadlessClientId, HEADLESS_MAX_BUILD_PLAN_STEPS,
  readHeadlessModelDownloadPlanRequest, type HeadlessModelDownloadPlanRequest} from "../../../contracts/headless";
import {copyBoundedPassiveData, readStrictPassiveRecord, hasKnownPassiveCredential} from "../../../contracts/shared";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import type {StructuredDocumentStore} from "../shared";
import {HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE} from "./createStructuredHeadlessOperationStore";

const TASKS = "headless/models/download-plan-tasks";
const INDEX = "headless/models/download-plan-task-index";
const PLAN_INDEX = "headless/models/download-plan-task-plan-index";
const COUNTS = "headless/models/download-plan-task-counts";
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function unavailable(): never {throw new Error("The owned Model task record is unavailable.");}
const isDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export interface ModelPlanTaskEffect {
  readonly key: string;
  readonly target: HeadlessPlanReviewTarget;
  readonly approvalRevision: number;
  readonly step: number;
  readonly request: HeadlessModelDownloadPlanRequest;
}

function passive(value: unknown): unknown {
  let nodes = 0;
  function inspect(data: unknown, depth = 0) {
    if (++nodes > 4096 || depth > 12) unavailable();
    if (!data || typeof data !== "object") return;
    if (types.isProxy(data)) unavailable();
    const prototype = Object.getPrototypeOf(data);
    if (Array.isArray(data) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) unavailable();
    const keys = Reflect.ownKeys(data);
    if (keys.length > (Array.isArray(data) ? 1025 : 128)) unavailable();
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(data, key);
      if (!descriptor || !("value" in descriptor)) unavailable();
      inspect(descriptor.value, depth + 1);
    }
  }
  inspect(value); return copyBoundedPassiveData(value);
}
function captureScope(raw: unknown): HeadlessPlanReviewTarget["scope"] {
  const scope = readStrictPassiveRecord(passive(raw), ["organizationId", "workspaceId", "principalId", "registeredClientId"]);
  if (!isOrganizationId(scope.organizationId) || !isWorkspaceId(scope.workspaceId) || !isDesktopHeadlessClientId(scope.registeredClientId) ||
      typeof scope.principalId !== "string" || !scope.principalId || scope.principalId.length > 160 || hasKnownPassiveCredential(scope.principalId)) unavailable();
  return {organizationId: scope.organizationId, workspaceId: scope.workspaceId,
    principalId: scope.principalId, registeredClientId: scope.registeredClientId};
}
/** Copy the complete effect before any store await; never retain caller data. */
function captureEffect(raw: ModelPlanTaskEffect): ModelPlanTaskEffect {
  const effect = readStrictPassiveRecord(passive(raw), ["key", "target", "approvalRevision", "step", "request"]);
  const target = readStrictPassiveRecord(effect.target, ["hostIncarnationId", "scope", "fingerprint"]);
  if (!isHeadlessHostIncarnationId(target.hostIncarnationId)) unavailable();
  const request = readHeadlessModelDownloadPlanRequest(effect.request, target.hostIncarnationId);
  if (!request.ok) unavailable();
  const result: ModelPlanTaskEffect = {key: effect.key as string, approvalRevision: effect.approvalRevision as number, step: effect.step as number,
    target: {hostIncarnationId: target.hostIncarnationId, fingerprint: target.fingerprint as string, scope: captureScope(target.scope)}, request: request.request};
  identity(result); return result;
}

function identity(effect: ModelPlanTaskEffect) {
  const {target: {scope, hostIncarnationId, fingerprint}, approvalRevision, step, request} = effect;
  if (!isHeadlessHostIncarnationId(effect.key) ||
      request.operation !== "models.download" ||
      !isHeadlessHostIncarnationId(hostIncarnationId) || !isOrganizationId(scope.organizationId) || !isWorkspaceId(scope.workspaceId) ||
      !isDesktopHeadlessClientId(scope.registeredClientId) || typeof scope.principalId !== "string" || scope.principalId.length < 1 ||
      scope.principalId.length > 160 || hasKnownPassiveCredential(scope.principalId) ||
      request.input.hostIncarnationId !== hostIncarnationId || request.input.workspaceId !== scope.workspaceId ||
      !isDigest(fingerprint) || !Number.isSafeInteger(approvalRevision) || approvalRevision < 1 ||
      !Number.isSafeInteger(step) || step < 1 || step > HEADLESS_MAX_BUILD_PLAN_STEPS) unavailable();
  const sourceDigest = sha(JSON.stringify(request.input.sourceManifest.source));
  if (request.input.sourceManifest.manifestDigest !== "sha256:" + sourceDigest) unavailable();
  return {hostIncarnationId, workspaceId: scope.workspaceId, principalId: scope.principalId,
    registeredClientId: scope.registeredClientId, fingerprint, approvalRevision, step,
    // Unlike a generic mutation payload, this ownership identity also binds the
    // exact caller request key, contract version and operation.
    inputDigest: sha(JSON.stringify(request)), sourceDigest};
}

function key(effect: ModelPlanTaskEffect) {return `${effect.target.scope.workspaceId}/${effect.key}`;}
function planIndexKey(owner: {readonly workspaceId: string; readonly hostIncarnationId: string; readonly principalId: string;
  readonly registeredClientId: string; readonly fingerprint: string; readonly step: number}) {
  return `${owner.workspaceId}/${sha(JSON.stringify([owner.hostIncarnationId, owner.principalId,
    owner.registeredClientId, owner.fingerprint, owner.step]))}`;
}
function partition(owner: StructuredDocumentStore, effect: ModelPlanTaskEffect, mutation = false) {
  if (owner.organizationId !== effect.target.scope.organizationId || (mutation && owner.runInOwnedTransaction)) unavailable();
}
function timestamp(now: number) {if (!Number.isSafeInteger(now) || now < 1) unavailable(); return now;}

async function read(owner: StructuredDocumentStore, effect: ModelPlanTaskEffect) {
  partition(owner, effect);
  const expected = identity(effect);
  const document = await owner.readDocument(TASKS, key(effect));
  if (!document) return;
  const record = decode(document.value, document.revision);
  const {approvalRevision: originalRevision, ...original} = record.owner;
  const {approvalRevision: requestedRevision, ...requested} = expected;
  if (JSON.stringify(original) !== JSON.stringify(requested) || originalRevision > requestedRevision ||
      (record.phase !== "accepted" && record.phase !== "not-started" && originalRevision !== requestedRevision)) unavailable();
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
  const row = readStrictPassiveRecord(value, ["version", "owner", "taskId", "sourceDigest", "phase", "createdAt", "updatedAt", "notStartedFrom"]);
  const owner = readStrictPassiveRecord(row.owner, ["hostIncarnationId", "workspaceId", "principalId", "registeredClientId",
    "fingerprint", "approvalRevision", "step", "inputDigest", "sourceDigest"]);
  const nonstart = row.version === 2 && row.phase === "not-started" &&
    (row.notStartedFrom === "reserved" || row.notStartedFrom === "issued") &&
    revision === (row.notStartedFrom === "reserved" ? 2 : 3);
  const ordinary = row.version === 1 && !("notStartedFrom" in row) &&
    (row.phase === "reserved" || row.phase === "issued" || row.phase === "accepted") &&
    revision === (row.phase === "reserved" ? 1 : row.phase === "issued" ? 2 : 3);
  if ((!nonstart && !ordinary) || !isHeadlessHostIncarnationId(row.taskId) || !isDigest(row.sourceDigest) || owner.sourceDigest !== row.sourceDigest ||
      !isHeadlessHostIncarnationId(owner.hostIncarnationId) || !isDesktopHeadlessClientId(owner.registeredClientId) ||
      !isWorkspaceId(owner.workspaceId) || typeof owner.principalId !== "string" || owner.principalId.length < 1 || owner.principalId.length > 160 ||
      hasKnownPassiveCredential(owner.principalId) || !isDigest(owner.fingerprint) || !isDigest(owner.inputDigest) ||
      typeof owner.approvalRevision !== "number" || !Number.isSafeInteger(owner.approvalRevision) || owner.approvalRevision < 1 ||
      typeof owner.step !== "number" || !Number.isSafeInteger(owner.step) || owner.step < 1 || owner.step > HEADLESS_MAX_BUILD_PLAN_STEPS ||
      typeof row.createdAt !== "number" || typeof row.updatedAt !== "number" ||
      timestamp(row.createdAt) > timestamp(row.updatedAt)) unavailable();
  return {version: row.version as 1 | 2, owner: {hostIncarnationId: owner.hostIncarnationId as string, workspaceId: owner.workspaceId as string,
    principalId: owner.principalId as string, registeredClientId: owner.registeredClientId as string,
    fingerprint: owner.fingerprint as string, approvalRevision: owner.approvalRevision as number, step: owner.step as number,
    inputDigest: owner.inputDigest as string, sourceDigest: owner.sourceDigest as string}, taskId: row.taskId as string, sourceDigest: row.sourceDigest as string,
    phase: row.phase as "reserved" | "issued" | "accepted" | "not-started",
    ...(nonstart ? {notStartedFrom: row.notStartedFrom as "reserved" | "issued"} : {}),
    createdAt: row.createdAt as number, updatedAt: row.updatedAt as number};
}

/** Read-only replay. Never turns an interrupted reservation/issue into a new start. */
export async function inspectStructuredModelPlanTask(owner: StructuredDocumentStore, effect: ModelPlanTaskEffect) {
  effect = captureEffect(effect);
  const record = await read(owner, effect);
  return !record ? {kind: "absent" as const} : record.phase === "not-started" ? {kind: "not-started" as const} : record.phase === "accepted"
    ? {kind: "accepted" as const, reference: {workspaceId: effect.target.scope.workspaceId, taskId: record.taskId}}
    : {kind: "unconfirmed" as const};
}

/** Called only in the same root-owned transaction as exact plan/source authorization. */
export async function reserveStructuredModelPlanTask(owner: StructuredDocumentStore, effect: ModelPlanTaskEffect,
  sourceDigest: string, now: number) {
  effect = captureEffect(effect);
  partition(owner, effect, true);
  if (!isDigest(sourceDigest) || sourceDigest !== identity(effect).sourceDigest) unavailable();
  const existing = await inspectStructuredModelPlanTask(owner, effect);
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
export async function issueStructuredModelPlanTask(owner: StructuredDocumentStore, effect: ModelPlanTaskEffect,
  taskId: string, sourceDigest: string, now: number) {
  effect = captureEffect(effect);
  partition(owner, effect, true);
  const record = await read(owner, effect);
  if (!record || record.phase !== "reserved" || record.taskId !== taskId || record.sourceDigest !== sourceDigest) return false;
  if (timestamp(now) < record.updatedAt) return false;
  await owner.writeDocument(TASKS, key(effect), {...record, phase: "issued", updatedAt: timestamp(now)}, {expectedRevision: 1});
  return true;
}

/** Record an already admitted business outcome even if outward permission ended. */
export async function acceptStructuredModelPlanTask(owner: StructuredDocumentStore, effect: ModelPlanTaskEffect,
  taskId: string, now: number) {
  effect = captureEffect(effect);
  partition(owner, effect, true);
  const record = await read(owner, effect);
  if (!record || record.taskId !== taskId || (record.phase !== "issued" && record.phase !== "accepted")) return false;
  if (timestamp(now) < record.updatedAt) return false;
  if (record.phase === "accepted") return true;
  await owner.writeDocument(TASKS, key(effect), {...record, phase: "accepted", updatedAt: timestamp(now)}, {expectedRevision: 2});
  return true;
}

/** Trusted continuation of this newly reserved owning call only. Missing status
 * or an old unknown record is not evidence for this terminal non-start outcome. */
export async function recordStructuredModelTaskNotStarted(owner: StructuredDocumentStore, effect: ModelPlanTaskEffect,
  taskId: string, sourceDigest: string, now: number) {
  effect = captureEffect(effect);
  partition(owner, effect, true);
  const record = await read(owner, effect);
  if (!record || record.taskId !== taskId || record.sourceDigest !== sourceDigest || timestamp(now) < record.updatedAt ||
      record.phase === "accepted") return false;
  if (record.phase === "not-started") return true;
  await owner.writeDocument(TASKS, key(effect), {...record, version: 2, phase: "not-started",
    notStartedFrom: record.phase, updatedAt: timestamp(now)}, {expectedRevision: record.phase === "reserved" ? 1 : 2});
  return true;
}

/** Exact point index for an accepted task; no task/history enumeration or adoption. */
async function readOwnedModelPlanTaskRecord(owner: StructuredDocumentStore,
  scope: HeadlessPlanReviewTarget["scope"], hostIncarnationId: string, taskId: string, acceptedOnly = true) {
  scope = captureScope(scope);
  if (!isOrganizationId(scope.organizationId) || !isWorkspaceId(scope.workspaceId) || !scope.principalId ||
      owner.organizationId !== scope.organizationId || !isHeadlessHostIncarnationId(hostIncarnationId) || !isHeadlessHostIncarnationId(taskId)) return;
  const indexed = await owner.readDocument(INDEX, `${scope.workspaceId}/${taskId}`);
  if (!indexed || indexed.revision !== 1) return;
  const index = readStrictPassiveRecord(indexed.value, ["effectKey", "identityDigest"]);
  if (!isHeadlessHostIncarnationId(index.effectKey) || !isDigest(index.identityDigest)) return;
  const document = await owner.readDocument(TASKS, `${scope.workspaceId}/${index.effectKey}`);
  if (!document) return;
  const record = decode(document.value, document.revision), actor = record.owner;
  if ((acceptedOnly && record.phase !== "accepted") || record.taskId !== taskId || actor.workspaceId !== scope.workspaceId ||
      actor.hostIncarnationId !== hostIncarnationId || actor.principalId !== scope.principalId ||
      actor.registeredClientId !== scope.registeredClientId ||
      sha(JSON.stringify(actor)) !== index.identityDigest) return;
  const planned = await owner.readDocument(PLAN_INDEX, planIndexKey(actor));
  if (!planned || planned.revision !== 1) return;
  const planIndex = readStrictPassiveRecord(planned.value, ["effectKey", "identityDigest"]);
  if (planIndex.effectKey !== index.effectKey || planIndex.identityDigest !== index.identityDigest) return;
  return record;
}

export async function readStructuredOwnedModelPlanTask(owner: StructuredDocumentStore,
  scope: HeadlessPlanReviewTarget["scope"], hostIncarnationId: string, taskId: string) {
  scope = captureScope(scope);
  if (!isDesktopHeadlessClientId(scope.registeredClientId)) return;
  const record = await readOwnedModelPlanTaskRecord(owner, scope, hostIncarnationId, taskId);
  return record?.owner.registeredClientId === scope.registeredClientId ? {workspaceId: scope.workspaceId, taskId} : undefined;
}

/** Internal immutable input identity, after the same accepted-owner proof. */
export async function readStructuredOwnedModelPlanTaskSourceDigest(owner: StructuredDocumentStore,
  scope: HeadlessPlanReviewTarget["scope"], hostIncarnationId: string, taskId: string) {
  scope = captureScope(scope);
  if (!isDesktopHeadlessClientId(scope.registeredClientId)) return;
  const record = await readOwnedModelPlanTaskRecord(owner, scope, hostIncarnationId, taskId);
  return record?.owner.registeredClientId === scope.registeredClientId ? record.sourceDigest : undefined;
}

/** Private immutable lineage only, after current authority over the saved result.
 * Original actor/client fields never leave the host or grant task execution. */
export async function readStructuredModelPlanTaskLineage(owner: StructuredDocumentStore,
  scope: HeadlessPlanReviewTarget["scope"], hostIncarnationId: string, taskId: string) {
  scope = captureScope(scope);
  if (!isDesktopHeadlessClientId(scope.registeredClientId) || !isHeadlessHostIncarnationId(hostIncarnationId)) return;
  const record = await readOwnedModelPlanTaskRecord(owner, scope, hostIncarnationId, taskId);
  if (!record || record.owner.registeredClientId !== scope.registeredClientId) return;
  return {target: {hostIncarnationId, scope: {...scope}, fingerprint: record.owner.fingerprint},
    step: record.owner.step, inputDigest: record.owner.inputDigest, sourceDigest: record.sourceDigest};
}

/** Recover an acknowledged business receipt from a known plan step, without rerunning it. */
async function readModelPlanRecordByPlan(owner: StructuredDocumentStore,
  scope: HeadlessPlanReviewTarget["scope"], hostIncarnationId: string, fingerprint: string, step: number) {
  scope = captureScope(scope);
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
  return readOwnedModelPlanTaskRecord(owner, scope, hostIncarnationId, record.taskId, false);
}

/** Accepted identity only; a reservation/unknown issue never yields a task ID. */
export async function readStructuredOwnedModelPlanTaskByPlan(owner: StructuredDocumentStore,
  scope: HeadlessPlanReviewTarget["scope"], hostIncarnationId: string, fingerprint: string, step: number) {
  const record = await readModelPlanRecordByPlan(owner, scope, hostIncarnationId, fingerprint, step);
  return record?.phase === "accepted" ? {workspaceId: record.owner.workspaceId, taskId: record.taskId} : undefined;
}

/** Finite attempt status for the original client; no discovery or retry authority. */
export async function readStructuredModelPlanAttemptByPlan(owner: StructuredDocumentStore,
  scope: HeadlessPlanReviewTarget["scope"], hostIncarnationId: string, fingerprint: string, step: number) {
  const record = await readModelPlanRecordByPlan(owner, scope, hostIncarnationId, fingerprint, step);
  if (!record) return;
  return record.phase === "accepted" ? {kind: "accepted" as const, reference: {workspaceId: record.owner.workspaceId, taskId: record.taskId}}
    : record.phase === "not-started" ? {kind: "not-started" as const} : {kind: "unconfirmed" as const};
}
