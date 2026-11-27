import {createHash} from "node:crypto";
import {isDeepStrictEqual, types} from "node:util";
import path from "node:path";
import type {ApprovedModelSourceRegistrationPreparation, ApprovedLocalTrainingSavePreparation} from "../../../application/ports/model";
import type {HeadlessPlanReviewTarget} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import {HEADLESS_MAX_BUILD_PLAN_STEPS, isDesktopHeadlessClientId, isHeadlessHostIncarnationId,
  readHeadlessModelDownloadReviewValue, readHeadlessModelTrainingSavePlanRequest, readHeadlessTrainingCompletionValue,
  HEADLESS_CONTRACT_VERSION} from "../../../contracts/headless";
import {readModelDownloadSource, readModelTrainingExecutionHistory, type ModelInventoryRecord} from "../../../contracts/model";
import {readStructuredTrainingPlanTaskLineage} from "./createStructuredHeadlessTrainingPlanTaskStore";
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

const TRAINED_SAVES = "headless/models/training-saves", TRAINED_SOURCES = "headless/models/training-save-sources";
export interface ModelTrainingSaveEffect extends Omit<ModelReferenceSaveEffect, "manifestDigest"> {
  readonly candidateDigest: string;
}
/** Reject active native objects before the portable passive copier reflects them. */
function trainingData<T>(raw: T): T {
  let nodes = 0; const ancestors = new Set<object>();
  function inspect(value: unknown, depth: number) {
    if (++nodes > 8192 || depth > 24) unavailable();
    if (!value || typeof value !== "object") return;
    if (types.isProxy(value) || ancestors.has(value)) unavailable();
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value);
    if ((array ? proto !== Array.prototype || value.length > 1024 || keys.length !== value.length + 1
      : proto !== Object.prototype && proto !== null || keys.length > 128)) unavailable();
    ancestors.add(value);
    for (const key of keys) {
      if (array && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key) || !d || !("value" in d) || !d.enumerable ||
          array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) unavailable();
      inspect(d.value, depth + 1);
    }
    ancestors.delete(value);
  }
  inspect(raw, 0); return copyBoundedPassiveData(raw) as T;
}
function exactTraining(raw: unknown, keys: readonly string[]) {
  const row = readStrictPassiveRecord(raw, keys); if (Object.keys(row).length !== keys.length) unavailable(); return row;
}
export function captureModelTrainingSaveEffect(raw: ModelTrainingSaveEffect): ModelTrainingSaveEffect {
  const r = exactTraining(trainingData(raw), ["key", "target", "approvalRevision", "step", "taskId", "candidateDigest", "name"]);
  const {candidateDigest, ...rest} = r;
  const common = captureModelReferenceSaveEffect({...rest, manifestDigest: candidateDigest} as unknown as ModelReferenceSaveEffect);
  const parsed = readHeadlessModelTrainingSavePlanRequest({version: HEADLESS_CONTRACT_VERSION, operation: "models.save-training", input: {
    hostIncarnationId: common.target.hostIncarnationId, workspaceId: common.target.scope.workspaceId, idempotencyKey: common.key,
    taskId: common.taskId, candidateDigest: common.manifestDigest, name: common.name}}, common.target.hostIncarnationId);
  if (!parsed.ok) unavailable();
  return Object.freeze({key: common.key, target: common.target, approvalRevision: common.approvalRevision, step: common.step,
    taskId: common.taskId, candidateDigest: common.manifestDigest, name: common.name});
}
const trainingKey = (e: ModelTrainingSaveEffect) => `${e.target.scope.workspaceId}/${e.key}`;
const trainingSourceKey = (e: ModelTrainingSaveEffect) => `${e.target.scope.workspaceId}/${sha(JSON.stringify([
  e.target.hostIncarnationId, e.target.scope.principalId, e.target.scope.registeredClientId, e.taskId]))}`;
const trainedModelId = (e: ModelTrainingSaveEffect) => `model_headless_trained_${sha(JSON.stringify([
  e.target.scope.organizationId, e.target.scope.workspaceId, e.key])).slice(0, 32)}`;
function trainingPartition(owner: StructuredDocumentStore, effect: ModelTrainingSaveEffect, mutation = false) {
  if (owner.organizationId !== effect.target.scope.organizationId || mutation && owner.runInOwnedTransaction) unavailable();
}
async function trainedRecord(owner: StructuredDocumentStore, effect: ModelTrainingSaveEffect, id = trainedModelId(effect)) {
  const document = await owner.readDocument<{models?: ModelInventoryRecord[]}>("model-registry", "models.json"); if (!document) return;
  if (!Array.isArray(document.value?.models)) unavailable();
  const matches = document.value.models.filter(r => r?.workspaceId === effect.target.scope.workspaceId && r.modelRecordId === id);
  if (matches.length > 1) unavailable(); return matches[0];
}
function trainingReference(effect: ModelTrainingSaveEffect) {
  return Object.freeze({workspaceId: effect.target.scope.workspaceId, modelRecordId: trainedModelId(effect), taskId: effect.taskId,
    candidateDigest: effect.candidateDigest, storageProfile: "bounded-local-v1" as const, runtimeReadiness: "not-checked" as const});
}
/** Read-only causal replay: exact effect, original index and unchanged Model.
 * Current exact Save/ModelRead/Write policy remains the owning caller's duty. */
export async function inspectStructuredModelTrainingSave(owner: StructuredDocumentStore, raw: ModelTrainingSaveEffect) {
  const effect = captureModelTrainingSaveEffect(raw); trainingPartition(owner, effect);
  const document = await owner.readDocument(TRAINED_SAVES, trainingKey(effect)), index = await owner.readDocument(TRAINED_SOURCES, trainingSourceKey(effect));
  if (!document) {if (index) unavailable(); return {kind: "absent"} as const;}
  const row = exactTraining(trainingData(document.value), ["version", "effect", "modelRecordDigest", "createdAt"]);
  if (row.version !== 1 || document.revision !== 1 || !digest(row.modelRecordDigest) || !Number.isSafeInteger(row.createdAt) ||
      (row.createdAt as number) < 1 || (row.createdAt as number) > 8_640_000_000_000_000 || !index || index.revision !== 1) unavailable();
  const saved = captureModelTrainingSaveEffect(row.effect as ModelTrainingSaveEffect);
  if (saved.approvalRevision > effect.approvalRevision || !isDeepStrictEqual({...saved, approvalRevision: effect.approvalRevision}, effect)) unavailable();
  const indexed = exactTraining(trainingData(index.value), ["key", "modelRecordId"]);
  const model = await trainedRecord(owner, effect);
  if (indexed.key !== effect.key || indexed.modelRecordId !== trainedModelId(effect) || !model || recordDigest(model) !== row.modelRecordDigest) unavailable();
  return {kind: "committed", reference: trainingReference(effect)} as const;
}
const privateDirectory = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 32760 &&
  path.isAbsolute(v) && path.normalize(v) === v && path.parse(v).root !== v && !/^[\\/]{2}|[\x00-\x1f\x7f]/.test(v);
const ordered = (r: object, keys: readonly string[]) => Object.fromEntries(keys.map(k => [k, (r as Record<string, unknown>)[k]]));
function trainingPreparation(raw: ApprovedLocalTrainingSavePreparation, effect: ModelTrainingSaveEffect,
  lineage: NonNullable<Awaited<ReturnType<typeof readStructuredTrainingPlanTaskLineage>>>) {
  const r = exactTraining(raw, ["schema", "taskId", "workspaceId", "saveId", "name", "candidate", "storage"]);
  if (r.schema !== "approved-training-save-preparation-v1" || r.taskId !== effect.taskId || r.workspaceId !== effect.target.scope.workspaceId ||
      r.saveId !== effect.key || r.name !== effect.name) unavailable();
  const candidate = readStrictPassiveRecord(r.candidate, ["kind", "requestId", "workspaceId", "history", "retainedFiles", "candidateDigest", "execution"]);
  if (candidate.kind !== "ready" || candidate.requestId !== effect.taskId || candidate.workspaceId !== r.workspaceId ||
      candidate.candidateDigest !== effect.candidateDigest || Object.keys(candidate).length !== (candidate.execution === undefined ? 6 : 7)) unavailable();
  const h = exactTraining(candidate.history, ["kind", "requestId", "workspaceId", "provenance", "candidate", "comparison", "verification", "registration"]);
  if (h.kind !== "ready" || h.requestId !== effect.taskId || h.workspaceId !== r.workspaceId) unavailable();
  const {kind: _kind, requestId: _requestId, ...publicHistory} = h;
  const decoded = readHeadlessTrainingCompletionValue({...publicHistory, taskId: effect.taskId, plan: {fingerprint: lineage.target.fingerprint, step: lineage.step}});
  if (!decoded || decoded.provenance.proposalDigest !== lineage.proposalDigest ||
      !["llm-instruction", "llm-classification", "llm-extraction", "llm-embedding", "llm-reranker"].includes(decoded.provenance.trainingTask!)) unavailable();
  const p = ordered(decoded.provenance, ["modelRecordId", "modelUpdatedAt", "datasetId", "versionId", "versionDigest", "recipeDigest", "proposalDigest",
    "trainingTask", "method", "trainingInputCount", "validationInputCount", "inputBytes", "recipeBytes"]);
  const c = ordered(decoded.candidate, ["requestedName", "artifactForm", "serializationFormat", "recordedSizeBytes"]);
  const comparison = decoded.comparison.state === "not-recorded" ? {state: "not-recorded"} : {state: "recorded", report: ordered(decoded.comparison.report,
    ["protocol", "maximumRows", "sampleCount", "baselineLoss", "trainedLoss", "lossDelta", "interpretation"])};
  const history = {kind: "ready", requestId: effect.taskId, workspaceId: effect.target.scope.workspaceId, provenance: p, candidate: c, comparison,
    verification: ordered(decoded.verification, ["inputs", "retainedFiles", "runtimeReadiness", "hardware", "outputQuality"]), registration: decoded.registration};
  const execution = candidate.execution === undefined ? undefined : readModelTrainingExecutionHistory(candidate.execution);
  if (candidate.execution !== undefined && !execution) unavailable();
  const inventory = exactTraining(candidate.retainedFiles, ["schema", "publicationId", "totalBytes", "files", "verification", "manifestDigest"]);
  if (inventory.schema !== "training-result-finalized-files-v1" || inventory.verification !== "sha256-current-local-v1" || typeof inventory.publicationId !== "string" ||
      !/^[a-f0-9]{32}$/.test(inventory.publicationId) || !Array.isArray(inventory.files) || inventory.files.length < 3 || inventory.files.length > 256) unavailable();
  const names = new Set(["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "added_tokens.json",
    "vocab.json", "merges.txt", "model.safetensors", "adapter_config.json", "adapter_model.safetensors", "serialization_manifest.json", "training-run.json"]);
  const seen = new Set<string>(); let total = 0, group = 0;
  const files = inventory.files.map((item, index) => {
    const f = exactTraining(item, ["fileIndex", "groupIndex", "name", "role", "mediaType", "expectedSizeBytes", "expectedSha256", "key"]);
    if (f.fileIndex !== index || !Number.isSafeInteger(f.groupIndex) || (f.groupIndex as number) < 0 || (f.groupIndex as number) > 255 ||
        f.groupIndex !== group && !(index > 0 && f.groupIndex === group + 1) || typeof f.name !== "string" || !names.has(f.name) ||
        !["checkpoint", "candidate"].includes(f.role as string) || f.mediaType !== (f.name.endsWith(".json") ? "application/json" : "application/octet-stream") ||
        !Number.isSafeInteger(f.expectedSizeBytes) || (f.expectedSizeBytes as number) < 1 || (f.expectedSizeBytes as number) > Number.MAX_SAFE_INTEGER - total ||
        typeof f.expectedSha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(f.expectedSha256) ||
        f.key !== `workspaces/${effect.target.scope.workspaceId}/artifacts/training-results/${inventory.publicationId}/${index}`) unavailable();
    group = f.groupIndex as number; total += f.expectedSizeBytes as number;
    const unique = `${group}/${f.name}`; if (seen.has(unique)) unavailable(); seen.add(unique);
    return ordered(f, ["fileIndex", "groupIndex", "name", "role", "mediaType", "expectedSizeBytes", "expectedSha256", "key"]);
  });
  if (inventory.totalBytes !== total || files.some(f => f.role !== (f.groupIndex === group ? "candidate" : "checkpoint"))) unavailable();
  const selected = files.filter(f => f.role === "candidate"), selectedNames = new Set(selected.map(f => f.name)), adapter = ["lora", "qlora"].includes(decoded.provenance.method);
  const form = adapter ? "adapter" : "full-model", format = adapter ? "adapter-safetensors" : "safetensors";
  if (decoded.candidate.artifactForm !== form || decoded.candidate.serializationFormat !== null && decoded.candidate.serializationFormat !== format ||
      !(adapter ? ["adapter_config.json", "adapter_model.safetensors", "tokenizer.json"] : ["config.json", "model.safetensors", "tokenizer.json"]).every(n => selectedNames.has(n)) ||
      (adapter ? ["config.json", "model.safetensors"] : ["adapter_config.json", "adapter_model.safetensors"]).some(n => selectedNames.has(n))) unavailable();
  const manifestDigest = "sha256:" + sha(JSON.stringify({schema: inventory.schema, publicationId: inventory.publicationId, totalBytes: total, files}));
  const candidateDigest = "sha256:" + sha(JSON.stringify({requestId: effect.taskId, workspaceId: effect.target.scope.workspaceId,
    owner: {organizationId: effect.target.scope.organizationId, principalId: effect.target.scope.principalId, clientId: effect.target.scope.registeredClientId,
      hostIncarnationId: effect.target.hostIncarnationId}, history, ...(execution ? {execution} : {}), manifestDigest}));
  if (inventory.manifestDigest !== manifestDigest || effect.candidateDigest !== candidateDigest) unavailable();
  const storage = exactTraining(r.storage, ["storageProfile", "localPath", "candidateDigest", "fileCount", "totalBytes"]), selectedBytes = selected.reduce((n, f) => n + (f.expectedSizeBytes as number), 0);
  if (storage.storageProfile !== "bounded-local-v1" || storage.candidateDigest !== candidateDigest || storage.fileCount !== selected.length ||
      storage.totalBytes !== selectedBytes || selectedBytes > 100 * 1024 ** 3 || !privateDirectory(storage.localPath)) unavailable();
  return {history, provenance: decoded.provenance, form, format, localPath: storage.localPath, sizeBytes: selectedBytes, manifestDigest, execution};
}
/** Metadata only, in the existing root-owned organization transaction. The
 * caller must enforce NEW exact Save consent, ModelRead/Write and original app
 * candidate/copy lifetime before commit and at the transaction's final fence.
 * This function performs no filesystem/runtime work and never grants consent. */
export async function commitStructuredModelTrainingSave(owner: StructuredDocumentStore, rootDirectory: string,
  raw: ModelTrainingSaveEffect, rawPreparation: ApprovedLocalTrainingSavePreparation, now: number) {
  const effect = captureModelTrainingSaveEffect(raw), owned = trainingData(rawPreparation); trainingPartition(owner, effect, true);
  if (!Number.isSafeInteger(now) || now < 1 || now > 8_640_000_000_000_000) unavailable();
  const existing = await inspectStructuredModelTrainingSave(owner, effect); if (existing.kind === "committed") return {...existing, created: false};
  const lineage = await readStructuredTrainingPlanTaskLineage(owner, effect.target.scope, effect.target.hostIncarnationId, effect.taskId); if (!lineage) unavailable();
  const prepared = trainingPreparation(owned, effect, lineage), modelRegistry = registry(owner, rootDirectory);
  const rawBase = await trainedRecord(owner, effect, prepared.provenance.modelRecordId);
  // Copy only consumed columns before any later store wait. Unrelated private
  // Model metadata is neither inspected nor persisted into the trained result.
  let base: Pick<ModelInventoryRecord, "workspaceId" | "modelRecordId" | "createdAt" | "updatedAt" | "artifactForm" | "serializationFormat" |
    "inferenceMode" | "localPath" | "modelId" | "provider"> | undefined;
  if (rawBase) {
    if (types.isProxy(rawBase) || ![Object.prototype, null].includes(Object.getPrototypeOf(rawBase))) unavailable();
    const columns: Record<string, unknown> = {};
    for (const name of ["workspaceId", "modelRecordId", "createdAt", "updatedAt", "artifactForm", "serializationFormat", "inferenceMode", "localPath", "modelId", "provider"]) {
      const d = Object.getOwnPropertyDescriptor(rawBase, name); if (!d) continue;
      if (!("value" in d) || !d.enumerable) unavailable(); columns[name] = d.value;
    }
    base = trainingData(columns) as unknown as typeof base;
  }
  if (!base || base.workspaceId !== effect.target.scope.workspaceId || (base.updatedAt ?? base.createdAt) !== prepared.provenance.modelUpdatedAt ||
      base.artifactForm !== "full-model" || base.serializationFormat !== "safetensors" || base.inferenceMode !== "causal" || !privateDirectory(base.localPath) ||
      base.modelId !== undefined && (typeof base.modelId !== "string" || !/^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(base.modelId) ||
        base.modelId.includes("..") || hasKnownPassiveCredential(base.modelId))) unavailable();
  if (await trainedRecord(owner, effect)) unavailable();
  const runtimeBase = base.modelId ?? base.localPath;
  const tags: ModelInventoryRecord["taskTags"] = prepared.provenance.trainingTask === "llm-instruction" || prepared.provenance.trainingTask === "llm-extraction"
    ? ["text-generation"] : prepared.provenance.trainingTask === "llm-classification" ? ["classification"] : prepared.provenance.trainingTask === "llm-embedding" ? ["embeddings"] : [];
  const result = await modelRegistry.registerGeneratedModel({workspaceId: effect.target.scope.workspaceId, modelRecordId: trainedModelId(effect), displayName: effect.name,
    provider: base.provider, localPath: prepared.localPath, artifactForm: prepared.form as "full-model" | "adapter", inferenceMode: base.inferenceMode,
    taskTags: tags, baseModelId: runtimeBase, ...(prepared.form === "adapter" ? {adapterOfModelId: runtimeBase} : {}),
    generatedFromRunId: effect.taskId, serializationFormat: prepared.format, sizeBytes: prepared.sizeBytes,
    metadata: {headlessTraining: {version: 1, taskId: effect.taskId, candidateDigest: effect.candidateDigest, manifestDigest: prepared.manifestDigest,
      storageProfile: "bounded-local-v1", selectedFilesVerification: "verified-at-copy", runtimeReadiness: "not-checked", outputQuality: "not-evaluated",
      trainingPlan: {fingerprint: lineage.target.fingerprint, step: lineage.step}, history: prepared.history, ...(prepared.execution ? {execution: prepared.execution} : {})}}});
  const stored = await trainedRecord(owner, effect); if (!stored || !isDeepStrictEqual(stored, JSON.parse(JSON.stringify(result.model)))) unavailable();
  await owner.writeDocument(TRAINED_SAVES, trainingKey(effect), {version: 1, effect, modelRecordDigest: recordDigest(stored), createdAt: now}, {expectedRevision: 0});
  await owner.writeDocument(TRAINED_SOURCES, trainingSourceKey(effect), {key: effect.key, modelRecordId: trainedModelId(effect)}, {expectedRevision: 0});
  return {kind: "committed", reference: trainingReference(effect), created: true} as const;
}
