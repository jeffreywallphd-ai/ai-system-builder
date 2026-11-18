import {createHash, randomUUID} from "node:crypto";
import type {PreparedContextResultReview} from "../../../application/ports/context-management";
import type {HeadlessPlanReviewTarget} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import type {ContextSavedArtifactReference} from "../../../contracts/context-management";
import {CONTEXT_GENERATION_LIMITS, CONTEXT_MARKDOWN_PACK_MEDIA_TYPE, CONTEXT_RAG_DATABASE_MEDIA_TYPE} from "../../../contracts/context-management";
import {readHeadlessContextTaskValue} from "../../../contracts/headless/headless-context-task";
import {HEADLESS_MAX_BUILD_PLAN_STEPS, isDesktopHeadlessClientId, isHeadlessHostIncarnationId} from "../../../contracts/headless";
import {readStrictPassiveRecord, hasKnownPassiveCredential} from "../../../contracts/shared";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import type {StructuredDocumentStore} from "../shared";
import {createLocalArtifactCatalogPersistenceAdapter} from "../../storage/filesystem/artifact-catalog/createLocalArtifactCatalogAdapter";
import {createLocalArtifactStorageBindingAdapter} from "../../storage/filesystem/artifact-catalog/createLocalArtifactStorageBindingAdapter";
import {HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE} from "./createStructuredHeadlessOperationStore";
import {readStructuredOwnedContextPlanTaskSourceDigest} from "./createStructuredHeadlessContextPlanTaskStore";

const SAVES = "headless/context/result-saves", TASKS = "headless/context/result-save-tasks", COUNTS = "headless/context/result-save-counts";
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const contentDigest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
function unavailable(): never {throw new Error("The approved Context result save is unavailable.");}
function time(value: number) {if (!Number.isSafeInteger(value) || value < 1 || value > 8_640_000_000_000_000) unavailable(); return value;}

/** Internal effect data only. The caller must own the same root transaction's
 * exact current approval/policy fence. It is not a public save contract. */
export interface ContextResultSaveEffect {
  readonly key: string;
  readonly target: HeadlessPlanReviewTarget;
  readonly approvalRevision: number;
  readonly step: number;
  readonly taskId: string;
  readonly reportFingerprint: string;
}
function identity(effect: ContextResultSaveEffect) {
  const {target: {scope, hostIncarnationId, fingerprint}, taskId, reportFingerprint, approvalRevision, step} = effect;
  if (!isHeadlessHostIncarnationId(effect.key) || !isHeadlessHostIncarnationId(hostIncarnationId) || !isHeadlessHostIncarnationId(taskId) ||
      !isOrganizationId(scope.organizationId) || !isWorkspaceId(scope.workspaceId) || !isDesktopHeadlessClientId(scope.registeredClientId) ||
      typeof scope.principalId !== "string" || !scope.principalId || scope.principalId.length > 160 || hasKnownPassiveCredential(scope.principalId) ||
      !digest(fingerprint) || !digest(reportFingerprint) || !Number.isSafeInteger(approvalRevision) || approvalRevision < 1 ||
      !Number.isSafeInteger(step) || step < 1 || step > HEADLESS_MAX_BUILD_PLAN_STEPS) unavailable();
  return {hostIncarnationId, workspaceId: scope.workspaceId, principalId: scope.principalId, registeredClientId: scope.registeredClientId,
    fingerprint, approvalRevision, step, taskId, reportFingerprint};
}
function scope(owner: StructuredDocumentStore, effect: ContextResultSaveEffect, mutation = false) {
  if (owner.organizationId !== effect.target.scope.organizationId || (mutation && owner.runInOwnedTransaction)) unavailable();
}
const key = (effect: ContextResultSaveEffect) => `${effect.target.scope.workspaceId}/${effect.key}`;
const taskKey = (actor: ReturnType<typeof identity>) => `${actor.workspaceId}/${sha(JSON.stringify([
  actor.hostIncarnationId, actor.principalId, actor.registeredClientId, actor.taskId]))}`;

function readReview(value: unknown, taskId: string): PreparedContextResultReview {
  const row = readStrictPassiveRecord(value, ["review", "name", "commandDigest", "output"]);
  const review = readHeadlessContextTaskValue({taskId, state: "review-required", review: row.review}, {kind: "task", taskId})?.review;
  const output = readStrictPassiveRecord(row.output, ["name", "outputHandle", "mediaType", "sizeBytes", "digest"]);
  const mediaType = review?.kind === "rag-database" ? CONTEXT_RAG_DATABASE_MEDIA_TYPE : CONTEXT_MARKDOWN_PACK_MEDIA_TYPE;
  if (!review || typeof row.name !== "string" || !row.name.trim() || row.name.length > 160 || /[\x00-\x1f]/.test(row.name) ||
      !contentDigest(row.commandDigest) || typeof output.name !== "string" || !output.name || output.name.length > 201 || /[\\/\x00-\x1f]/.test(output.name) ||
      typeof output.outputHandle !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(output.outputHandle) ||
      output.mediaType !== mediaType ||
      !Number.isSafeInteger(output.sizeBytes) || (output.sizeBytes as number) < 1 || (output.sizeBytes as number) > CONTEXT_GENERATION_LIMITS.maximumArtifactBytes ||
      output.sizeBytes !== review.sizeBytes || !contentDigest(output.digest) ||
      review.reportFingerprint !== sha(JSON.stringify({requestId: taskId, outputDigest: output.digest, sizeBytes: output.sizeBytes,
        commandDigest: row.commandDigest, sourceCount: review.sourceCount, chunkCount: review.chunkCount}))) unavailable();
  return {review, name: row.name, commandDigest: row.commandDigest, output: {name: output.name, outputHandle: output.outputHandle,
    mediaType, sizeBytes: output.sizeBytes as number, digest: output.digest}};
}
function decode(value: unknown, revision: number, effect: ContextResultSaveEffect) {
  const row = readStrictPassiveRecord(value, ["version", "owner", "saveId", "sourceDigest", "prepared", "phase", "createdAt", "updatedAt"]);
  const owner = readStrictPassiveRecord(row.owner, ["hostIncarnationId", "workspaceId", "principalId", "registeredClientId", "fingerprint",
    "approvalRevision", "step", "taskId", "reportFingerprint"]);
  const expected = identity(effect), {approvalRevision: expectedRevision, ...stable} = expected;
  const {approvalRevision: recordedRevision, ...saved} = owner;
  if (row.version !== 1 || !isHeadlessHostIncarnationId(row.saveId) || !digest(row.sourceDigest) ||
      Object.keys(saved).length !== Object.keys(stable).length ||
      !Object.entries(stable).every(([key, value]) => saved[key] === value) ||
      typeof recordedRevision !== "number" || !Number.isSafeInteger(recordedRevision) ||
      recordedRevision < 1 || recordedRevision > expectedRevision ||
      (row.phase !== "committed" && recordedRevision !== expectedRevision) ||
      (row.phase !== "reserved" && row.phase !== "issued" && row.phase !== "committed") ||
      revision !== (row.phase === "reserved" ? 1 : row.phase === "issued" ? 2 : 3) ||
      typeof row.createdAt !== "number" || typeof row.updatedAt !== "number" || time(row.createdAt) > time(row.updatedAt)) unavailable();
  const prepared = readReview(row.prepared, expected.taskId);
  if (prepared.review.reportFingerprint !== expected.reportFingerprint) unavailable();
  // Reconstruct canonical owner order for the private identity digest. Persisted
  // JSONB object key order is not part of task, actor or approval identity.
  return {version: 1 as const, owner: {...expected, approvalRevision: recordedRevision}, saveId: row.saveId,
    sourceDigest: row.sourceDigest, prepared, phase: row.phase as "reserved" | "issued" | "committed",
    createdAt: row.createdAt, updatedAt: row.updatedAt};
}
async function read(owner: StructuredDocumentStore, effect: ContextResultSaveEffect) {
  scope(owner, effect);
  const document = await owner.readDocument(SAVES, key(effect));
  if (!document) {identity(effect); return;}
  const record = decode(document.value, document.revision, effect);
  if (record.phase !== "reserved") {
    const index = await owner.readDocument(TASKS, taskKey(record.owner));
    if (!index || index.revision !== 1) unavailable();
    const value = readStrictPassiveRecord(index.value, ["effectKey", "saveId", "identityDigest"]);
    if (value.effectKey !== effect.key || value.saveId !== record.saveId || value.identityDigest !== sha(JSON.stringify(record.owner))) unavailable();
  }
  return record;
}
function artifact(record: NonNullable<Awaited<ReturnType<typeof read>>>): ContextSavedArtifactReference {
  const storageKey = `workspaces/${record.owner.workspaceId}/artifacts/context/${record.saveId.replace(/-/g, "")}`;
  return {artifactId: storageKey, storageKey, kind: record.prepared.review.kind, name: record.prepared.name,
    mediaType: record.prepared.output.mediaType, sizeBytes: record.prepared.output.sizeBytes, digest: record.prepared.output.digest};
}

/** Receipt-backed metadata read only; no source, output, runtime or model IO. */
export async function readCommittedStructuredContextResult(owner: StructuredDocumentStore, rootDirectory: string,
  effect: ContextResultSaveEffect, attempt?: {readonly saveId: string; readonly sourceDigest: string}) {
  const record = await read(owner, effect);
  if (record?.phase !== "committed") return;
  if (attempt && (record.saveId !== attempt.saveId || record.sourceDigest !== attempt.sourceDigest)) unavailable();
  const expected = artifact(record), context = effect.target.scope;
  const catalog = await createLocalArtifactCatalogPersistenceAdapter({rootDirectory, documents: owner}).readArtifactCatalogRecord(
    {workspaceId: context.workspaceId, storageKey: expected.storageKey}, context);
  const bindings = await createLocalArtifactStorageBindingAdapter({rootDirectory, documents: owner}).readArtifactStorageBindings(
    {workspaceId: context.workspaceId, artifactId: expected.artifactId}, context);
  const createdAt = new Date(record.createdAt).toISOString();
  if (!catalog.ok || catalog.value.record.workspaceId !== context.workspaceId || catalog.value.record.storageKey !== expected.storageKey ||
      catalog.value.record.artifactFamily !== "binary" ||
      catalog.value.record.mediaType !== expected.mediaType || catalog.value.record.sizeBytes !== expected.sizeBytes || catalog.value.record.sourceKind !== "generated" ||
      catalog.value.record.originalName !== record.prepared.output.name || catalog.value.record.createdAt !== createdAt ||
      catalog.value.record.checksum?.algorithm !== "sha256" || catalog.value.record.checksum.value !== expected.digest.slice(7) || !bindings.ok) unavailable();
  const primary = bindings.value.bindings.filter(binding => binding.role === "primary");
  if (primary.length !== 1 || primary[0].workspaceId !== context.workspaceId || primary[0].artifactId !== expected.artifactId ||
      primary[0].createdAt !== createdAt || primary[0].backing.kind !== "artifact-object" || primary[0].backing.provider !== "local-filesystem" ||
      primary[0].backing.locator !== expected.storageKey) unavailable();
  return {contextId: record.saveId, artifact: expected};
}
export async function inspectStructuredContextResultSave(owner: StructuredDocumentStore, rootDirectory: string, effect: ContextResultSaveEffect) {
  const record = await read(owner, effect);
  if (!record) return {kind: "absent" as const};
  if (record.phase !== "committed") return {kind: "unconfirmed" as const};
  const committed = await readCommittedStructuredContextResult(owner, rootDirectory, effect);
  return committed ? {kind: "committed" as const, ...committed} : unavailable();
}

/** Caller-owned metadata transaction and current approval/review fence only. */
export async function reserveStructuredContextResultSave(owner: StructuredDocumentStore, effect: ContextResultSaveEffect,
  prepared: PreparedContextResultReview, sourceDigest: string, now: number) {
  scope(owner, effect, true);
  const actor = identity(effect), timestamp = time(now), previous = await read(owner, effect);
  if (previous) return {kind: "unconfirmed" as const};
  const checked = readReview(prepared, actor.taskId);
  if (checked.review.reportFingerprint !== effect.reportFingerprint || !digest(sourceDigest) ||
      await readStructuredOwnedContextPlanTaskSourceDigest(owner, effect.target.scope, actor.hostIncarnationId, actor.taskId) !== sourceDigest) unavailable();
  const countKey = `${actor.workspaceId}/${sha(JSON.stringify([actor.principalId, actor.registeredClientId]))}`;
  const count = await owner.readDocument(COUNTS, countKey), used = count ? readStrictPassiveRecord(count.value, ["used"]).used : 0;
  if (typeof used !== "number" || !Number.isSafeInteger(used) || used < 0 || (count && count.revision !== used)) unavailable();
  if (used >= HEADLESS_RECEIPTS_PER_CLIENT_WORKSPACE) return {kind: "capacity" as const};
  const saveId = randomUUID();
  await owner.writeDocument(SAVES, key(effect), {version: 1, owner: actor, saveId, sourceDigest, prepared: checked,
    phase: "reserved", createdAt: timestamp, updatedAt: timestamp}, {expectedRevision: 0});
  await owner.writeDocument(COUNTS, countKey, {used: used + 1}, {expectedRevision: count?.revision ?? 0});
  return {kind: "new" as const, saveId};
}
export async function issueStructuredContextResultSave(owner: StructuredDocumentStore, effect: ContextResultSaveEffect,
  saveId: string, sourceDigest: string, now: number) {
  scope(owner, effect, true);
  const record = await read(owner, effect);
  if (!record || record.phase !== "reserved" || record.saveId !== saveId || record.sourceDigest !== sourceDigest || time(now) < record.updatedAt ||
      await readStructuredOwnedContextPlanTaskSourceDigest(owner, effect.target.scope, record.owner.hostIncarnationId, record.owner.taskId) !== sourceDigest ||
      await owner.readDocument(TASKS, taskKey(record.owner))) return false;
  await owner.writeDocument(TASKS, taskKey(record.owner), {effectKey: effect.key, saveId,
    identityDigest: sha(JSON.stringify(record.owner))}, {expectedRevision: 0});
  await owner.writeDocument(SAVES, key(effect), {...record, phase: "issued", updatedAt: time(now)}, {expectedRevision: 1});
  return true;
}

/** Bytes are already acknowledged. Catalog, primary binding and causal receipt
 * commit together in this transaction. Existing ordinary records are not adopted. */
export async function commitStructuredContextResultSave(owner: StructuredDocumentStore, rootDirectory: string, effect: ContextResultSaveEffect,
  saveId: string, sourceDigest: string, candidate: ContextSavedArtifactReference, now: number) {
  scope(owner, effect, true);
  const record = await read(owner, effect);
  if (!record || record.saveId !== saveId || record.sourceDigest !== sourceDigest || time(now) < record.updatedAt) unavailable();
  const expected = artifact(record), supplied = readStrictPassiveRecord(candidate, Object.keys(expected));
  if (Object.keys(supplied).length !== Object.keys(expected).length || !Object.entries(expected).every(([key, value]) => supplied[key] === value)) unavailable();
  if (record.phase === "committed") return {...(await readCommittedStructuredContextResult(owner, rootDirectory, effect))!, created: false};
  if (record.phase !== "issued" || await readStructuredOwnedContextPlanTaskSourceDigest(owner, effect.target.scope,
    record.owner.hostIncarnationId, record.owner.taskId) !== sourceDigest) unavailable();
  const context = effect.target.scope, createdAt = new Date(record.createdAt).toISOString();
  const catalog = createLocalArtifactCatalogPersistenceAdapter({rootDirectory, documents: owner});
  const bindings = createLocalArtifactStorageBindingAdapter({rootDirectory, documents: owner});
  const registered = await catalog.createArtifactCatalogRecordIfAbsent({record: {workspaceId: context.workspaceId,
    storageKey: expected.storageKey, artifactFamily: "binary", mediaType: expected.mediaType, sizeBytes: expected.sizeBytes,
    sourceKind: "generated", originalName: record.prepared.output.name, createdAt,
    checksum: {algorithm: "sha256", value: expected.digest.slice(7)}}}, context);
  if (!registered.ok) unavailable();
  const bound = await bindings.createArtifactStorageBindingIfAbsent({binding: {workspaceId: context.workspaceId, artifactId: expected.artifactId,
    role: "primary", backing: {kind: "artifact-object", provider: "local-filesystem", locator: expected.storageKey}, createdAt}}, context);
  if (!bound.ok) unavailable();
  await owner.writeDocument(SAVES, key(effect), {...record, phase: "committed", updatedAt: time(now)}, {expectedRevision: 2});
  return {contextId: saveId, artifact: expected, created: true};
}
