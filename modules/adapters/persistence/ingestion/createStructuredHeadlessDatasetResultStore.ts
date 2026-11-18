import {createHash, randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import type {PreparedLocalDatasetReview} from "../../../application/ports/dataset-version";
import type {HeadlessPlanReviewTarget} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import {HEADLESS_MAX_BUILD_PLAN_STEPS, isDesktopHeadlessClientId, isHeadlessHostIncarnationId,
  readHeadlessDatasetResultSavePlanRequest, readHeadlessSavedDatasetReference, serializeHeadlessMutationInput,
  type HeadlessDatasetResultSavePlanRequest, type HeadlessSavedDatasetReference} from "../../../contracts/headless";
import {HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE} from "../system-builder/createStructuredHeadlessOperationStore";
import {HEADLESS_DATASET_MAX_ROWS_PER_SOURCE, HEADLESS_DATASET_MAX_SOURCES} from "../../../contracts/headless/headless-dataset-preparation";
import {normalizeDatasetVersionRecord, type DatasetVersionRecord} from "../../../contracts/dataset";
import {hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import {isWorkspaceId} from "../../../contracts/workspace";
import type {StructuredDocumentStore} from "../shared";
import {DATASET_VERSION_NAMESPACE, createStructuredDatasetVersionInOwnedTransaction,
  createStructuredDatasetVersionRepository} from "../dataset-version";
import {readStructuredOwnedDatasetPlanTask} from "./createStructuredHeadlessDatasetPlanTaskStore";

export const HEADLESS_DATASET_RESULT_NAMESPACE = "headless/data/dataset-result-saves";
const taskIndex = "headless/data/dataset-result-save-tasks";
const counters = "headless/data/dataset-result-save-counts";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const policyDigest = (value: unknown): value is `sha256:${string}` => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const rows = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 &&
  value <= HEADLESS_DATASET_MAX_ROWS_PER_SOURCE * HEADLESS_DATASET_MAX_SOURCES;
function unavailable(): never {throw new Error("The approved dataset result save is unavailable.");}

export interface DatasetResultSaveEffect {
  readonly key: string;
  readonly target: HeadlessPlanReviewTarget;
  readonly approvalRevision: number;
  readonly step: number;
  readonly request: HeadlessDatasetResultSavePlanRequest;
}

function identity(effect: DatasetResultSaveEffect) {
  const {target, approvalRevision, step, request} = effect, scope = target.scope;
  if (!isHeadlessHostIncarnationId(effect.key) || !isHeadlessHostIncarnationId(target.hostIncarnationId) ||
      !isDesktopHeadlessClientId(scope.registeredClientId) || !isWorkspaceId(scope.workspaceId) || !digest(target.fingerprint) ||
      typeof scope.principalId !== "string" || !scope.principalId || scope.principalId.length > 160 ||
      hasKnownPassiveCredential(scope.principalId) || !Number.isSafeInteger(approvalRevision) || approvalRevision < 1 ||
      !Number.isSafeInteger(step) || step < 1 || step > HEADLESS_MAX_BUILD_PLAN_STEPS) unavailable();
  const parsed = readHeadlessDatasetResultSavePlanRequest(request, target.hostIncarnationId);
  if (!parsed.ok || parsed.request.input.workspaceId !== scope.workspaceId) unavailable();
  return {hostIncarnationId: target.hostIncarnationId, workspaceId: scope.workspaceId,
    principalId: scope.principalId, registeredClientId: scope.registeredClientId, fingerprint: target.fingerprint,
    approvalRevision, step, taskId: request.input.taskId, inputDigest: sha(serializeHeadlessMutationInput(request))};
}
function scoped(owner: StructuredDocumentStore, effect: DatasetResultSaveEffect, mutation = false) {
  if (owner.organizationId !== effect.target.scope.organizationId || (mutation && owner.runInOwnedTransaction)) unavailable();
}
const key = (effect: DatasetResultSaveEffect) => `${effect.target.scope.workspaceId}/${effect.key}`;
function taskKey(actor: ReturnType<typeof identity>) {
  return `${actor.workspaceId}/${sha(JSON.stringify([actor.hostIncarnationId, actor.principalId, actor.registeredClientId, actor.taskId]))}`;
}
function time(now: number) {if (!Number.isSafeInteger(now) || now < 1) unavailable(); return now;}

function decode(value: unknown, revision: number) {
  const r = readStrictPassiveRecord(value, ["version", "owner", "saveId", "sourceDigest", "policyFingerprint", "acceptedRows",
    "splits", "phase", "createdAt", "updatedAt", "reference"]);
  const a = readStrictPassiveRecord(r.owner, ["hostIncarnationId", "workspaceId", "principalId", "registeredClientId", "fingerprint",
    "approvalRevision", "step", "taskId", "inputDigest"]);
  const splits = readStrictPassiveRecord(r.splits, ["trainRows", "validationRows", "testRows"]);
  if (r.version !== 1 || !isHeadlessHostIncarnationId(r.saveId) || !digest(r.sourceDigest) || !policyDigest(r.policyFingerprint) ||
      !isHeadlessHostIncarnationId(a.hostIncarnationId) || !isHeadlessHostIncarnationId(a.taskId) || !isWorkspaceId(a.workspaceId) ||
      !isDesktopHeadlessClientId(a.registeredClientId) || typeof a.principalId !== "string" || !a.principalId || a.principalId.length > 160 ||
      hasKnownPassiveCredential(a.principalId) || !digest(a.fingerprint) || !digest(a.inputDigest) ||
      typeof a.approvalRevision !== "number" || !Number.isSafeInteger(a.approvalRevision) || a.approvalRevision < 1 ||
      typeof a.step !== "number" || !Number.isSafeInteger(a.step) || a.step < 1 || a.step > HEADLESS_MAX_BUILD_PLAN_STEPS ||
      !rows(r.acceptedRows) || !rows(splits.trainRows) || !rows(splits.validationRows) || !rows(splits.testRows) ||
      splits.trainRows + splits.validationRows + splits.testRows !== r.acceptedRows ||
      (r.phase !== "reserved" && r.phase !== "issued" && r.phase !== "committed") ||
      revision !== (r.phase === "reserved" ? 1 : r.phase === "issued" ? 2 : 3) ||
      typeof r.createdAt !== "number" || typeof r.updatedAt !== "number" || time(r.createdAt) > time(r.updatedAt)) unavailable();
  const reference = r.phase === "committed" ? readHeadlessSavedDatasetReference(r.reference, a.workspaceId, a.taskId) : undefined;
  if (r.phase === "committed" ? !reference : "reference" in r) unavailable();
  return {version: 1 as const, owner: {hostIncarnationId: a.hostIncarnationId, workspaceId: a.workspaceId,
    principalId: a.principalId, registeredClientId: a.registeredClientId, fingerprint: a.fingerprint,
    approvalRevision: a.approvalRevision, step: a.step, taskId: a.taskId, inputDigest: a.inputDigest},
    saveId: r.saveId, sourceDigest: r.sourceDigest, policyFingerprint: r.policyFingerprint, acceptedRows: r.acceptedRows,
    splits: {trainRows: splits.trainRows, validationRows: splits.validationRows, testRows: splits.testRows},
    phase: r.phase as "reserved" | "issued" | "committed", createdAt: r.createdAt, updatedAt: r.updatedAt,
    ...(reference ? {reference} : {})};
}

async function read(owner: StructuredDocumentStore, effect: DatasetResultSaveEffect) {
  scoped(owner, effect);
  const expected = identity(effect), document = await owner.readDocument(HEADLESS_DATASET_RESULT_NAMESPACE, key(effect));
  if (!document) return;
  const record = decode(document.value, document.revision);
  const {approvalRevision: originalRevision, ...original} = record.owner;
  const {approvalRevision: requestedRevision, ...requested} = expected;
  if (JSON.stringify(original) !== JSON.stringify(requested) || originalRevision > requestedRevision ||
      (record.phase !== "committed" && originalRevision !== requestedRevision)) unavailable();
  if (record.phase !== "reserved") {
    const indexed = await owner.readDocument(taskIndex, taskKey(record.owner));
    if (!indexed || indexed.revision !== 1) unavailable();
    const index = readStrictPassiveRecord(indexed.value, ["effectKey", "saveId", "identityDigest"]);
    if (index.effectKey !== effect.key || index.saveId !== record.saveId || index.identityDigest !== sha(JSON.stringify(record.owner))) unavailable();
  }
  return record;
}

/** An immutable version is usable only with this exact causal committed receipt. */
export async function readCommittedStructuredDatasetResult(owner: StructuredDocumentStore, effect: DatasetResultSaveEffect,
  attempt?: {readonly saveId: string; readonly sourceDigest: string}) {
  const record = await read(owner, effect);
  if (record?.phase !== "committed" || !record.reference) return;
  if (attempt && (record.saveId !== attempt.saveId || record.sourceDigest !== attempt.sourceDigest)) unavailable();
  const version = await createStructuredDatasetVersionRepository(owner).readVersion(record.owner.workspaceId, record.reference.versionId);
  if (!version || version.versionDigest !== record.reference.versionDigest || version.datasetId !== record.reference.datasetId ||
      version.createdBy !== record.owner.principalId || version.documentation.name !== effect.request.input.outputBaseName ||
      version.lineage.quality.reportFingerprint !== `sha256:${effect.request.input.reportFingerprint}` ||
      version.lineage.quality.policyFingerprint !== record.policyFingerprint || version.totalRows !== record.acceptedRows) unavailable();
  return record.reference;
}

export async function inspectStructuredDatasetResultSave(owner: StructuredDocumentStore, effect: DatasetResultSaveEffect) {
  const record = await read(owner, effect);
  if (!record) return {kind: "absent" as const};
  if (record.phase !== "committed") return {kind: "unconfirmed" as const};
  const reference = await readCommittedStructuredDatasetResult(owner, effect);
  return reference ? {kind: "committed" as const, reference} : unavailable();
}

/** Reserve no file effect. An uncertain reservation never supplies a fresh save. */
export async function reserveStructuredDatasetResultSave(owner: StructuredDocumentStore, effect: DatasetResultSaveEffect,
  review: PreparedLocalDatasetReview, sourceDigest: string, now: number) {
  scoped(owner, effect, true);
  const actor = identity(effect), timestamp = time(now);
  const existing = await inspectStructuredDatasetResultSave(owner, effect);
  if (existing.kind !== "absent") return existing;
  if (!digest(sourceDigest) || !review.saveAvailable || !review.approvalAllowed || review.status === "blocked" ||
      review.taskId !== actor.taskId || review.reportFingerprint !== effect.request.input.reportFingerprint ||
      !policyDigest(review.policyFingerprint) || !rows(review.counts.acceptedRows) ||
      review.splits.trainRows + review.splits.validationRows + review.splits.testRows !== review.counts.acceptedRows ||
      !await readStructuredOwnedDatasetPlanTask(owner, effect.target.scope, actor.hostIncarnationId, actor.taskId)) unavailable();
  const countKey = `${actor.workspaceId}/${sha(JSON.stringify([actor.principalId, actor.registeredClientId]))}`;
  const counter = await owner.readDocument(counters, countKey);
  const used = counter ? readStrictPassiveRecord(counter.value, ["used"]).used : 0;
  if (typeof used !== "number" || !Number.isSafeInteger(used) || used < 0 || (counter && counter.revision !== used)) unavailable();
  if (used >= HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE) return {kind: "capacity" as const};
  const saveId = randomUUID();
  await owner.writeDocument(HEADLESS_DATASET_RESULT_NAMESPACE, key(effect), {version: 1, owner: actor, saveId, sourceDigest,
    policyFingerprint: review.policyFingerprint, acceptedRows: review.counts.acceptedRows, splits: {...review.splits},
    phase: "reserved", createdAt: timestamp, updatedAt: timestamp}, {expectedRevision: 0});
  await owner.writeDocument(counters, countKey, {used: used + 1}, {expectedRevision: counter?.revision ?? 0});
  return {kind: "new" as const, saveId};
}

/** The caller owns the exact current plan/report fence in this transaction. */
export async function issueStructuredDatasetResultSave(owner: StructuredDocumentStore, effect: DatasetResultSaveEffect,
  saveId: string, sourceDigest: string, now: number) {
  scoped(owner, effect, true);
  const record = await read(owner, effect);
  if (!record || record.phase !== "reserved" || record.saveId !== saveId || record.sourceDigest !== sourceDigest || time(now) < record.updatedAt) return false;
  if (!await readStructuredOwnedDatasetPlanTask(owner, effect.target.scope, record.owner.hostIncarnationId, record.owner.taskId)) return false;
  // One original task can have only one issued save. A merely reserved plan
  // does not prevent a separately approved attempt after a proven pre-issue denial.
  if (await owner.readDocument(taskIndex, taskKey(record.owner))) return false;
  await owner.writeDocument(taskIndex, taskKey(record.owner), {effectKey: effect.key, saveId,
    identityDigest: sha(JSON.stringify(record.owner))}, {expectedRevision: 0});
  await owner.writeDocument(HEADLESS_DATASET_RESULT_NAMESPACE, key(effect), {...record, phase: "issued", updatedAt: time(now)}, {expectedRevision: 1});
  return true;
}

/** Metadata only: version and causal receipt share the caller's owned commit. */
export async function commitStructuredDatasetResultSave(owner: StructuredDocumentStore, effect: DatasetResultSaveEffect,
  saveId: string, sourceDigest: string, input: DatasetVersionRecord, now: number) {
  scoped(owner, effect, true);
  const record = await read(owner, effect), version = normalizeDatasetVersionRecord(input);
  if (!record || record.saveId !== saveId || record.sourceDigest !== sourceDigest || time(now) < record.updatedAt ||
      version.organizationId !== owner.organizationId || version.workspaceId !== effect.target.scope.workspaceId ||
      version.createdBy !== effect.target.scope.principalId || version.documentation.name !== effect.request.input.outputBaseName ||
      version.lineage.quality.reportFingerprint !== `sha256:${effect.request.input.reportFingerprint}` ||
      version.lineage.quality.policyFingerprint !== record.policyFingerprint || version.totalRows !== record.acceptedRows) unavailable();
  for (const [role, count] of [["dataset", record.acceptedRows], ["train", record.splits.trainRows],
    ["validation", record.splits.validationRows], ["test", record.splits.testRows]] as const) {
    const artifact = version.artifacts.find(artifact => artifact.role === role);
    if ((count > 0 && !artifact) || (artifact && artifact.rowCount !== count)) unavailable();
  }
  if (record.phase === "committed") {
    const reference = await readCommittedStructuredDatasetResult(owner, effect);
    if (!reference || reference.versionId !== version.versionId || reference.versionDigest !== version.versionDigest) unavailable();
    const stored = await createStructuredDatasetVersionRepository(owner).readVersion(version.workspaceId, version.versionId);
    if (!isDeepStrictEqual(stored, version)) unavailable();
    return {version: stored!, created: false};
  }
  if (record.phase !== "issued" || !await readStructuredOwnedDatasetPlanTask(owner, effect.target.scope,
    record.owner.hostIncarnationId, record.owner.taskId)) unavailable();
  // A matching ordinary version is not a receipt for this approved effect.
  if (await owner.readDocument(DATASET_VERSION_NAMESPACE, `${version.workspaceId}/${version.versionId}`)) unavailable();
  const stored = await createStructuredDatasetVersionInOwnedTransaction(owner, version);
  const reference: HeadlessSavedDatasetReference = {workspaceId: stored.workspaceId, taskId: record.owner.taskId,
    datasetId: stored.datasetId, versionId: stored.versionId, versionDigest: stored.versionDigest};
  await owner.writeDocument(HEADLESS_DATASET_RESULT_NAMESPACE, key(effect), {...record, phase: "committed", reference,
    updatedAt: time(now)}, {expectedRevision: 2});
  return {version: stored, created: true};
}
