import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, parse, relative, resolve } from "node:path";
import { types } from "node:util";
import {createHash} from "node:crypto";
import {readStrictPassiveRecord, hasKnownPassiveCredential} from "../../../contracts/shared";
import {isOrganizationId} from "../../../contracts/organization";

import {
  normalizeModelTrainingRequest,
  normalizeModelTrainingResult,
  type ModelTrainingRequest,
  type ModelTrainingResult,
  type ModelTrainingProgress,
} from "../../../contracts/model";
import { TaskType, type RuntimeTaskRecord } from "../../../contracts/runtime";
import { normalizeStorageArtifactKey, createRetrieveArtifactRequest, type ArtifactStorageBinding } from "../../../contracts/storage";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { GeneratedModelStoragePort, ModelPublisherPort, ModelRegistryPort } from "../../ports/model";
import type {ApprovedLocalModelTrainingPort, ApprovedLocalTrainingAdmission, ApprovedLocalTrainingControl,
  ApprovedLocalTrainingDefinition, ApprovedLocalTrainingSession, ApprovedLocalTrainingStart,
  ApprovedLocalTrainingTask, ApprovedLocalTrainingBytes, ApprovedLocalTrainingCompletionReview,
  ApprovedLocalTrainingModelReader, ApprovedLocalTrainingCandidateReview, TrainingResultVerifiedFiles} from "../../ports/model";
import type { RuntimeTaskRegistryPort } from "../../ports/runtime";
import type { ArtifactObjectStoragePort, ArtifactStorageBindingPort } from "../../ports/storage";
import type { OwnedTaskLease, OwnedTaskReconcilerService } from "../../services/runtime/owned-task-reconciler.service";
import type { RuntimeCapabilityGuardService, TaskPowerLifecyclePort } from "../../services/runtime";

type TrainingStartStage = "request-validation" | "runtime-readiness" | "base-model"
  | "dataset-resolution" | "task-dispatch" | "task-registration";

const TRAINING_SESSION_LIMIT = 1024;
const PRIVATE_TRAINING_TASKS = new Set(["llm-instruction", "llm-classification", "llm-extraction", "llm-embedding", "llm-reranker"]);
const PRIVATE_TRAINING_MEDIA: Readonly<Record<string, string>> = {"application/x-ndjson": "jsonl", "application/jsonl": "jsonl",
  "application/json": "json", "text/json": "json", "text/csv": "csv", "application/csv": "csv",
  "application/x-parquet": "parquet", "application/vnd.apache.parquet": "parquet"};
const privateUnavailable = () => new Error("The original private training task is unavailable.");
const privateDigest = (bytes: Uint8Array) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const isPrivateDigest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const isPrivateId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function privateRecord(value: unknown, keys: readonly string[]) {
  if (types.isProxy(value)) throw privateUnavailable();
  return readStrictPassiveRecord(value, keys);
}
/** Private JSON-shaped data, copied without evaluating hooks. Optional undefined
 * object members are omitted; arrays must be dense. Byte inputs use intrinsics. */
function copyPrivateTrainingData<T>(value: T): T {
  let nodes = 0, bytes = 0; const ancestors = new Set<object>();
  function visit(value: unknown, depth: number): unknown {
    if (++nodes > 8192 || depth > 24) throw privateUnavailable();
    if (value === null || typeof value === "boolean" || value === undefined) return value;
    if (typeof value === "string") {bytes += Buffer.byteLength(value); if (value.length > 65536 || bytes > 1024 * 1024) throw privateUnavailable(); return value;}
    if (typeof value === "number") {if (!Number.isFinite(value)) throw privateUnavailable(); return value;}
    if (typeof value !== "object" || types.isProxy(value) || ancestors.has(value)) throw privateUnavailable();
    const array = Array.isArray(value), proto = Object.getPrototypeOf(value), keys = Reflect.ownKeys(value);
    if (array ? proto !== Array.prototype || value.length > 1024 || keys.length !== value.length + 1 :
        proto !== Object.prototype && proto !== null || keys.length > 128) throw privateUnavailable();
    ancestors.add(value);
    const result: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key) ||
          array && (!/^(0|[1-9][0-9]*)$/.test(key) || !Number.isSafeInteger(Number(key)) || Number(key) >= (value as unknown[]).length)) throw privateUnavailable();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor) || array && descriptor.value === undefined) throw privateUnavailable();
      if (descriptor.value !== undefined) (result as Record<string, unknown>)[key] = visit(descriptor.value, depth + 1);
    }
    ancestors.delete(value); return result;
  }
  return visit(value, 0) as T;
}
function freezePrivate<T>(value: T): T {
  if (value && typeof value === "object") {for (const item of Object.values(value)) freezePrivate(item); Object.freeze(value);} return value;
}
function capturePrivateMethod<T extends (...args: any[]) => any>(owner: object, name: string): T {
  if (types.isProxy(owner)) throw privateUnavailable();
  let current: object | null = owner; const seen = new Set<object>();
  for (let depth = 0; current && depth < 8; depth++) {
    if (types.isProxy(current) || seen.has(current)) throw privateUnavailable(); seen.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, name);
    if (descriptor) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function" || types.isProxy(descriptor.value)) throw privateUnavailable();
      const method = descriptor.value;
      // bind() reads a function's name/length and can evaluate accessors.
      return ((...args: unknown[]) => Reflect.apply(method, owner, args)) as T;
    }
    current = Object.getPrototypeOf(current);
  }
  throw privateUnavailable();
}
function capturePrivateControl(raw: ApprovedLocalTrainingControl) {
  const row = privateRecord(raw, ["isCurrent", "stillAllowed"]), {isCurrent, stillAllowed} = row;
  if (Object.keys(row).length !== 2 || typeof isCurrent !== "function" || types.isProxy(isCurrent) ||
      typeof stillAllowed !== "function" || types.isProxy(stillAllowed)) throw privateUnavailable();
  const current = () => {try {
    const now = privateRecord(raw, ["isCurrent", "stillAllowed"]);
    if (now.isCurrent !== isCurrent || now.stillAllowed !== stillAllowed) return false;
    const value: unknown = Reflect.apply(isCurrent, raw, []);
    if (types.isPromise(value)) void Promise.prototype.then.call(value, undefined, () => {});
    const final = privateRecord(raw, ["isCurrent", "stillAllowed"]);
    return value === true && final.isCurrent === isCurrent && final.stillAllowed === stillAllowed;
  } catch {return false;}};
  return Object.freeze({isCurrent: current, stillAllowed: async () => {
    if (!current()) return false; try {return await Reflect.apply(stillAllowed, raw, []) === true && current();} catch {return false;}
  }});
}
function privateBytes(value: unknown, limit: number) {
  if (!types.isUint8Array(value) || types.isProxy(value)) throw privateUnavailable();
  const proto = Object.getPrototypeOf(Uint8Array.prototype), length = Object.getOwnPropertyDescriptor(proto, "byteLength")!.get!.call(value) as number;
  const buffer = Object.getOwnPropertyDescriptor(proto, "buffer")!.get!.call(value);
  if (types.isSharedArrayBuffer(buffer) || length < 1 || length > limit) throw privateUnavailable();
  const copy = new Uint8Array(length); Uint8Array.prototype.set.call(copy, value); return copy;
}
function capturePrivateAdmission(rawRequest: ModelTrainingRequest, raw: ApprovedLocalTrainingAdmission) {
  const row = privateRecord(raw, ["requestId", "organizationId", "principalId", "clientId", "hostIncarnationId", "modelUpdatedAt",
    "datasetId", "versionId", "versionDigest", "proposalDigest", "inputs", "recipe", "control", "isAdmissionCurrent", "acknowledgeIssued", "modelSource"]);
  if (Object.keys(row).length !== (Object.prototype.hasOwnProperty.call(row, "modelSource") ? 16 : 15) || !isPrivateId(row.requestId) || !isPrivateId(row.clientId) || !isPrivateId(row.hostIncarnationId) ||
      !isOrganizationId(row.organizationId) || typeof row.principalId !== "string" || !row.principalId || row.principalId.length > 160 ||
      /[\x00-\x1f\x7f]/.test(row.principalId) || hasKnownPassiveCredential(row.principalId) ||
      typeof row.modelUpdatedAt !== "string" || new Date(row.modelUpdatedAt).toISOString() !== row.modelUpdatedAt ||
      !isPrivateDigest(row.versionDigest) || !isPrivateDigest(row.proposalDigest) ||
      [row.datasetId, row.versionId].some(value => typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/.test(value) || hasKnownPassiveCredential(value)) ||
      typeof row.isAdmissionCurrent !== "function" || types.isProxy(row.isAdmissionCurrent) ||
      typeof row.acknowledgeIssued !== "function" || types.isProxy(row.acknowledgeIssued)) throw privateUnavailable();
  const source = copyPrivateTrainingData(rawRequest);
  privateRecord(source, ["workspaceId", "trainingTask", "baseModel", "datasets", "method", "commonParameters", "advancedParameters", "output", "validation"]);
  privateRecord(source.baseModel, ["modelRecordId", "provider", "modelId", "localPath", "inferenceMode"]);
  const output = privateRecord(source.output, ["outputModelName", "maxShardSize", "destination"]);
  const destination = privateRecord(output.destination, ["local"]), local = privateRecord(destination.local, ["enabled"]);
  if (local.enabled !== false) throw privateUnavailable();
  for (const input of source.datasets) privateRecord(input, ["artifactId", "splitRole", "format"]);
  const request = normalizeModelTrainingRequest(source);
  if (!isWorkspaceId(request.workspaceId) || !PRIVATE_TRAINING_TASKS.has(request.trainingTask ?? "") || !request.baseModel.modelRecordId ||
      !request.baseModel.localPath || !isAbsolute(request.baseModel.localPath) || /^[\\/]{2}/.test(request.baseModel.localPath) ||
      request.baseModel.localPath.length > 4096 || /[\x00-\x1f\x7f]/.test(request.baseModel.localPath) ||
      resolve(request.baseModel.localPath) === parse(request.baseModel.localPath).root || request.output.localOutputDirectory !== undefined ||
      request.datasets.length < 1 || request.datasets.length > 16) throw privateUnavailable();
  if (types.isProxy(row.inputs) || !Array.isArray(row.inputs) || Object.getPrototypeOf(row.inputs) !== Array.prototype ||
      Reflect.ownKeys(row.inputs).length !== row.inputs.length + 1 || row.inputs.length !== request.datasets.length) throw privateUnavailable();
  let total = 0;
  const inputs: ApprovedLocalTrainingBytes[] = [];
  for (let index = 0; index < row.inputs.length; index++) {
    const item = Object.getOwnPropertyDescriptor(row.inputs, String(index)); if (!item?.enumerable || !("value" in item)) throw privateUnavailable();
    const data = privateRecord(item.value, ["artifactId", "role", "mediaType", "digest", "content"]), expected = request.datasets[index];
    if (Object.keys(data).length !== 5 || typeof data.artifactId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(data.artifactId) ||
        data.artifactId !== expected.artifactId || !["train", "validation"].includes(data.role as string) || data.role !== expected.splitRole ||
        typeof data.mediaType !== "string" || !PRIVATE_TRAINING_MEDIA[data.mediaType] ||
        expected.format !== undefined && expected.format !== PRIVATE_TRAINING_MEDIA[data.mediaType] || !isPrivateDigest(data.digest)) throw privateUnavailable();
    const content = privateBytes(data.content, MAXIMUM_TRAINING_SOURCE_BYTES); total += content.byteLength;
    if (total > 256 * 1024 * 1024 || privateDigest(content) !== data.digest) throw privateUnavailable();
    inputs.push(Object.freeze({artifactId: data.artifactId, role: data.role as "train" | "validation", mediaType: data.mediaType, digest: data.digest, content}));
  }
  if (!inputs.some(input => input.role === "train") || new Set(inputs.map(input => input.artifactId)).size !== inputs.length) throw privateUnavailable();
  const recipeRow = privateRecord(row.recipe, ["digest", "content"]), recipe = privateBytes(recipeRow.content, 512 * 1024);
  if (Object.keys(recipeRow).length !== 2 || !isPrivateDigest(recipeRow.digest) || privateDigest(recipe) !== recipeRow.digest ||
      total + recipe.byteLength > 256 * 1024 * 1024) throw privateUnavailable();
  const control = capturePrivateControl(row.control as ApprovedLocalTrainingControl), callback = row.isAdmissionCurrent, acknowledge = row.acknowledgeIssued;
  let modelSource: ApprovedLocalTrainingModelReader | undefined, modelSourceOpen = true;
  if (Object.prototype.hasOwnProperty.call(row, "modelSource")) {
    const sourceOwner = row.modelSource;
    if (Object.keys(privateRecord(sourceOwner, ["read"])).length !== 1) throw privateUnavailable();
    const read = capturePrivateMethod<ApprovedLocalTrainingModelReader["read"]>(sourceOwner as object, "read");
    modelSource = Object.freeze({async read() {
      if (!modelSourceOpen || !control.isCurrent() || await control.stillAllowed() !== true || !control.isCurrent() || !modelSourceOpen) return;
      // Snapshot before another awaited policy callback can mutate the reply.
      const value = copyPrivateTrainingData(await read());
      if (!modelSourceOpen || !control.isCurrent() || await control.stillAllowed() !== true || !control.isCurrent() || !modelSourceOpen) return;
      return value;
    }});
  }
  const identityFields = ["requestId", "organizationId", "principalId", "clientId", "hostIncarnationId", "modelUpdatedAt",
    "datasetId", "versionId", "versionDigest", "proposalDigest", "control", "modelSource"];
  const isAdmissionCurrent = () => {try {
    const now = privateRecord(raw, Object.keys(row)); if (now.isAdmissionCurrent !== callback || now.acknowledgeIssued !== acknowledge ||
      identityFields.some(key => now[key] !== row[key])) return false;
    const value: unknown = Reflect.apply(callback, raw, []); if (types.isPromise(value)) void Promise.prototype.then.call(value, undefined, () => {});
    const final = privateRecord(raw, Object.keys(row)); return value === true && final.isAdmissionCurrent === callback && final.acknowledgeIssued === acknowledge &&
      identityFields.every(key => final[key] === row[key]);
  } catch {return false;}};
  const definition: ApprovedLocalTrainingDefinition = freezePrivate({requestId: row.requestId, workspaceId: request.workspaceId,
    owner: {organizationId: row.organizationId, principalId: row.principalId, clientId: row.clientId, hostIncarnationId: row.hostIncarnationId}, request,
    modelUpdatedAt: row.modelUpdatedAt, dataset: {datasetId: row.datasetId as string, versionId: row.versionId as string,
      versionDigest: row.versionDigest, recipeDigest: recipeRow.digest}, proposalDigest: row.proposalDigest,
    inputs: inputs.map(({content, ...input}) => ({...input, sizeBytes: content.byteLength})), recipeSizeBytes: recipe.byteLength});
  return {definition, inputs, recipe, control, modelSource, closeModelSource: () => {modelSourceOpen = false;},
    isAdmissionCurrent, acknowledgeIssued: () => Reflect.apply(acknowledge, raw, []) as Promise<boolean>};
}
type PrivateTrainingOwner = {
  readonly definition: ApprovedLocalTrainingDefinition; readonly control: ApprovedLocalTrainingControl; readonly lease: OwnedTaskLease;
  phase: "preparing" | "accepted" | "unconfirmed" | "not-started"; settled: boolean; actions: number;
  session?: ApprovedLocalTrainingSession; inputPath?: string; outputPath?: string; stageUnconfirmed?: boolean;
  candidateRead?: {pending: boolean; unknown: boolean; original?: unknown; observation?: Promise<unknown>};
};
type TrainingOutputStage = {
  readonly path: string;
  readonly device: bigint;
  readonly inode: bigint;
  cleanup?: Promise<void>;
};
type UnconfirmedTrainingStages = {
  inputPath?: string;
  inputStage?: TrainingOutputStage;
  outputPath?: string;
  outputStage?: TrainingOutputStage;
};

type StagedTrainingSource = {
  readonly storageKey: string;
  readonly path: string;
  readonly device: bigint;
  readonly inode: bigint;
  readonly size: bigint;
  readonly modified: bigint;
  readonly changed: bigint;
  readonly mode: bigint;
};

async function captureStagedTrainingSource(path: string, storageKey: string, size: number): Promise<StagedTrainingSource> {
  const facts = await lstat(path, {bigint: true}).catch(() => undefined);
  if (!facts?.isFile() || facts.isSymbolicLink() || facts.ino === 0n || facts.nlink !== 1n ||
      facts.size !== BigInt(size) || await realpath(path).catch(() => undefined) !== path)
    throw new Error("Training source file changed while staging.");
  return {storageKey, path, device: facts.dev, inode: facts.ino, size: facts.size,
    modified: facts.mtimeNs, changed: facts.ctimeNs, mode: facts.mode};
}

async function assertStagedTrainingSource(source: StagedTrainingSource): Promise<void> {
  const current = await captureStagedTrainingSource(source.path, source.storageKey, Number(source.size));
  if (current.device !== source.device || current.inode !== source.inode || current.modified !== source.modified ||
      current.changed !== source.changed || current.mode !== source.mode)
    throw new Error("Training source file changed while staging.");
}

async function assertTrainingOutputStage(stage: TrainingOutputStage, kind: "input" | "output" = "output"): Promise<void> {
  const stats = await lstat(stage.path, { bigint: true }).catch(() => undefined);
  if (!stats?.isDirectory() || stats.dev !== stage.device || stats.ino !== stage.inode
      || await realpath(stage.path).catch(() => undefined) !== stage.path) {
    throw new Error(`Training ${kind} folder could not be verified.`);
  }
}

/** One known cleanup, never deletion of a later replacement at the same path. */
async function removeOwnedTrainingStage(stage: TrainingOutputStage, kind: "input" | "output"): Promise<void> {
  if (stage.cleanup) return stage.cleanup;
  const operation = (async () => {await assertTrainingOutputStage(stage, kind); await rm(stage.path, {recursive: true});})();
  stage.cleanup = operation;
  try {await operation;} catch (error) {if (stage.cleanup === operation) stage.cleanup = undefined; throw error;}
}

/** Add only a fixed diagnostic code. Preserve the original error and all denials. */
function trainingStartFailure(error: unknown, stage: TrainingStartStage): unknown {
  try {
    if (error === null || typeof error !== "object" || types.isProxy(error)) return error;
    const prototype = Object.getPrototypeOf(error);
    if (![Error.prototype, TypeError.prototype, RangeError.prototype].includes(prototype)
        || Object.getOwnPropertyDescriptor(error, "code") || !Object.isExtensible(error)) return error;
    Object.defineProperty(error, "code", { value: `MODEL_TRAINING_START_${stage.replaceAll("-", "_").toUpperCase()}`, enumerable: false });
  } catch {
    // Diagnostics cannot replace an original failure or inspect a cause/message.
  }
  return error;
}

function ensureBaseModelSelection(request: ModelTrainingRequest): void {
  if (!request.baseModel.modelRecordId && !request.baseModel.modelId && !request.baseModel.localPath) {
    throw new Error("Model training requires a base model selection.");
  }
}

function ensureDatasetSelections(request: ModelTrainingRequest): void {
  if (request.datasets.length === 0) {
    throw new Error("Model training requires at least one dataset artifact.");
  }

  if (request.datasets.length > 16) throw new Error("Training supports at most sixteen dataset artifacts.");
  request.datasets.forEach((dataset, index) => {
    if (!dataset.artifactId || dataset.artifactId.trim().length === 0) {
      throw new Error(`Model training dataset at index ${index} is missing artifactId.`);
    }
  });
}

function ensureOutputDestinationSelection(request: ModelTrainingRequest): void {
  const localEnabled = request.output.destination.local.enabled === true;
  const huggingFaceEnabled = request.output.destination.huggingFace?.enabled === true;
  if (!localEnabled && !huggingFaceEnabled) {
    throw new Error("Model training requires at least one output destination.");
  }

  if (huggingFaceEnabled && !request.output.destination.huggingFace?.repository) {
    throw new Error("Publishing trained models to Hugging Face requires a repository.");
  }
}

const IMAGE_TRAINING_TASKS = new Set(["diffusion-lora", "vision-classification", "vision-detection", "vision-segmentation"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isImageTrainingTask(trainingTask: string | undefined): boolean {
  return typeof trainingTask === "string" && IMAGE_TRAINING_TASKS.has(trainingTask.trim().toLowerCase());
}

function extensionForMediaType(mediaType: string | undefined, fallback = ".parquet"): string {
  if (mediaType === "image/png") {
    return ".png";
  }

  if (mediaType === "image/jpeg" || mediaType === "image/jpg") {
    return ".jpg";
  }

  if (mediaType === "image/webp") {
    return ".webp";
  }

  if (mediaType === "image/gif") {
    return ".gif";
  }

  if (mediaType === "image/bmp") {
    return ".bmp";
  }

  if (mediaType === "image/tiff") {
    return ".tiff";
  }

  if (mediaType === "application/x-parquet" || mediaType === "application/vnd.apache.parquet") {
    return ".parquet";
  }

  if (mediaType === "application/x-ndjson" || mediaType === "application/jsonl") {
    return ".jsonl";
  }

  if (mediaType === "application/json" || mediaType === "text/json") {
    return ".json";
  }

  if (mediaType === "text/csv" || mediaType === "application/csv") {
    return ".csv";
  }

  return fallback;
}

function sanitizeRuntimeDatasetFileSegment(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized.slice(0, 100) : "dataset";
}

function buildRuntimeDatasetPath(
  runtimeDatasetDir: string,
  artifactId: string,
  mediaType: string | undefined,
  datasetIndex: number,
): string {
  const sourceName = basename(artifactId);
  const stem = sanitizeRuntimeDatasetFileSegment(parse(sourceName).name || sourceName);
  const extension = extensionForMediaType(mediaType);
  const prefix = `${String(datasetIndex + 1).padStart(4, "0")}-${stem}`;
  return join(runtimeDatasetDir, `${prefix}${extension}`);
}

function buildRuntimeSourceArtifactPath(
  runtimeDatasetDir: string,
  artifactId: string,
  mediaType: string | undefined,
  sourceIndex: number,
): string {
  const sourceName = basename(artifactId);
  const stem = sanitizeRuntimeDatasetFileSegment(parse(sourceName).name || sourceName);
  const extension = extensionForMediaType(mediaType, ".bin");
  const prefix = `${String(sourceIndex + 1).padStart(4, "0")}-${stem}`;
  return join(runtimeDatasetDir, "sources", `${prefix}${extension}`);
}

const MAXIMUM_TRAINING_SOURCE_BYTES = 64 * 1024 * 1024;
function resolveLocalStorageKeyForArtifact(artifactId: string, bindings: ArtifactStorageBinding[], workspaceId: string): string {
  const eligible = bindings.filter((binding) => binding.workspaceId === workspaceId && binding.artifactId === artifactId && binding.backing.kind === "artifact-object" && ["local", "local-filesystem", "filesystem"].includes(binding.backing.provider));
  const preferred = eligible.find((binding) => binding.role === "primary") ?? eligible[0];
  if (!preferred) throw new Error("A workspace-owned local training artifact binding is required.");
  return normalizeStorageArtifactKey(preferred.backing.locator);
}
function trainingSourceBytes(content: unknown): Uint8Array {
  if (!(content instanceof Uint8Array) || content.byteLength < 1 || content.byteLength > MAXIMUM_TRAINING_SOURCE_BYTES) throw new Error("Training artifact content is unavailable or exceeds its byte limit.");
  return content;
}

function extractSourceArtifactIds(metadata: Record<string, unknown> | undefined): string[] {
  const sourceArtifactIds = metadata?.["sourceArtifactIds"];
  if (!Array.isArray(sourceArtifactIds)) {
    return [];
  }

  return Array.from(new Set(sourceArtifactIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)));
}

export class TrainModelUseCase {
  private readonly privateTrainingOwners = new Map<string, PrivateTrainingOwner>();
  private readonly reads = new Map<string, Promise<ModelTrainingResult>>();
  private readonly registeredResultsByRequestId = new Map<string, ModelTrainingResult>();
  private readonly pendingResultsByRequestId = new Map<string, ModelTrainingResult>();
  private readonly approvedRequestIds = new Set<string>();
  private readonly reviewActionRequestIds = new Set<string>();
  private readonly workspaceIdByRequestId = new Map<string, string>();
  private readonly requestContextByRequestId = new Map<string, { normalizedRequest: ModelTrainingRequest; baseModelRecordId?: string }>();
  private readonly runtimeDatasetStagesByRequestId = new Map<string, TrainingOutputStage>();
  private readonly runtimeOutputStages = new Map<string, TrainingOutputStage>();
  private startingRuns = 0;
  private readonly unconfirmedStarts = new Set<UnconfirmedTrainingStages>();
  private readonly stoppedTaskIds = new Set<string>();
  private readonly storedOutputs = new Map<string, Awaited<ReturnType<TrainModelUseCase["storeGeneratedModelLocally"]>>>();
  private readonly publishedOutputs = new Map<string, Awaited<ReturnType<TrainModelUseCase["publishGeneratedModel"]>>>();
  private readonly registrations = new Map<string, Awaited<ReturnType<ModelRegistryPort["registerGeneratedModel"]>>>();
  private readonly pendingOutputCleanup = new Map<string, { storedPath?: string }>();
  private async cleanPendingOutput(requestId: string): Promise<void> {
    const pending = this.pendingOutputCleanup.get(requestId);
    if (!pending) return;
    await this.cleanupRuntimeOutputDirectory(requestId, pending.storedPath);
    this.pendingOutputCleanup.delete(requestId);
  }

  private retainUnconfirmedStages(stages: UnconfirmedTrainingStages, lease?: OwnedTaskLease): void {
    this.unconfirmedStarts.add(stages);
    // No guessed task ID, polling, cancellation or repeat start. Only the host's
    // existing proof that its Python runtime stopped can retire these readers.
    lease?.start(async () => false, async () => undefined, async () => {
      if (stages.inputPath) {
        if (!stages.inputStage || stages.inputStage.path !== stages.inputPath) throw new Error("Training input cleanup is unconfirmed.");
        await removeOwnedTrainingStage(stages.inputStage, "input"); stages.inputPath = undefined;
      }
      if (stages.outputPath) {
        if (!stages.outputStage || stages.outputStage.path !== stages.outputPath) throw new Error("Training output cleanup is unconfirmed.");
        await removeOwnedTrainingStage(stages.outputStage, "output"); stages.outputPath = undefined;
      }
      this.unconfirmedStarts.delete(stages);
    });
  }

  public constructor(
    private readonly dependencies: {
      runtimeTaskRegistry: RuntimeTaskRegistryPort;
      taskReconciler?: OwnedTaskReconcilerService;
      modelRegistry: ModelRegistryPort;
      storageBindings: Pick<ArtifactStorageBindingPort, "readArtifactStorageBindings">;
      storage: Pick<ArtifactObjectStoragePort, "retrieveArtifact">;
      generatedModelStorage?: GeneratedModelStoragePort;
      modelPublisher?: ModelPublisherPort;
      taskPowerLifecycle: TaskPowerLifecyclePort;
      runtimeCapabilityGuard?: Pick<RuntimeCapabilityGuardService, "requireCapabilityReady">;
      approvedLocalTraining?: ApprovedLocalModelTrainingPort;
    },
  ) {}

  public async execute(request: ModelTrainingRequest): Promise<ModelTrainingResult> {
    return this.dependencies.taskReconciler ? this.dependencies.taskReconciler.withLease("python", (lease) => this.executeOwned(request, lease)) : this.executeOwned(request);
  }

  /** Trusted original-plan entry only. No configured port means no staging,
   * readiness/install calls or ordinary fallback. Returned objects stay private. */
  public async startApprovedLocal(rawRequest: ModelTrainingRequest, rawAdmission: ApprovedLocalTrainingAdmission): Promise<ApprovedLocalTrainingStart> {
    let captured: ReturnType<typeof capturePrivateAdmission>, create: ApprovedLocalModelTrainingPort["createSession"];
    const reconciler = this.dependencies.taskReconciler, port = this.dependencies.approvedLocalTraining;
    if (!reconciler || !port) return {kind: "unavailable"};
    try {create = capturePrivateMethod(port, "createSession"); captured = capturePrivateAdmission(rawRequest, rawAdmission);}
    catch {return {kind: "unavailable"};}
    const {definition, inputs, recipe, control, modelSource, closeModelSource, isAdmissionCurrent, acknowledgeIssued} = captured, id = definition.requestId;
    if (this.privateTrainingOwners.has(id) || this.workspaceIdByRequestId.has(id) || this.trainingSessionCount() >= TRAINING_SESSION_LIMIT)
      return {kind: "unavailable"};
    let lease: OwnedTaskLease; try {lease = reconciler.reserve();} catch {return {kind: "unavailable"};}
    const owner: PrivateTrainingOwner = {definition, control, lease, phase: "preparing", settled: false, actions: 0};
    this.privateTrainingOwners.set(id, owner);
    let observing = false;
    const retained = () => {
      if (observing) return; observing = true;
      lease.start(async () => {
        if (owner.phase !== "accepted") return false;
        if (!owner.control.isCurrent() || await owner.control.stillAllowed() !== true || !owner.control.isCurrent()) await owner.session?.cancel();
        await this.readTrainingInWorkspace(id, definition.workspaceId);
        return owner.settled;
      }, async () => {
        if (owner.phase === "accepted") await owner.session?.cancel();
      }, async () => {
        // A generic Python stop cannot close a different original native/IO owner.
        if (this.reads.has(id) || owner.actions || owner.candidateRead?.pending || owner.candidateRead?.unknown || this.reviewActionRequestIds.has(id)) throw privateUnavailable();
        await this.settlePrivateTraining(owner);
        if (this.reads.has(id) || owner.actions) throw privateUnavailable();
        if (owner.stageUnconfirmed) throw privateUnavailable();
        await this.cleanupRuntimeDatasetDir(id);
        if (owner.phase === "accepted") this.stoppedTaskIds.add(id);
        if (!this.pendingResultsByRequestId.has(id)) {
          await this.cleanupRuntimeOutputDirectory(id);
          if (owner.phase === "accepted" && !this.registeredResultsByRequestId.has(id)) {
            this.registeredResultsByRequestId.set(id, normalizeModelTrainingResult({runId: id, status: "failed",
              error: {code: "host_stopped", message: "The host stopped before training completed."}}));
            await this.completePowerLifecycle(id, "failed");
          }
        }
      });
    };
    const uncertain = (): ApprovedLocalTrainingStart => {owner.phase = "unconfirmed"; try {retained();} catch {} return {kind: "unconfirmed"};};
    const current = () => this.privateTrainingOwners.get(id) === owner && control.isCurrent();
    const startCurrent = () => {try {
      reconciler.assertAccepting();
      return owner.phase === "preparing" && current() && isAdmissionCurrent() && current();
    } catch {return false;}};
    const admit = async () => {try {
      return startCurrent() && await control.stillAllowed() === true && startCurrent();
    } catch {return false;}};
    const unavailable = async (): Promise<ApprovedLocalTrainingStart> => {
      try {
        if (owner.session) await this.settlePrivateTraining(owner); else owner.settled = true;
        if (owner.stageUnconfirmed) return uncertain();
        await this.cleanupRuntimeDatasetDir(id); await this.cleanupRuntimeOutputDirectory(id);
        owner.phase = "not-started"; lease.release(); return {kind: "unavailable"};
      } catch {return uncertain();}
    };
    try {
      if (!await admit() || !startCurrent()) {this.privateTrainingOwners.delete(id); lease.release(); return {kind: "unavailable"};}
      const session = create(definition, Object.freeze({isCurrent: current, stillAllowed: async () => current() && await control.stillAllowed() === true && current()}), modelSource);
      if (session === undefined) {this.privateTrainingOwners.delete(id); lease.release(); return {kind: "unavailable"};}
      if (types.isPromise(session)) {void Promise.prototype.then.call(session, undefined, () => {}); return uncertain();}
      // Capture the retirement owner before prepare/start can have an unknown reply.
      if (!session || types.isProxy(session)) return uncertain();
      const requestId = Object.getOwnPropertyDescriptor(session, "requestId"), workspaceId = Object.getOwnPropertyDescriptor(session, "workspaceId");
      if (!requestId || !("value" in requestId) || requestId.value !== id || !workspaceId || !("value" in workspaceId) || workspaceId.value !== definition.workspaceId) return uncertain();
      owner.session = Object.freeze({requestId: id, workspaceId: definition.workspaceId,
        prepare: capturePrivateMethod(session, "prepare"), start: capturePrivateMethod(session, "start"),
        read: capturePrivateMethod(session, "read"), cancel: capturePrivateMethod(session, "cancel"), settle: capturePrivateMethod(session, "settle")});
      let verifyRetainedFiles: ApprovedLocalTrainingSession["verifyRetainedFiles"];
      for (let at: object | null = session, depth = 0; at && at !== Object.prototype && depth < 8; at = Object.getPrototypeOf(at), depth++) {
        if (types.isProxy(at)) return uncertain();
        if (Object.getOwnPropertyDescriptor(at, "verifyRetainedFiles")) {
          verifyRetainedFiles = capturePrivateMethod<NonNullable<ApprovedLocalTrainingSession["verifyRetainedFiles"]>>(session, "verifyRetainedFiles"); break;
        }
      }
      if (verifyRetainedFiles) owner.session = Object.freeze({...owner.session, verifyRetainedFiles});
      let ready: Awaited<ReturnType<ApprovedLocalTrainingSession["prepare"]>>;
      try {ready = await owner.session.prepare();} finally {closeModelSource();}
      if (ready === "unavailable") return await unavailable();
      if (ready !== "ready") return uncertain();
      if (!await admit() || !startCurrent()) return await unavailable();
      // Private copies never consult Model discovery or mutable Artifact bindings.
      owner.inputPath = await mkdtemp(join(await realpath(tmpdir()), "ai-system-builder-training-datasets-"));
      owner.stageUnconfirmed = true;
      const inputIdentity = await lstat(owner.inputPath, {bigint: true});
      if (!inputIdentity.isDirectory() || inputIdentity.isSymbolicLink() || inputIdentity.ino === 0n || await realpath(owner.inputPath) !== owner.inputPath) return uncertain();
      this.runtimeDatasetStagesByRequestId.set(id, {path: owner.inputPath, device: inputIdentity.dev, inode: inputIdentity.ino});
      owner.stageUnconfirmed = false;
      if (!await admit() || !startCurrent()) return await unavailable();
      const datasets = [];
      for (let index = 0; index < inputs.length; index++) {
        const source = inputs[index], path = buildRuntimeDatasetPath(owner.inputPath, source.artifactId, source.mediaType, index);
        await writeFile(path, source.content, {flag: "wx", mode: 0o600});
        if (!await admit() || !startCurrent()) return await unavailable();
        datasets.push({...definition.request.datasets[index], format: PRIVATE_TRAINING_MEDIA[source.mediaType], path});
      }
      const recipePath = join(owner.inputPath, "approved-recipe.json"); await writeFile(recipePath, recipe, {flag: "wx", mode: 0o600});
      if (!await admit() || !startCurrent()) return await unavailable();
      owner.outputPath = await mkdtemp(join(await realpath(tmpdir()), "ai-system-builder-training-output-")); owner.stageUnconfirmed = true;
      const outputIdentity = await lstat(owner.outputPath, {bigint: true});
      if (!outputIdentity.isDirectory() || outputIdentity.isSymbolicLink() || outputIdentity.ino === 0n || await realpath(owner.outputPath) !== owner.outputPath) return uncertain();
      this.runtimeOutputStages.set(id, {path: owner.outputPath, device: outputIdentity.dev, inode: outputIdentity.ino}); owner.stageUnconfirmed = false;
      if (!await admit() || !startCurrent()) return await unavailable();
      // Invoke at most once. A thrown acknowledgement is not a known non-start.
      if (await acknowledgeIssued() !== true) return await unavailable();
      if (!await admit() || !startCurrent()) return await unavailable();
      const payload = freezePrivate({...definition.request, datasets, output: {...definition.request.output, outputDirectory: owner.outputPath}});
      const response = copyPrivateTrainingData(await owner.session.start(Object.freeze({payload,
        recipe: Object.freeze({path: recipePath, digest: definition.dataset.recipeDigest, sizeBytes: recipe.byteLength}), outputDirectory: owner.outputPath}), startCurrent));
      const ack = privateRecord(response, ["kind", "requestId", "workspaceId", "status"]);
      if (ack.kind === "unavailable" && Object.keys(ack).length === 1) return await unavailable();
      if (ack.kind !== "accepted" || Object.keys(ack).length !== 4 || ack.requestId !== id || ack.workspaceId !== definition.workspaceId ||
          !["queued", "running"].includes(ack.status as string)) return uncertain();
      // Preserve the original ACK even if the outward caller ended meanwhile.
      owner.phase = "accepted";
      this.workspaceIdByRequestId.set(id, definition.workspaceId);
      this.requestContextByRequestId.set(id, {normalizedRequest: definition.request, baseModelRecordId: definition.request.baseModel.modelRecordId});
      retained();
      try {await this.dependencies.taskPowerLifecycle.startTask(id, TaskType.MODEL_TRAINING);} catch {}
      const task: ApprovedLocalTrainingTask = Object.freeze({requestId: id, workspaceId: definition.workspaceId,
        read: (action: ApprovedLocalTrainingControl) => this.usePrivateTraining(owner, action, () => this.readTrainingInWorkspace(id, definition.workspaceId)),
        reviewCompletion: (action: ApprovedLocalTrainingControl) => this.usePrivateTraining(owner, action,
          async () => this.reviewPrivateTrainingCompletion(owner)),
        ...(verifyRetainedFiles ? {reviewCandidate: (action: ApprovedLocalTrainingControl) => this.usePrivateTraining(owner, action,
          control => this.reviewPrivateTrainingCandidate(owner, control))} : {}),
        cancel: (action: ApprovedLocalTrainingControl) => this.usePrivateTraining(owner, action, async () => {
          if (!owner.settled) {
            const raw = copyPrivateTrainingData(await owner.session!.cancel()), cancel = privateRecord(raw, ["requestId", "cancelled", "status", "message"]);
            if (cancel.requestId !== id || typeof cancel.cancelled !== "boolean" ||
                !["queued", "running", "succeeded", "failed", "cancelled", "unknown"].includes(cancel.status as string)) throw privateUnavailable();
          }
          // Cancellation ACK is not physical settlement or deletion authority.
          return this.readTrainingInWorkspace(id, definition.workspaceId);
        })});
      return {kind: "accepted", value: {runId: id, status: ack.status as "queued" | "running"}, task};
    } catch {return uncertain();}
    finally {closeModelSource();}
  }

  private trainingSessionCount(): number {
    return new Set([...this.workspaceIdByRequestId.keys(), ...this.privateTrainingOwners.keys()]).size + this.startingRuns + this.unconfirmedStarts.size;
  }
  private async settlePrivateTraining(owner: PrivateTrainingOwner): Promise<void> {
    if (owner.settled) return;
    if (!owner.session || await owner.session.settle() !== true) throw privateUnavailable();
    owner.settled = true;
  }
  private async usePrivateTraining<T>(owner: PrivateTrainingOwner, raw: ApprovedLocalTrainingControl, action: (control: ApprovedLocalTrainingControl) => Promise<T>): Promise<T> {
    const control = capturePrivateControl(raw), current = () => this.privateTrainingOwners.get(owner.definition.requestId) === owner && owner.phase === "accepted" && owner.control.isCurrent() && control.isCurrent();
    const allowed = async () => {try {
      if (!current() || await control.stillAllowed() !== true || !current()) return false;
      return await owner.control.stillAllowed() === true && current();
    } catch {return false;}};
    if (!await allowed() || !current()) throw privateUnavailable();
    owner.actions++;
    try {const result = await action(Object.freeze({isCurrent: current, stillAllowed: allowed}));
      if (!await allowed() || !current()) throw privateUnavailable(); return copyPrivateTrainingData(result);}
    finally {owner.actions--;}
  }

  /** Separate current read. Historical completion remains cache-only. */
  private async reviewPrivateTrainingCandidate(owner: PrivateTrainingOwner, control: ApprovedLocalTrainingControl): Promise<ApprovedLocalTrainingCandidateReview> {
    const history = this.reviewPrivateTrainingCompletion(owner), verify = owner.session?.verifyRetainedFiles;
    if (history.kind !== "ready" || !verify) return {kind: "not-ready"};
    const adapter = ["lora", "qlora"].includes(owner.definition.request.method);
    if (history.candidate.artifactForm !== (adapter ? "adapter" : "full-model") ||
        history.candidate.serializationFormat !== null && history.candidate.serializationFormat !== (adapter ? "adapter-safetensors" : "safetensors"))
      throw privateUnavailable();
    if (owner.candidateRead) throw privateUnavailable();
    const read: NonNullable<PrivateTrainingOwner["candidateRead"]> = {pending: true, unknown: false}; owner.candidateRead = read;
    let operation: Promise<TrainingResultVerifiedFiles>;
    try {
      operation = verify(control); read.original = operation;
      if (!types.isPromise(operation) || types.isProxy(operation) || Object.getPrototypeOf(operation) !== Promise.prototype ||
          Object.getOwnPropertyDescriptor(operation, "constructor")) throw privateUnavailable();
    } catch {read.unknown = true; throw privateUnavailable();}
    const observation = (async () => {try {return {ok: true, value: await operation};}
      catch {return {ok: false, value: undefined};} finally {read.pending = false;}})();
    read.observation = observation;
    if (Object.getOwnPropertyDescriptor(operation, "then")) {read.unknown = true; throw privateUnavailable();}
    let rawResult: unknown;
    try {const result = await observation; if (!result.ok) throw privateUnavailable(); rawResult = result.value;}
    finally {if (!read.pending && !read.unknown && owner.candidateRead === read) owner.candidateRead = undefined;}
    const data = copyPrivateTrainingData(rawResult); // Detach before any later policy wait.
    const raw = privateRecord(data, ["schema", "publicationId", "totalBytes", "files", "verification", "manifestDigest"]);
    if (Object.keys(raw).length !== 6 || raw.schema !== "training-result-finalized-files-v1" || raw.verification !== "sha256-current-local-v1" ||
        typeof raw.publicationId !== "string" || !/^[a-f0-9]{32}$/.test(raw.publicationId) || !Array.isArray(raw.files) ||
        raw.files.length < 1 || raw.files.length > 256) throw privateUnavailable();
    const publicationId = raw.publicationId, names = new Set(["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json",
      "special_tokens_map.json", "added_tokens.json", "vocab.json", "merges.txt", "model.safetensors",
      "adapter_config.json", "adapter_model.safetensors", "serialization_manifest.json", "training-run.json"]);
    let total = 0, group = 0; const seen = new Set<string>();
    const files = raw.files.map((value, index) => {
      const row = privateRecord(value, ["fileIndex", "groupIndex", "name", "role", "mediaType", "expectedSizeBytes", "expectedSha256", "key"]);
      if (Object.keys(row).length !== 8 || row.fileIndex !== index || typeof row.groupIndex !== "number" || !Number.isSafeInteger(row.groupIndex) ||
          row.groupIndex < 0 || row.groupIndex > 255 || row.groupIndex !== group && !(index > 0 && row.groupIndex === group + 1) ||
          typeof row.name !== "string" || !names.has(row.name) || !["checkpoint", "candidate"].includes(row.role as string) ||
          row.mediaType !== (row.name.endsWith(".json") ? "application/json" : "application/octet-stream") ||
          typeof row.expectedSizeBytes !== "number" || !Number.isSafeInteger(row.expectedSizeBytes) || row.expectedSizeBytes < 1 ||
          row.expectedSizeBytes > Number.MAX_SAFE_INTEGER - total || typeof row.expectedSha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(row.expectedSha256) ||
          row.key !== `workspaces/${owner.definition.workspaceId}/artifacts/training-results/${publicationId}/${index}`) throw privateUnavailable();
      group = row.groupIndex; total += row.expectedSizeBytes;
      const unique = `${group}/${row.name}`; if (seen.has(unique)) throw privateUnavailable(); seen.add(unique);
      return Object.freeze({fileIndex: index, groupIndex: group, name: row.name, role: row.role as "checkpoint" | "candidate",
        mediaType: row.mediaType as "application/json" | "application/octet-stream", expectedSizeBytes: row.expectedSizeBytes,
        expectedSha256: row.expectedSha256, key: row.key as string});
    });
    if (raw.totalBytes !== total || files.some(file => file.role !== (file.groupIndex === group ? "candidate" : "checkpoint"))) throw privateUnavailable();
    const candidate = new Set(files.filter(file => file.groupIndex === group).map(file => file.name));
    const required = adapter ? ["adapter_config.json", "adapter_model.safetensors", "tokenizer.json"] : ["config.json", "model.safetensors", "tokenizer.json"];
    const forbidden = adapter ? ["config.json", "model.safetensors"] : ["adapter_config.json", "adapter_model.safetensors"];
    if (!required.every(name => candidate.has(name)) || forbidden.some(name => candidate.has(name))) throw privateUnavailable();
    const snapshot = Object.freeze({schema: "training-result-finalized-files-v1" as const, publicationId, totalBytes: total, files: Object.freeze(files)});
    const manifestDigest = "sha256:" + createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    if (raw.manifestDigest !== manifestDigest) throw privateUnavailable();
    const retainedFiles: TrainingResultVerifiedFiles = Object.freeze({...snapshot, verification: "sha256-current-local-v1", manifestDigest});
    const candidateDigest = "sha256:" + createHash("sha256").update(JSON.stringify({requestId: owner.definition.requestId,
      workspaceId: owner.definition.workspaceId, owner: owner.definition.owner, history, manifestDigest})).digest("hex");
    return {kind: "ready", requestId: owner.definition.requestId, workspaceId: owner.definition.workspaceId, history, retainedFiles, candidateDigest};
  }

  /** Cache and original definition only. In particular, do not call readOwned:
   * that path may still settle a runtime or reconcile temporary files. */
  private reviewPrivateTrainingCompletion(owner: PrivateTrainingOwner): ApprovedLocalTrainingCompletionReview {
    const definition = owner.definition, pending = this.pendingResultsByRequestId.get(definition.requestId);
    if (!owner.settled || !pending || pending.status !== "succeeded" || !pending.generatedModelCandidate) return {kind: "not-ready"};
    if (pending.runId !== definition.requestId || typeof definition.request.baseModel.modelRecordId !== "string") throw privateUnavailable();
    const source = pending.generatedModelCandidate;
    const artifactForm = source.artifactForm ?? null, serializationFormat = source.serializationFormat ?? null, recordedSizeBytes = source.sizeBytes ?? null;
    if ((artifactForm !== null && !["adapter", "merged-model", "full-model", "checkpoint"].includes(artifactForm)) ||
        (serializationFormat !== null && !["safetensors", "sharded-safetensors", "adapter-safetensors"].includes(serializationFormat)) ||
        (recordedSizeBytes !== null && (!Number.isSafeInteger(recordedSizeBytes) || recordedSizeBytes < 0))) throw privateUnavailable();
    let comparison: Extract<ApprovedLocalTrainingCompletionReview, {kind: "ready"}>["comparison"] = {state: "not-recorded"};
    const rawReport = source.metadata?.validationComparison;
    if (rawReport !== undefined) {
      const report = privateRecord(copyPrivateTrainingData(rawReport), ["protocol", "maximumRows", "sampleCount", "baselineLoss", "trainedLoss", "lossDelta", "interpretation"]);
      const loss = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
      const {baselineLoss, trainedLoss, sampleCount, lossDelta} = report;
      if (Object.keys(report).length !== 7 || report.protocol !== "fixed-first-32-validation-loss-v1" || report.maximumRows !== 32 ||
          report.interpretation !== "measurement-only" || !loss(baselineLoss) || !loss(trainedLoss) ||
          typeof sampleCount !== "number" || !Number.isSafeInteger(sampleCount) || sampleCount < 1 || sampleCount > 32 ||
          typeof lossDelta !== "number" || !Number.isFinite(lossDelta) || lossDelta !== trainedLoss - baselineLoss ||
          pending.metrics?.baseline_validation_loss !== baselineLoss || pending.metrics?.trained_validation_loss !== trainedLoss ||
          pending.metrics?.validation_sample_count !== sampleCount || pending.metrics?.validation_loss_delta !== lossDelta) throw privateUnavailable();
      comparison = {state: "recorded", report: {protocol: "fixed-first-32-validation-loss-v1", maximumRows: 32,
        sampleCount, baselineLoss, trainedLoss, lossDelta, interpretation: "measurement-only"}};
    }
    return {kind: "ready", requestId: definition.requestId, workspaceId: definition.workspaceId,
      provenance: {modelRecordId: definition.request.baseModel.modelRecordId, modelUpdatedAt: definition.modelUpdatedAt,
        datasetId: definition.dataset.datasetId, versionId: definition.dataset.versionId, versionDigest: definition.dataset.versionDigest,
        recipeDigest: definition.dataset.recipeDigest, proposalDigest: definition.proposalDigest, trainingTask: definition.request.trainingTask,
        method: definition.request.method, trainingInputCount: definition.inputs.filter(row => row.role === "train").length,
        validationInputCount: definition.inputs.filter(row => row.role === "validation").length,
        inputBytes: definition.inputs.reduce((sum, row) => sum + row.sizeBytes, 0), recipeBytes: definition.recipeSizeBytes},
      candidate: {requestedName: definition.request.output.outputModelName, artifactForm,
        serializationFormat: serializationFormat as "safetensors" | "sharded-safetensors" | "adapter-safetensors" | null, recordedSizeBytes},
      comparison, verification: {inputs: "recorded-not-rechecked", retainedFiles: "not-checked", runtimeReadiness: "not-checked",
        hardware: "not-recorded", outputQuality: "not-evaluated"}, registration: "requires-separate-approval"};
  }

  private async executeOwned(request: ModelTrainingRequest, lease?: OwnedTaskLease): Promise<ModelTrainingResult> {
    let stage: TrainingStartStage = "request-validation";
    if (this.trainingSessionCount() >= TRAINING_SESSION_LIMIT) {
      lease?.release();
      throw trainingStartFailure(new Error("Training session task capacity is unavailable."), stage);
    }
    this.startingRuns += 1;
    try {
      return await this.executeAtStartStage(request, lease, (next) => { stage = next; });
    } catch (error) {
      throw trainingStartFailure(error, stage);
    } finally {
      this.startingRuns -= 1;
    }
  }

  private async executeAtStartStage(request: ModelTrainingRequest, lease: OwnedTaskLease | undefined, enterStage: (stage: TrainingStartStage) => void): Promise<ModelTrainingResult> {
    this.dependencies.taskReconciler?.assertAccepting();
    const normalizedRequest = normalizeModelTrainingRequest(request);
    if (!isWorkspaceId(normalizedRequest.workspaceId)) {
      throw new Error("workspaceId must be provided for workspace-scoped model training.");
    }
    ensureBaseModelSelection(normalizedRequest);
    ensureDatasetSelections(normalizedRequest);
    ensureOutputDestinationSelection(normalizedRequest);
    enterStage("runtime-readiness");
    await this.dependencies.runtimeCapabilityGuard?.requireCapabilityReady("model-training");

    enterStage("base-model");
    let baseModelRecordId: string | undefined = normalizedRequest.baseModel.modelRecordId;

    if (normalizedRequest.baseModel.modelRecordId) {
      if (!isWorkspaceId(normalizedRequest.workspaceId)) {
        throw new Error("workspaceId must be provided to resolve workspace-scoped base model records.");
      }
      const baseModelRecord = await this.dependencies.modelRegistry.getModelRecord(normalizedRequest.workspaceId, normalizedRequest.baseModel.modelRecordId);
      if (!baseModelRecord) {
        throw new Error(`Base model record '${normalizedRequest.baseModel.modelRecordId}' was not found.`);
      }

      baseModelRecordId = baseModelRecord.modelRecordId;
      normalizedRequest.baseModel = {
        ...normalizedRequest.baseModel,
        modelRecordId: baseModelRecord.modelRecordId,
        provider: normalizedRequest.baseModel.provider ?? baseModelRecord.provider,
        modelId: normalizedRequest.baseModel.modelId ?? baseModelRecord.modelId,
        localPath: normalizedRequest.baseModel.localPath ?? baseModelRecord.localPath,
        inferenceMode: normalizedRequest.baseModel.inferenceMode ?? baseModelRecord.inferenceMode,
      };
    }

    let runtimeDatasetDir: string | undefined;
    let runtimeDatasetStage: TrainingOutputStage | undefined;
    let outputPath: string | undefined;
    let outputStage: TrainingOutputStage | undefined;
    let outputAdmissionUnconfirmed = false;
    let stagedBytes = 0;
    // Per invocation only. A shared source has one owned copy/path, never a
    // process-wide cache, guessed binding, overwrite or file adoption.
    const stagedSources = new Map<string, StagedTrainingSource>();
    const accountBytes = (bytes: number) => { stagedBytes += bytes; if (stagedBytes > 256 * 1024 * 1024) throw new Error("Training inputs exceed the aggregate byte budget."); };
    try {
      enterStage("dataset-resolution");
      const resolvedDatasets = [];
      for (const [datasetIndex, dataset] of normalizedRequest.datasets.entries()) {
        const resolved = await this.resolveDatasetForRuntime(normalizedRequest, dataset, datasetIndex, () => runtimeDatasetDir, async value => {
          runtimeDatasetDir = value;
          const stats = await lstat(value, {bigint: true});
          if (!stats.isDirectory() || stats.isSymbolicLink() || stats.ino === 0n || await realpath(value) !== value)
            throw new Error("Training input folder could not be verified.");
          runtimeDatasetStage = {path: value, device: stats.dev, inode: stats.ino};
        }, accountBytes, stagedSources);
        resolvedDatasets.push(resolved);
      }

      enterStage("task-dispatch");
      this.dependencies.taskReconciler?.assertAccepting();
      outputPath = await mkdtemp(join(await realpath(tmpdir()), "ai-system-builder-training-output-"));
      outputAdmissionUnconfirmed = true;
      const stats = await lstat(outputPath, { bigint: true });
      if (!stats.isDirectory() || stats.ino === 0n || await realpath(outputPath) !== outputPath) {
        throw new Error("Training output folder could not be verified.");
      }
      outputStage = { path: outputPath, device: stats.dev, inode: stats.ino };
      this.dependencies.taskReconciler?.assertAccepting();
      const started = await this.dependencies.runtimeTaskRegistry.startTask({
        workspaceId: normalizedRequest.workspaceId,
        taskType: TaskType.MODEL_TRAINING,
        payload: {
          ...normalizedRequest,
          datasets: resolvedDatasets,
          output: { ...normalizedRequest.output, outputDirectory: outputStage.path },
          runMetadata: {
            ...normalizedRequest.runtimeMetadata,
            trainingTask: normalizedRequest.trainingTask,
          },
        },
      });

      enterStage("task-registration");
      if (typeof started.requestId !== "string" || started.requestId.trim().length === 0) {
        throw new Error("Model training start response missing requestId.");
      }
      if (this.workspaceIdByRequestId.has(started.requestId)) {
        throw new Error("Model training start response repeated an existing task.");
      }

      this.requestContextByRequestId.set(started.requestId, { normalizedRequest, baseModelRecordId });
      this.workspaceIdByRequestId.set(started.requestId, normalizedRequest.workspaceId);
      this.runtimeOutputStages.set(started.requestId, outputStage);
      if (runtimeDatasetStage) {
        this.runtimeDatasetStagesByRequestId.set(started.requestId, runtimeDatasetStage);
      }
      try {
        await this.dependencies.taskPowerLifecycle.startTask(started.requestId, TaskType.MODEL_TRAINING);
      } catch {
        // Power blocker startup failures must not fail model training.
      }

      lease?.start(async () => {
        const result = await this.read(started.requestId, normalizedRequest.workspaceId!);
        return result.status !== "queued" && result.status !== "running";
      }, () => this.dependencies.runtimeTaskRegistry.cancelTask(started.requestId), async () => {
        this.stoppedTaskIds.add(started.requestId);
        const assertNoResultHandoff = () => {
          if (this.reads.has(started.requestId) || this.reviewActionRequestIds.has(started.requestId))
            throw new Error("Training result review is still finishing.");
        };
        assertNoResultHandoff();
        const terminal = this.registeredResultsByRequestId.get(started.requestId) ?? this.pendingResultsByRequestId.get(started.requestId);
        const status = terminal?.status;
        await this.completePowerLifecycle(started.requestId, status === "succeeded" || status === "failed" || status === "cancelled" ? status : "failed");
        await this.cleanupRuntimeDatasetDir(started.requestId);
        assertNoResultHandoff();
        if (this.registeredResultsByRequestId.has(started.requestId)) {
          // Respect an already committed storage result, including a saved
          // reference to this directory. A stop cannot downgrade it or delete it.
          await this.cleanPendingOutput(started.requestId);
          return;
        }
        if (!this.pendingResultsByRequestId.has(started.requestId)) {
          await this.cleanupRuntimeOutputDirectory(started.requestId);
          this.registeredResultsByRequestId.set(started.requestId, normalizeModelTrainingResult({ runId: started.requestId, status: "failed", error: { code: "host_stopped", message: "The host stopped before training completed." } }));
        }
      });
      outputAdmissionUnconfirmed = false;
      return {
        runId: started.requestId,
        status: "queued",
      };
    } catch (error) {
      let retain = outputAdmissionUnconfirmed;
      if (!retain && runtimeDatasetDir) {
        try {
          if (!runtimeDatasetStage) throw new Error("Training input cleanup is unconfirmed.");
          await removeOwnedTrainingStage(runtimeDatasetStage, "input");
        } catch {retain = true;}
      }
      if (retain) this.retainUnconfirmedStages({inputPath: runtimeDatasetDir, inputStage: runtimeDatasetStage, outputPath, outputStage}, lease);
      else lease?.release();
      // Preserve the original start failure and stage code even if safe cleanup
      // is pending. A lost reply never proves the worker did not read the input.
      throw error;
    }
  }

  public async read(requestId: string, workspaceId: string): Promise<ModelTrainingResult> {
    if (this.privateTrainingOwners.has(requestId)) throw privateUnavailable();
    return this.readTrainingInWorkspace(requestId, workspaceId);
  }

  private async readTrainingInWorkspace(requestId: string, workspaceId: string): Promise<ModelTrainingResult> {
    if (
      !isWorkspaceId(workspaceId)
      || this.workspaceIdByRequestId.get(requestId) !== workspaceId
    ) {
      throw new Error("Model training run was not found in this workspace.");
    }
    const existing = this.reads.get(requestId);
    if (existing) return existing;
    const operation = this.readOwned(requestId);
    this.reads.set(requestId, operation);
    try { return await operation; } finally { this.reads.delete(requestId); }
  }

  private async readOwned(requestId: string): Promise<ModelTrainingResult> {
    const cached = this.registeredResultsByRequestId.get(requestId);
    if (cached) {
      await this.cleanupRuntimeDatasetDir(requestId);
      await this.cleanPendingOutput(requestId);
      return cached;
    }
    const pending = this.pendingResultsByRequestId.get(requestId);
    if (pending) {
      await this.cleanupRuntimeDatasetDir(requestId);
      return this.toPendingReviewResult(pending);
    }

    if (this.stoppedTaskIds.has(requestId)) throw new Error("Training stopped before a result was confirmed.");

    const privateOwner = this.privateTrainingOwners.get(requestId);
    if (privateOwner && privateOwner.phase !== "accepted") throw privateUnavailable();
    const statusRecord = privateOwner ? copyPrivateTrainingData(await privateOwner.session!.read()) : await this.dependencies.runtimeTaskRegistry.getTaskStatus(requestId);
    if (this.stoppedTaskIds.has(requestId)) throw new Error("Training stopped before a result was confirmed.");
    if (privateOwner) {
      if ("recordType" in statusRecord || statusRecord.requestId !== requestId || statusRecord.workspaceId !== privateOwner.definition.workspaceId ||
          statusRecord.taskType !== TaskType.MODEL_TRAINING || !["queued", "running", "succeeded", "failed", "cancelled", "unknown"].includes(statusRecord.status) ||
          this.privateTrainingOwners.get(requestId) !== privateOwner) throw privateUnavailable();
      if (["succeeded", "failed", "cancelled"].includes(statusRecord.status)) await this.settlePrivateTraining(privateOwner);
    }
    if (!("recordType" in statusRecord) && (statusRecord.requestId !== requestId || statusRecord.workspaceId !== this.workspaceIdByRequestId.get(requestId) || statusRecord.taskType !== TaskType.MODEL_TRAINING)) throw new Error("Model training status could not be verified.");
    if (statusRecord.status === "succeeded") {
      return this.resolveSucceededResult(statusRecord);
    }

    if (statusRecord.status === "unknown") return normalizeModelTrainingResult({ runId: requestId, status: "running", progress: { message: "Training status is temporarily unavailable." } });
    if (statusRecord.status === "failed" || statusRecord.status === "cancelled") {
      await this.completePowerLifecycle(requestId, statusRecord.status);
      await this.cleanupRuntimeDatasetDir(requestId);
      await this.cleanupRuntimeOutputDirectory(requestId);
      const terminal = normalizeModelTrainingResult({
        runId: requestId,
        status: statusRecord.status,
        ...(statusRecord.error ? { error: statusRecord.error } : {}),
      });
      this.registeredResultsByRequestId.set(requestId, terminal);
      return terminal;
    }

    return normalizeModelTrainingResult({
      runId: requestId,
      status: statusRecord.status,
      progress: this.mapTrainingProgress(statusRecord),
    });
  }

  public async cancel(requestId: string, workspaceId: string): Promise<ModelTrainingResult> {
    if (this.privateTrainingOwners.has(requestId)) throw privateUnavailable();
    if (!isWorkspaceId(workspaceId)) {
      throw new Error("A valid workspace is required to stop model training.");
    }

    const requestContext = this.requestContextByRequestId.get(requestId);
    if (!requestContext || requestContext.normalizedRequest.workspaceId !== workspaceId) {
      throw new Error("Model training run was not found in this workspace.");
    }

    if (this.stoppedTaskIds.has(requestId) || this.registeredResultsByRequestId.has(requestId) || this.pendingResultsByRequestId.has(requestId))
      return this.read(requestId, workspaceId);

    const statusRecord = await this.dependencies.runtimeTaskRegistry.getTaskStatus(requestId);
    if (this.stoppedTaskIds.has(requestId)) return this.read(requestId, workspaceId);
    if ("recordType" in statusRecord || statusRecord.requestId !== requestId
        || statusRecord.workspaceId !== workspaceId || statusRecord.taskType !== TaskType.MODEL_TRAINING) {
      throw new Error("Model training run was not found in this workspace.");
    }
    if (statusRecord.status === "succeeded" || statusRecord.status === "failed" || statusRecord.status === "cancelled") {
      return this.read(requestId, workspaceId);
    }

    const cancellation = await this.dependencies.runtimeTaskRegistry.cancelTask(requestId);
    if (this.stoppedTaskIds.has(requestId)) return this.read(requestId, workspaceId);
    if (cancellation.requestId !== requestId) throw new Error("Model training cancellation could not be verified.");
    const status = cancellation.cancelled || cancellation.status === "cancelled"
      ? "cancelled"
      : cancellation.status === "queued" || cancellation.status === "running"
        ? cancellation.status
        : "failed";

    if (status === "cancelled") {
      await this.completePowerLifecycle(requestId, "cancelled");
      await this.cleanupRuntimeDatasetDir(requestId);
      if (cancellation.status === "cancelled" && cancellation.cancelled) {
        await this.cleanupRuntimeOutputDirectory(requestId);
      }
    }

    return normalizeModelTrainingResult({
      runId: requestId,
      status,
      progress: status === "running" || status === "queued"
        ? this.mapTrainingProgress(statusRecord)
        : undefined,
    });
  }

  public async save(requestId: string, workspaceId: string): Promise<ModelTrainingResult> {
    if (this.privateTrainingOwners.has(requestId)) throw privateUnavailable();
    if (isWorkspaceId(workspaceId) && this.workspaceIdByRequestId.get(requestId) === workspaceId && this.registeredResultsByRequestId.has(requestId)) return this.read(requestId, workspaceId);
    const pending = this.requireOwnedPendingResult(requestId, workspaceId);
    if (this.reviewActionRequestIds.has(requestId)) {
      throw new Error("A model training review action is already in progress.");
    }

    this.reviewActionRequestIds.add(requestId);
    this.approvedRequestIds.add(requestId);
    try {
      return await this.resolveSucceededResult({
        requestId,
        workspaceId: this.requestContextByRequestId.get(requestId)?.normalizedRequest.workspaceId,
        taskType: TaskType.MODEL_TRAINING,
        status: "succeeded",
        concurrencyClass: "unknown",
        data: pending,
      });
    } finally {
      this.approvedRequestIds.delete(requestId);
      this.reviewActionRequestIds.delete(requestId);
    }
  }

  public async discard(requestId: string, workspaceId: string): Promise<ModelTrainingResult> {
    if (this.privateTrainingOwners.has(requestId)) throw privateUnavailable();
    this.requireOwnedPendingResult(requestId, workspaceId);
    if (this.reviewActionRequestIds.has(requestId)) {
      throw new Error("A model training review action is already in progress.");
    }

    this.reviewActionRequestIds.add(requestId);
    try {
      await this.cleanupRuntimeOutputDirectory(requestId);
      const discarded = normalizeModelTrainingResult({
        runId: requestId,
        status: "cancelled",
      });
      this.pendingResultsByRequestId.delete(requestId);
      this.requestContextByRequestId.delete(requestId);
      this.registeredResultsByRequestId.set(requestId, discarded);
      return discarded;
    } finally {
      this.reviewActionRequestIds.delete(requestId);
    }
  }

  private async resolveSucceededResult(statusRecord: RuntimeTaskRecord): Promise<ModelTrainingResult> {
    let trainingResult: ModelTrainingResult;
    try {
    if (!statusRecord.data || typeof statusRecord.data !== "object") {
      throw new Error(`Model training runtime result missing for request '${statusRecord.requestId}'.`);
    }

    const runtimeTrainingResult = statusRecord.data as ModelTrainingResult;
    trainingResult = normalizeModelTrainingResult({
      ...runtimeTrainingResult,
      runId: statusRecord.requestId,
      generatedModelCandidate: runtimeTrainingResult.generatedModelCandidate
        ? {
            ...runtimeTrainingResult.generatedModelCandidate,
            generatedFromRunId: statusRecord.requestId,
          }
        : undefined,
    });
    if (trainingResult.status === "succeeded") {
      const outputStage = this.runtimeOutputStages.get(statusRecord.requestId);
      const candidate = trainingResult.generatedModelCandidate;
      const candidatePath = candidate?.localPath;
      if (!outputStage || !candidate || !candidatePath || !isAbsolute(candidatePath)
          || relative(outputStage.path, candidatePath) !== ""
          || (trainingResult.outputDirectory && (!isAbsolute(trainingResult.outputDirectory)
              || relative(outputStage.path, trainingResult.outputDirectory) !== ""))) {
        throw new Error("Training output folder could not be verified.");
      }
      await assertTrainingOutputStage(outputStage);
      candidate.localPath = outputStage.path;
    }
    } catch {
      await this.completePowerLifecycle(statusRecord.requestId, "failed");
      await this.cleanupRuntimeDatasetDir(statusRecord.requestId);
      const failed = normalizeModelTrainingResult({ runId: statusRecord.requestId, status: "failed", error: { code: "invalid_runtime_result", message: "Training output could not be verified." } });
      this.registeredResultsByRequestId.set(statusRecord.requestId, failed);
      return failed;
    }

    if (trainingResult.status !== "succeeded" || !trainingResult.generatedModelCandidate) {
      await this.completePowerLifecycle(statusRecord.requestId, "unknown");
      await this.cleanupRuntimeDatasetDir(statusRecord.requestId);
      if (trainingResult.status === "failed" || trainingResult.status === "cancelled") {
        await this.cleanupRuntimeOutputDirectory(statusRecord.requestId);
      }
      return trainingResult;
    }

    const requestContext = this.requestContextByRequestId.get(statusRecord.requestId);
    if (!requestContext) {
      throw new Error(`Model training request context missing for request '${statusRecord.requestId}'.`);
    }

    if (!this.approvedRequestIds.has(statusRecord.requestId)) {
      this.pendingResultsByRequestId.set(statusRecord.requestId, trainingResult);
      await this.completePowerLifecycle(statusRecord.requestId, "succeeded");
      await this.cleanupRuntimeDatasetDir(statusRecord.requestId);
      return this.toPendingReviewResult(trainingResult);
    }

    const { normalizedRequest, baseModelRecordId } = requestContext;
    const generated = trainingResult.generatedModelCandidate;
    const registration = normalizedRequest.output.registration;
    const destination = normalizedRequest.output.destination;
    const stagedStorageResult = destination.local.enabled || destination.huggingFace?.enabled
      ? this.storedOutputs.get(statusRecord.requestId) ?? await this.storeGeneratedModelLocally(normalizedRequest, trainingResult, generated)
      : undefined;
    if (stagedStorageResult) this.storedOutputs.set(statusRecord.requestId, stagedStorageResult);
    const localStorageResult = destination.local.enabled ? stagedStorageResult : undefined;
    const publishedResult = destination.huggingFace?.enabled
      ? this.publishedOutputs.get(statusRecord.requestId) ?? await this.publishGeneratedModel(
        normalizedRequest,
        statusRecord.requestId,
        {
          ...generated,
          localPath: stagedStorageResult?.localPath,
        },
      )
      : undefined;
    if (publishedResult) this.publishedOutputs.set(statusRecord.requestId, publishedResult);
    const trainingValidation = generated.metadata && typeof generated.metadata["validation"] === "object"
      ? generated.metadata["validation"] as Record<string, unknown>
      : undefined;
    const runtimeValidationReportPath = typeof trainingResult.validationReportPath === "string"
      ? trainingResult.validationReportPath
      : (typeof trainingValidation?.["validationReportPath"] === "string" ? trainingValidation["validationReportPath"] : undefined);
    const validationReportPath = localStorageResult
      ? this.resolveStoredOutputPath(runtimeValidationReportPath, generated.localPath, localStorageResult.localPath)
      : (publishedResult ? undefined : runtimeValidationReportPath);
    const generatedMetadata = localStorageResult
      ? this.rewriteGeneratedMetadataPaths(generated.metadata, generated.localPath, localStorageResult.localPath)
      : (publishedResult ? this.removeGeneratedMetadataOutputPaths(generated.metadata) : generated.metadata);
    const registered = this.registrations.get(statusRecord.requestId) ?? await this.dependencies.modelRegistry.registerGeneratedModel({
      ...(normalizedRequest.workspaceId ? { workspaceId: normalizedRequest.workspaceId } : {}),
      displayName: registration?.displayName ?? generated.displayName,
      provider: publishedResult ? "huggingface" : generated.provider,
      modelId: publishedResult?.repository ?? generated.modelId ?? localStorageResult?.modelId,
      localPath: localStorageResult?.localPath,
      artifactForm: generated.artifactForm ?? registration?.artifactForm ?? (normalizedRequest.method === "lora" ? "adapter" : "full-model"),
      inferenceMode: generated.inferenceMode ?? registration?.inferenceMode ?? normalizedRequest.baseModel.inferenceMode,
      taskTags: generated.taskTags ?? registration?.taskTags,
      baseModelId: generated.baseModelId ?? registration?.baseModelId ?? normalizedRequest.baseModel.modelId,
      adapterOfModelId: generated.adapterOfModelId ?? registration?.adapterOfModelId ?? normalizedRequest.baseModel.modelId,
      generatedFromRunId: generated.generatedFromRunId ?? trainingResult.runId,
      serializationFormat: generated.serializationFormat,
      sizeBytes: generated.sizeBytes,
      metadata: {
        baseModelRecordId,
        ...registration?.metadata,
        ...generatedMetadata,
        ...(localStorageResult ? { localStorage: { localPath: localStorageResult.localPath, modelId: localStorageResult.modelId } } : {}),
        ...(publishedResult ? {
          published: {
            provider: publishedResult.provider,
            repository: publishedResult.repository,
            revision: publishedResult.revision,
            url: publishedResult.url,
          },
        } : {}),
      },
      validationStatus: typeof trainingValidation?.["status"] === "string"
        ? trainingValidation["status"] as "unknown" | "valid" | "invalid" | "warning"
        : undefined,
      validationReportPath:
        validationReportPath,
    });

    this.registrations.set(statusRecord.requestId, registered);
    const outputModel = publishedResult
      ? (await this.dependencies.modelRegistry.updateModelRecord({
          ...(normalizedRequest.workspaceId ? { workspaceId: normalizedRequest.workspaceId } : {}),
          modelRecordId: registered.model.modelRecordId,
          patch: {
            published: {
              provider: publishedResult.provider,
              repository: publishedResult.repository,
              revision: publishedResult.revision,
              url: publishedResult.url,
              publishedAt: new Date().toISOString(),
            },
          },
        })).model
      : registered.model;

    const result = {
      ...trainingResult,
      outputDirectory: localStorageResult?.localPath ?? (publishedResult ? undefined : trainingResult.outputDirectory),
      validationReportPath,
      generatedModelCandidate: {
        ...generated,
        localPath: localStorageResult?.localPath,
        metadata: generatedMetadata,
      },
      outputModel,
    };
    this.registeredResultsByRequestId.set(statusRecord.requestId, result);
    this.pendingOutputCleanup.set(statusRecord.requestId, { storedPath: localStorageResult?.localPath });
    this.pendingResultsByRequestId.delete(statusRecord.requestId);
    this.requestContextByRequestId.delete(statusRecord.requestId);
    await this.completePowerLifecycle(statusRecord.requestId, "succeeded");
    await this.cleanupRuntimeDatasetDir(statusRecord.requestId);
    await this.cleanPendingOutput(statusRecord.requestId);
    return result;
  }

  private requireOwnedPendingResult(requestId: string, workspaceId: string): ModelTrainingResult {
    if (!isWorkspaceId(workspaceId)) {
      throw new Error("A valid workspace is required to review model training output.");
    }
    const context = this.requestContextByRequestId.get(requestId);
    const pending = this.pendingResultsByRequestId.get(requestId);
    if (!context || context.normalizedRequest.workspaceId !== workspaceId || !pending) {
      throw new Error("Model training review was not found in this workspace.");
    }
    return pending;
  }

  private toPendingReviewResult(result: ModelTrainingResult): ModelTrainingResult {
    return normalizeModelTrainingResult({
      ...result,
      reviewPending: true,
      outputDirectory: undefined,
      checkpoints: undefined,
      logs: undefined,
      validationReportPath: undefined,
      generatedModelCandidate: result.generatedModelCandidate
        ? {
            ...result.generatedModelCandidate,
            localPath: undefined,
            metadata: this.removeGeneratedMetadataOutputPaths(
              result.generatedModelCandidate.metadata,
            ),
          }
        : undefined,
    });
  }

  private async storeGeneratedModelLocally(
    request: ModelTrainingRequest,
    result: ModelTrainingResult,
    generated: NonNullable<ModelTrainingResult["generatedModelCandidate"]>,
  ): Promise<{ localPath: string; modelId?: string }> {
    if (!generated.localPath) {
      throw new Error("Model training succeeded but did not report a generated model directory to store locally.");
    }

    if (!this.dependencies.generatedModelStorage) {
      throw new Error("Local generated model storage is not configured.");
    }

    return this.dependencies.generatedModelStorage.storeGeneratedModel({
      sourceDirectory: generated.localPath,
      outputModelName: result.outputModelName ?? request.output.outputModelName,
      runId: result.runId,
      repository: request.output.destination.huggingFace?.repository,
    });
  }

  private async publishGeneratedModel(
    request: ModelTrainingRequest,
    requestId: string,
    generated: NonNullable<ModelTrainingResult["generatedModelCandidate"]>,
  ) {
    const huggingFace = request.output.destination.huggingFace;
    if (!huggingFace?.enabled || !huggingFace.repository) {
      throw new Error("Hugging Face publish destination is incomplete.");
    }

    if (!generated.localPath) {
      throw new Error("Model training succeeded but did not report a generated model directory to publish.");
    }

    if (!this.dependencies.modelPublisher) {
      throw new Error("Hugging Face model publishing is not configured.");
    }

    if (!isWorkspaceId(request.workspaceId)) {
      throw new Error("workspaceId must be provided for workspace-scoped model publishing.");
    }

    return this.dependencies.modelPublisher.publishModel({
      workspaceId: request.workspaceId,
      modelRecordId: requestId,
      repository: huggingFace.repository,
      revision: huggingFace.revision,
      pathPrefix: huggingFace.pathPrefix,
      private: huggingFace.private,
      modelPath: generated.localPath,
    });
  }

  private resolveStoredOutputPath(
    candidatePath: string | undefined,
    runtimeOutputDirectory: string | undefined,
    storedLocalDirectory: string | undefined,
  ): string | undefined {
    if (!candidatePath || !runtimeOutputDirectory || !storedLocalDirectory) {
      return candidatePath;
    }

    const relativePath = relative(resolve(runtimeOutputDirectory), resolve(candidatePath));
    if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) {
      return candidatePath;
    }

    return join(storedLocalDirectory, relativePath);
  }

  private rewriteGeneratedMetadataPaths(
    metadata: Record<string, unknown> | undefined,
    runtimeOutputDirectory: string | undefined,
    storedLocalDirectory: string | undefined,
  ): Record<string, unknown> | undefined {
    if (!metadata) {
      return metadata;
    }

    const validation = metadata["validation"];
    if (!validation || typeof validation !== "object") {
      return metadata;
    }

    const validationRecord = validation as Record<string, unknown>;
    const validationReportPath = typeof validationRecord["validationReportPath"] === "string"
      ? this.resolveStoredOutputPath(validationRecord["validationReportPath"], runtimeOutputDirectory, storedLocalDirectory)
      : undefined;
    if (!validationReportPath || validationReportPath === validationRecord["validationReportPath"]) {
      return metadata;
    }

    return {
      ...metadata,
      validation: {
        ...validationRecord,
        validationReportPath,
      },
    };
  }

  private removeGeneratedMetadataOutputPaths(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
    if (!metadata) {
      return metadata;
    }

    const validation = metadata["validation"];
    if (!validation || typeof validation !== "object") {
      return metadata;
    }

    const validationRecord = { ...(validation as Record<string, unknown>) };
    delete validationRecord["validationReportPath"];

    return {
      ...metadata,
      validation: validationRecord,
    };
  }

  private mapTrainingProgress(statusRecord: RuntimeTaskRecord): ModelTrainingProgress | undefined {
    const details = statusRecord.progress?.details;
    if (!details || typeof details !== "object") {
      return statusRecord.progress?.message ? { message: statusRecord.progress.message } : undefined;
    }

    return {
      stage: typeof details.stage === "string" ? details.stage : undefined,
      message: typeof details.message === "string" ? details.message : statusRecord.progress?.message,
      epoch: typeof details.epoch === "number" ? details.epoch : undefined,
      totalEpochs: typeof details.totalEpochs === "number" ? details.totalEpochs : undefined,
      batch: typeof details.batch === "number" ? details.batch : undefined,
      totalBatches: typeof details.totalBatches === "number" ? details.totalBatches : undefined,
    };
  }

  private async resolveDatasetForRuntime(
    request: ModelTrainingRequest,
    dataset: ModelTrainingRequest["datasets"][number],
    datasetIndex: number,
    getRuntimeDatasetDir: () => string | undefined,
    setRuntimeDatasetDir: (value: string) => Promise<void>,
    accountBytes: (bytes: number) => void,
    stagedSources: Map<string, StagedTrainingSource>,
  ): Promise<ModelTrainingRequest["datasets"][number]> {
    const bindingsResult = await this.dependencies.storageBindings.readArtifactStorageBindings({
      ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
      artifactId: dataset.artifactId,
    });
    if (!bindingsResult.ok) {
      throw new Error(`Failed to resolve storage binding for dataset artifact '${dataset.artifactId}': ${bindingsResult.error.message}`);
    }

    const storageKey = resolveLocalStorageKeyForArtifact(dataset.artifactId, bindingsResult.value.bindings, request.workspaceId!);
    const retrieved = await this.dependencies.storage.retrieveArtifact(createRetrieveArtifactRequest(storageKey, { maximumBytes: MAXIMUM_TRAINING_SOURCE_BYTES }), { workspaceId: request.workspaceId });
    if (!retrieved.ok) {
      throw new Error(`Failed to retrieve local dataset artifact '${dataset.artifactId}' from artifact-object storage key '${storageKey}': ${retrieved.error.message}`);
    }
    const datasetArtifactMetadata = isRecord(retrieved.value.descriptor.metadata)
      ? retrieved.value.descriptor.metadata
      : undefined;

    let runtimeDatasetDir = getRuntimeDatasetDir();
    if (!runtimeDatasetDir) {
      runtimeDatasetDir = await mkdtemp(join(await realpath(tmpdir()), "ai-system-builder-training-datasets-"));
      await setRuntimeDatasetDir(runtimeDatasetDir);
    }
    const localPath = buildRuntimeDatasetPath(runtimeDatasetDir, dataset.artifactId, retrieved.value.descriptor.mediaType, datasetIndex);
    const bytes = trainingSourceBytes(retrieved.value.content); accountBytes(bytes.byteLength);
    await writeFile(localPath, bytes, { flag: "wx", mode: 0o600 });
    const stagedSourceArtifactPaths = isImageTrainingTask(request.trainingTask)
      ? await this.stageSourceArtifactsForRuntime(request, datasetArtifactMetadata, runtimeDatasetDir, accountBytes, stagedSources)
      : undefined;
    const datasetRuntimeMetadata = {
      ...dataset.metadata,
      ...(datasetArtifactMetadata ? { artifactMetadata: datasetArtifactMetadata } : {}),
      ...(stagedSourceArtifactPaths && Object.keys(stagedSourceArtifactPaths).length > 0
        ? {
            sourceArtifactIds: Object.keys(stagedSourceArtifactPaths),
            stagedSourceArtifactPaths,
          }
        : {}),
    };
    return {
      ...dataset,
      path: localPath,
      format: dataset.format ?? parse(localPath).ext.replace(/^\./, ""),
      ...(Object.keys(datasetRuntimeMetadata).length > 0 ? { metadata: datasetRuntimeMetadata } : {}),
    };
  }

  private async stageSourceArtifactsForRuntime(
    request: ModelTrainingRequest,
    datasetMetadata: Record<string, unknown> | undefined,
    runtimeDatasetDir: string,
    accountBytes: (bytes: number) => void,
    stagedSources: Map<string, StagedTrainingSource>,
  ): Promise<Record<string, string>> {
    const sourceArtifactIds = extractSourceArtifactIds(datasetMetadata);
    if (sourceArtifactIds.length > 128) throw new Error("Training source artifact count exceeds its limit.");
    if (sourceArtifactIds.length === 0) {
      return {};
    }

    const stagedSourceArtifactPaths: Record<string, string> = {};
    await mkdir(join(runtimeDatasetDir, "sources"), { recursive: true });

    for (const artifactId of sourceArtifactIds) {
      const bindingsResult = await this.dependencies.storageBindings.readArtifactStorageBindings({
        ...(request.workspaceId ? { workspaceId: request.workspaceId } : {}),
        artifactId,
      });
      if (!bindingsResult.ok) {
        throw new Error(`Failed to resolve storage binding for source artifact '${artifactId}': ${bindingsResult.error.message}`);
      }

      const storageKey = resolveLocalStorageKeyForArtifact(artifactId, bindingsResult.value.bindings, request.workspaceId!);
      if (!storageKey.trim()) {
        throw new Error(`Storage locator missing for source artifact '${artifactId}'.`);
      }

      const cached = stagedSources.get(artifactId);
      if (cached) {
        if (cached.storageKey !== storageKey) throw new Error("Training source binding changed while staging.");
        await assertStagedTrainingSource(cached);
        stagedSourceArtifactPaths[artifactId] = cached.path;
        continue;
      }

      const retrieved = await this.dependencies.storage.retrieveArtifact(createRetrieveArtifactRequest(storageKey, { maximumBytes: MAXIMUM_TRAINING_SOURCE_BYTES }), { workspaceId: request.workspaceId });
      if (!retrieved.ok) {
        throw new Error(`Failed to retrieve source artifact '${artifactId}' from artifact-object storage key '${storageKey}': ${retrieved.error.message}`);
      }

      const localPath = buildRuntimeSourceArtifactPath(runtimeDatasetDir, artifactId, retrieved.value.descriptor.mediaType, stagedSources.size);
      const bytes = trainingSourceBytes(retrieved.value.content); accountBytes(bytes.byteLength);
      await writeFile(localPath, bytes, { flag: "wx", mode: 0o600 });
      stagedSources.set(artifactId, await captureStagedTrainingSource(localPath, storageKey, bytes.byteLength));
      stagedSourceArtifactPaths[artifactId] = localPath;
    }

    return stagedSourceArtifactPaths;
  }

  private async completePowerLifecycle(requestId: string, status: "succeeded" | "failed" | "cancelled" | "unknown"): Promise<void> {
    try {
      await this.dependencies.taskPowerLifecycle.completeTask(requestId, status);
    } catch {
      // Power blocker teardown failures must not fail model training.
    }
  }

  private async cleanupRuntimeDatasetDir(requestId: string): Promise<void> {
    const privateOwner = this.privateTrainingOwners.get(requestId);
    if (privateOwner && !privateOwner.settled) throw privateUnavailable();
    const stage = this.runtimeDatasetStagesByRequestId.get(requestId);
    if (!stage) {
      return;
    }

    await removeOwnedTrainingStage(stage, "input");
    if (this.runtimeDatasetStagesByRequestId.get(requestId) === stage) this.runtimeDatasetStagesByRequestId.delete(requestId);
  }

  private async cleanupRuntimeOutputDirectory(requestId: string, storedLocalDirectory?: string): Promise<void> {
    const privateOwner = this.privateTrainingOwners.get(requestId);
    if (privateOwner && !privateOwner.settled) throw privateUnavailable();
    const outputStage = this.runtimeOutputStages.get(requestId);
    if (!outputStage) return;
    if (outputStage.cleanup) return outputStage.cleanup;
    outputStage.cleanup = (async () => {
      if (!storedLocalDirectory || relative(outputStage.path, storedLocalDirectory) !== "") {
        await assertTrainingOutputStage(outputStage);
        try {
          await rm(outputStage.path, { recursive: true });
        } catch {
          throw new Error("Training output cleanup could not be confirmed.");
        }
      }
      this.runtimeOutputStages.delete(requestId);
    })();
    try {
      await outputStage.cleanup;
    } finally {
      delete outputStage.cleanup;
    }
  }
}
