import {createHash} from "node:crypto";
import {isDeepStrictEqual, types} from "node:util";
import path from "node:path";
import type {ApprovedModelSourceRegistrationPreparation} from "../../../application/ports/model";
import type {HeadlessPlanReviewTarget} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import {HEADLESS_MAX_BUILD_PLAN_STEPS, isDesktopHeadlessClientId, isHeadlessHostIncarnationId,
  readHeadlessModelDownloadReviewValue} from "../../../contracts/headless";
import {readModelDownloadSource, type ModelInventoryRecord} from "../../../contracts/model";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import type {StructuredDocumentStore} from "../shared";
import {createLocalModelRegistryAdapter} from "../model/createLocalModelRegistryAdapter";

const SAVES = "headless/models/reference-saves", SOURCES = "headless/models/reference-save-sources";
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function unavailable(): never {throw new Error("The approved Model reference save is unavailable.");}

/** Private exact-save identity. The caller must enforce a NEW save approval and
 * current ModelRead/Write in this same transaction. Download approval is not enough. */
export interface ModelReferenceSaveEffect {
  readonly key: string;
  readonly target: HeadlessPlanReviewTarget;
  readonly approvalRevision: number;
  readonly step: number;
  readonly taskId: string;
  readonly manifestDigest: string;
  readonly name: string;
}
export function captureModelReferenceSaveEffect(value: ModelReferenceSaveEffect): ModelReferenceSaveEffect {
  if (types.isProxy(value)) unavailable();
  const fields = readStrictPassiveRecord(value, ["key", "target", "approvalRevision", "step", "taskId", "manifestDigest", "name"]);
  if (types.isProxy(fields.target)) unavailable();
  const fieldsTarget = readStrictPassiveRecord(fields.target, ["hostIncarnationId", "scope", "fingerprint"]);
  if (types.isProxy(fieldsTarget.scope)) unavailable();
  const row = readStrictPassiveRecord(copyBoundedPassiveData(fields),
    ["key", "target", "approvalRevision", "step", "taskId", "manifestDigest", "name"]);
  const target = readStrictPassiveRecord(row.target, ["hostIncarnationId", "scope", "fingerprint"]);
  const scope = readStrictPassiveRecord(target.scope, ["organizationId", "workspaceId", "principalId", "registeredClientId"]);
  if (!isHeadlessHostIncarnationId(row.key) || !isHeadlessHostIncarnationId(row.taskId) ||
      !isHeadlessHostIncarnationId(target.hostIncarnationId) || !digest(target.fingerprint) ||
      !isOrganizationId(scope.organizationId) || !isWorkspaceId(scope.workspaceId) || !isDesktopHeadlessClientId(scope.registeredClientId) ||
      typeof scope.principalId !== "string" || !scope.principalId || scope.principalId.length > 160 || hasKnownPassiveCredential(scope.principalId) ||
      !Number.isSafeInteger(row.approvalRevision) || (row.approvalRevision as number) < 1 ||
      !Number.isSafeInteger(row.step) || (row.step as number) < 1 || (row.step as number) > HEADLESS_MAX_BUILD_PLAN_STEPS ||
      typeof row.manifestDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(row.manifestDigest) ||
      typeof row.name !== "string" || !row.name || row.name.trim() !== row.name || row.name.length > 160 ||
      /[\x00-\x1f\x7f]/.test(row.name) || hasKnownPassiveCredential(row.name)) unavailable();
  return Object.freeze({key: row.key, taskId: row.taskId, manifestDigest: row.manifestDigest, name: row.name,
    approvalRevision: row.approvalRevision as number, step: row.step as number,
    target: Object.freeze({hostIncarnationId: target.hostIncarnationId, fingerprint: target.fingerprint,
      scope: Object.freeze({organizationId: scope.organizationId, workspaceId: scope.workspaceId,
        principalId: scope.principalId, registeredClientId: scope.registeredClientId})})});
}
function partition(owner: StructuredDocumentStore, effect: ModelReferenceSaveEffect, mutation = false) {
  if (owner.organizationId !== effect.target.scope.organizationId || (mutation && owner.runInOwnedTransaction)) unavailable();
}
const key = (effect: ModelReferenceSaveEffect) => `${effect.target.scope.workspaceId}/${effect.key}`;
const sourceKey = (effect: ModelReferenceSaveEffect) => `${effect.target.scope.workspaceId}/${sha(JSON.stringify([
  effect.target.hostIncarnationId, effect.target.scope.principalId, effect.target.scope.registeredClientId, effect.taskId]))}`;
const modelId = (effect: ModelReferenceSaveEffect) => `model_headless_${sha(JSON.stringify([
  effect.target.scope.organizationId, effect.target.scope.workspaceId, effect.key])).slice(0, 32)}`;
function registry(owner: StructuredDocumentStore, rootDirectory: string) {
  return createLocalModelRegistryAdapter({documents: owner, rootDirectory,
    filePath: path.join(rootDirectory, "model-registry", "models.json"), discovery: {enabled: false}});
}
// JSONB can reorder object keys. Hash canonical JSON, preserving array order and
// ALL persisted record fields so edited/deleted/ambiguous records cannot replay.
function recordDigest(value: unknown): string {
  function order(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(order);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, child]) => [key, order(child)]));
    return item;
  }
  return sha(JSON.stringify(order(JSON.parse(JSON.stringify(value)))));
}
async function recorded(owner: StructuredDocumentStore, effect: ModelReferenceSaveEffect) {
  const document = await owner.readDocument<{models?: ModelInventoryRecord[]}>("model-registry", "models.json");
  if (!document) return;
  if (!Array.isArray(document.value?.models)) unavailable();
  const matches = document.value.models.filter(row => row?.workspaceId === effect.target.scope.workspaceId && row.modelRecordId === modelId(effect));
  if (matches.length > 1) unavailable();
  return matches[0];
}
export interface SavedHeadlessModelReference {
  readonly workspaceId: HeadlessPlanReviewTarget["scope"]["workspaceId"];
  readonly modelRecordId: string;
  readonly taskId: string;
  readonly manifestDigest: string;
  readonly storageAuthority: "reference-only";
  readonly runtimeReadiness: "not-checked";
}
function reference(effect: ModelReferenceSaveEffect): SavedHeadlessModelReference {
  return Object.freeze({workspaceId: effect.target.scope.workspaceId, modelRecordId: modelId(effect), taskId: effect.taskId,
    manifestDigest: effect.manifestDigest, storageAuthority: "reference-only", runtimeReadiness: "not-checked"});
}
/** Point reads only; matching causal receipt AND unchanged library row required. */
export async function inspectStructuredModelReferenceSave(owner: StructuredDocumentStore, raw: ModelReferenceSaveEffect) {
  const effect = captureModelReferenceSaveEffect(raw); partition(owner, effect);
  const document = await owner.readDocument(SAVES, key(effect));
  const index = await owner.readDocument(SOURCES, sourceKey(effect));
  if (!document) {if (index) unavailable(); return {kind: "absent"} as const;}
  const row = readStrictPassiveRecord(document.value, ["version", "effect", "sourceDigest", "modelRecordDigest", "createdAt"]);
  if (row.version !== 1 || document.revision !== 1 || !digest(row.sourceDigest) || !digest(row.modelRecordDigest) ||
      row.sourceDigest !== effect.manifestDigest.slice(7) || !Number.isSafeInteger(row.createdAt) || (row.createdAt as number) < 1 ||
      (row.createdAt as number) > 8_640_000_000_000_000) unavailable();
  const saved = captureModelReferenceSaveEffect(row.effect as ModelReferenceSaveEffect);
  if (saved.approvalRevision > effect.approvalRevision || !isDeepStrictEqual({...saved, approvalRevision: effect.approvalRevision}, effect) ||
      !index || index.revision !== 1) unavailable();
  const indexed = readStrictPassiveRecord(index.value, ["key", "modelRecordId"]);
  if (indexed.key !== effect.key || indexed.modelRecordId !== modelId(effect)) unavailable();
  const model = await recorded(owner, effect);
  if (!model || recordDigest(model) !== row.modelRecordDigest) unavailable();
  return {kind: "committed", reference: reference(effect)} as const;
}
/** Metadata only, called inside an existing root-owned organization transaction.
 * The source ledger/approval/current-policy and source-lifetime proof belong to
 * the caller. No cache inspection, physical ownership or runtime readiness. */
export async function commitStructuredModelReferenceSave(owner: StructuredDocumentStore, rootDirectory: string,
  raw: ModelReferenceSaveEffect, preparation: ApprovedModelSourceRegistrationPreparation, sourceDigest: string, now: number) {
  const effect = captureModelReferenceSaveEffect(raw); partition(owner, effect, true);
  if (!digest(sourceDigest) || effect.manifestDigest !== "sha256:" + sourceDigest || !Number.isSafeInteger(now) ||
      now < 1 || now > 8_640_000_000_000_000) unavailable();
  const existing = await inspectStructuredModelReferenceSave(owner, effect);
  if (existing.kind === "committed") return {...existing, created: false};
  const proposedSource = preparation.sourceManifest.source;
  const source = readModelDownloadSource(proposedSource,
    {provider: proposedSource.provider, modelId: proposedSource.modelId, revision: proposedSource.revision});
  const review = preparation.review;
  const {requestId, ...metadata} = readStrictPassiveRecord(copyBoundedPassiveData(review), ["requestId", "workspaceId", "modelId", "revision",
    "manifestDigest", "format", "license", "selectedFileCount", "totalBytes", "fromCache", "selectedFilesVerification", "runtimeReadiness"]);
  const checked = readHeadlessModelDownloadReviewValue({...metadata, taskId: requestId,
    plan: {fingerprint: effect.target.fingerprint, step: effect.step}, registration: "requires-separate-approval"},
    {hostIncarnationId: effect.target.hostIncarnationId, workspaceId: effect.target.scope.workspaceId, selection: {kind: "task", taskId: effect.taskId}});
  const localPath = preparation.localPath;
  const syntax = typeof localPath === "string" && (path.win32.isAbsolute(localPath) ? path.win32 : path.posix);
  if (!checked || preparation.storageAuthority !== "reference-only" || preparation.sourceManifest.manifestDigest !== effect.manifestDigest ||
      sha(JSON.stringify(source)) !== sourceDigest || checked.manifestDigest !== effect.manifestDigest ||
      checked.modelId !== source.modelId || checked.revision !== source.revision || checked.format !== source.format ||
      !isDeepStrictEqual(checked.license, source.license) || checked.totalBytes !== source.totalBytes || checked.selectedFileCount !== source.files.length ||
      !syntax || !syntax.isAbsolute(localPath) || syntax.normalize(localPath) !== localPath || syntax.parse(localPath).root === localPath ||
      localPath.length > 32760 || /[\x00-\x1f\x7f]/.test(localPath) || localPath.startsWith("\\\\") || localPath.startsWith("//")) unavailable();
  if (await recorded(owner, effect)) unavailable(); // Never replace an ordinary/foreign record.
  const result = await registry(owner, rootDirectory).registerDownloadedModel({workspaceId: effect.target.scope.workspaceId,
    modelRecordId: modelId(effect), displayName: effect.name, source: "huggingface", provider: "huggingface", modelId: source.modelId,
    localPath, artifactForm: "full-model", serializationFormat: "safetensors", sizeBytes: source.totalBytes,
    metadata: {headlessReference: {version: 1, taskId: effect.taskId, revision: source.revision, manifestDigest: effect.manifestDigest,
      license: source.license, storageAuthority: "reference-only", selectedFilesVerification: "verified-at-completion", runtimeReadiness: "not-checked"}}});
  const stored = await recorded(owner, effect);
  if (!stored || !isDeepStrictEqual(stored, JSON.parse(JSON.stringify(result.model)))) unavailable();
  await owner.writeDocument(SAVES, key(effect), {version: 1, effect, sourceDigest, modelRecordDigest: recordDigest(stored), createdAt: now}, {expectedRevision: 0});
  await owner.writeDocument(SOURCES, sourceKey(effect), {key: effect.key, modelRecordId: modelId(effect)}, {expectedRevision: 0});
  return {kind: "committed", reference: reference(effect), created: true} as const;
}
