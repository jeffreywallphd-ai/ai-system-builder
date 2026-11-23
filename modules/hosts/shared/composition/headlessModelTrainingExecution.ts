import {createHash} from "node:crypto";
import {isAbsolute} from "node:path";
import {isDeepStrictEqual, types} from "node:util";
import type {prepareStructuredHeadlessPlanStepWithTraining} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import type {ApplicationRequestContext} from "../../../application/ports";
import type {ApprovedLocalTrainingBytes, ApprovedLocalTrainingTask} from "../../../application/ports/model";
import type {TrainModelUseCase} from "../../../application/use-cases/model/train-model.use-case";
import type {ReadHeadlessModelTrainingModelUseCase} from "../../../application/use-cases/model/headless-model-training-model.use-case";
import type {ReadHeadlessModelTrainingDatasetUseCase} from "../../../application/use-cases/model/headless-model-training-dataset.use-case";
import {normalizeDatasetVersionRecord, type DatasetVersionArtifact} from "../../../contracts/dataset";
import {readHeadlessPlanStepRequest, readHeadlessPlanStepResult, projectHeadlessDatasetVersion,
  type HeadlessPlanStepRequest} from "../../../contracts/headless";
import type {ModelTrainingRequest} from "../../../contracts/model";
import {readStrictPassiveRecord} from "../../../contracts/shared";
import {RETRIEVE_ARTIFACT_MAXIMUM_BYTES} from "../../../contracts/storage";
import {captureHeadlessModelReviewReader, copyHeadlessModelPlanData} from "./headlessModelDownloadReview";
import {isHeadlessReadCurrent} from "./headlessReadCurrent";

type Prepared = Extract<NonNullable<Awaited<ReturnType<typeof prepareStructuredHeadlessPlanStepWithTraining>>>, {kind: "model-training"}>;
type Readers = {readonly model: Pick<ReadHeadlessModelTrainingModelUseCase, "execute">;
  readonly dataset: Pick<ReadHeadlessModelTrainingDatasetUseCase, "execute">};
export type StartHeadlessModelTraining = TrainModelUseCase["startApprovedLocal"];
export interface RetainedHeadlessTrainingTask {
  readonly scope: Prepared["scope"];
  readonly selection: Prepared["selection"];
  readonly proposalDigest: string;
  readonly task: ApprovedLocalTrainingTask;
}
const unavailable = () => new Error("The original approved training inputs are unavailable.");
const media: Readonly<Record<string, string>> = {"application/x-ndjson": "jsonl", "application/jsonl": "jsonl",
  "application/json": "json", "text/json": "json", "text/csv": "csv", "application/csv": "csv",
  "application/x-parquet": "parquet", "application/vnd.apache.parquet": "parquet"};
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const byteLength = Object.getOwnPropertyDescriptor(typedArray, "byteLength")!.get!;
const arrayBuffer = Object.getOwnPropertyDescriptor(typedArray, "buffer")!.get!;
const sha = (value: Uint8Array) => "sha256:" + createHash("sha256").update(value).digest("hex");
function record(value: unknown, keys: readonly string[]) {
  if (types.isProxy(value)) throw unavailable();
  return readStrictPassiveRecord(value, keys);
}
function copy<T>(value: T): T {return copyHeadlessModelPlanData(value) as T;}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {for (const child of Object.values(value)) freeze(child); Object.freeze(value);} return value;
}
function capture<Fn extends (...args: any[]) => any>(owner: object, key: string): Fn {
  if (!owner || types.isProxy(owner)) throw unavailable();
  let at: object | null = owner;
  for (let depth = 0; at && at !== Object.prototype && depth < 8; depth++) {
    if (types.isProxy(at)) throw unavailable();
    const field = Object.getOwnPropertyDescriptor(at, key);
    if (field) {
      if (!("value" in field) || typeof field.value !== "function" || types.isProxy(field.value)) throw unavailable();
      const method = field.value;
      return ((...args: unknown[]) => Reflect.apply(method, owner, args)) as Fn;
    }
    at = Object.getPrototypeOf(at);
  }
  throw unavailable();
}
function optionalCompletion(owner: ApprovedLocalTrainingTask): ApprovedLocalTrainingTask["reviewCompletion"] {
  for (let at: object | null = owner, depth = 0; at && at !== Object.prototype && depth < 8; at = Object.getPrototypeOf(at), depth++) {
    if (types.isProxy(at)) throw unavailable();
    if (Object.getOwnPropertyDescriptor(at, "reviewCompletion"))
      return capture<NonNullable<ApprovedLocalTrainingTask["reviewCompletion"]>>(owner, "reviewCompletion");
  }
  return undefined;
}
function bytes(raw: unknown, size: number, digest: string, maximum: number) {
  if (!types.isUint8Array(raw) || types.isProxy(raw) || types.isSharedArrayBuffer(arrayBuffer.call(raw)) ||
      !Number.isSafeInteger(size) || size < 1 || size > maximum || byteLength.call(raw) !== size) throw unavailable();
  const content = new Uint8Array(size); Uint8Array.prototype.set.call(content, raw);
  if (sha(content) !== digest) throw unavailable();
  return content;
}
function dense(raw: unknown, maximum: number): unknown[] {
  if (!Array.isArray(raw) || types.isProxy(raw) || Object.getPrototypeOf(raw) !== Array.prototype ||
      raw.length < 1 || raw.length > maximum || Reflect.ownKeys(raw).length !== raw.length + 1) throw unavailable();
  const items = [];
  for (let index = 0; index < raw.length; index++) {
    const field = Object.getOwnPropertyDescriptor(raw, String(index));
    if (!field || !("value" in field) || !field.enumerable) throw unavailable();
    items.push(field.value);
  }
  return items;
}
function datasetInputs(raw: unknown, original: Prepared["request"], binding: Prepared["binding"], organizationId: string) {
  const result = record(raw, ["ok", "prepared", "code"]);
  if (result.ok !== true) throw unavailable();
  const row = record(result.prepared, ["request", "version", "contents", "recipe", "verification", "trainingApproval", "resultSaveApproval"]);
  if (row.trainingApproval !== "required" || row.resultSaveApproval !== "required" || !isDeepStrictEqual(copy(row.request), original)) throw unavailable();
  const version = normalizeDatasetVersionRecord(copy(row.version) as Parameters<typeof normalizeDatasetVersionRecord>[0]);
  if (version.organizationId !== organizationId || version.workspaceId !== original.input.workspaceId ||
      version.datasetId !== original.input.dataset.datasetId || version.versionId !== original.input.dataset.versionId ||
      !isDeepStrictEqual(projectHeadlessDatasetVersion(version), binding.inputs.dataset.version)) throw unavailable();
  const train = version.artifacts.filter(item => item.role === "train");
  if (!train.length && (version.lineage.split || version.artifacts.some(item => ["train", "validation", "test"].includes(item.role)))) throw unavailable();
  const expected = [...(train.length ? train : version.artifacts.filter(item => item.role === "dataset")).map(artifact => ({artifact, role: "train" as const})),
    ...version.artifacts.filter(item => item.role === "validation").map(artifact => ({artifact, role: "validation" as const}))];
  if (!expected.some(item => item.role === "train") || expected.length > 16 ||
      new Set(expected.map(item => item.artifact.artifactKey)).size !== expected.length) throw unavailable();
  const excluded = new Set([...version.lineage.sources.map(item => item.artifactKey), ...version.artifacts.filter(item =>
    item.role !== "train" && item.role !== "validation" && (train.length > 0 || item.role !== "dataset")).map(item => item.artifactKey)]);
  const heldOut = new Set(version.artifacts.filter(item => item.role === "test").map(item => item.digest));
  const rows = dense(row.contents, 16); if (rows.length !== expected.length) throw unavailable();
  let total = 0;
  const inputs: ApprovedLocalTrainingBytes[] = rows.map((value, index) => {
    const current = record(value, ["role", "artifact", "content"]), selected = expected[index];
    const artifact = copy(current.artifact) as DatasetVersionArtifact;
    if (current.role !== selected.role || !isDeepStrictEqual(artifact, selected.artifact) || excluded.has(artifact.artifactKey) ||
        heldOut.has(artifact.digest) || !media[artifact.mediaType]) throw unavailable();
    total += artifact.sizeBytes; if (total > 256 * 1024 * 1024) throw unavailable();
    return Object.freeze({artifactId: "input-" + index, role: selected.role, mediaType: artifact.mediaType, digest: artifact.digest,
      content: bytes(current.content, artifact.sizeBytes, artifact.digest, RETRIEVE_ARTIFACT_MAXIMUM_BYTES)});
  });
  const savedRecipe = record(row.recipe, ["artifact", "content"]), recipeArtifact = copy(savedRecipe.artifact) as DatasetVersionArtifact;
  const recorded = version.artifacts.filter(item => item.role === "recipe");
  if (recorded.length !== 1 || !isDeepStrictEqual(recipeArtifact, recorded[0]) || recipeArtifact.artifactKey !== version.lineage.recipe.artifactKey ||
      recipeArtifact.digest !== binding.inputs.dataset.version.recipeDigest || recipeArtifact.mediaType !== "application/json" ||
      total + recipeArtifact.sizeBytes > 256 * 1024 * 1024) throw unavailable();
  const recipe = Object.freeze({digest: recipeArtifact.digest,
    content: bytes(savedRecipe.content, recipeArtifact.sizeBytes, recipeArtifact.digest, 512 * 1024)});
  return {inputs: Object.freeze(inputs), recipe};
}
function modelSelection(raw: unknown, request: Prepared["request"], binding: Prepared["binding"]) {
  const result = record(copy(raw), ["ok", "prepared", "code"]); if (result.ok !== true) throw unavailable();
  const row = record(result.prepared, ["request", "workspaceId", "model", "localModelReference", "selectionDigest", "verification", "trainingApprovalRequired", "resultSaveApprovalRequired"]);
  if (row.trainingApprovalRequired !== true || row.resultSaveApprovalRequired !== true || row.workspaceId !== request.input.workspaceId ||
      !isDeepStrictEqual(row.request, request) || !isDeepStrictEqual(row.model, binding.inputs.model) || typeof row.localModelReference !== "string" ||
      !isAbsolute(row.localModelReference) || /^[\\/]{2}/.test(row.localModelReference) || row.localModelReference.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(row.localModelReference) || typeof row.selectionDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(row.selectionDigest)) throw unavailable();
  const model = binding.inputs.model;
  if (model.artifactForm !== "full-model" || model.serializationFormat !== "safetensors" || model.inferenceMode !== "causal") throw unavailable();
  const expected = "sha256:" + createHash("sha256").update(JSON.stringify({request: row.request,
    model: {model: row.model, localModelReference: row.localModelReference}})).digest("hex");
  if (row.selectionDigest !== expected) throw unavailable();
  return freeze({model, localModelReference: row.localModelReference, selectionDigest: row.selectionDigest});
}

/** Internal composition only. No public route, native preparation, runtime
 * supplier or Model Save is configured here. All byte reads occur OUTSIDE the
 * prepared metadata transactions. A real root must compose original ModelRead,
 * DatasetRead and training-write authority, plus the qualified private port. */
export async function runPreparedHeadlessModelTraining(options: {
  readonly prepared: Prepared; readonly request: HeadlessPlanStepRequest; readonly context: ApplicationRequestContext;
  readonly canUse: () => Promise<boolean>; readonly isHostCurrent: () => boolean;
  readonly stillBusinessAllowed: () => Promise<boolean>;
  readonly getReaders: () => Promise<Readers | undefined>;
  readonly resolveStart: () => Promise<StartHeadlessModelTraining | undefined>;
  /** Synchronous custody only, before awaited acceptance. No IO or fresh lookup.
   * False/throw/Promise leaves issuance unconfirmed, never a second start. */
  readonly retainTask: (value: RetainedHeadlessTrainingTask) => boolean;
}) {
  const forbidden = {result: {ok: false, code: "headless.forbidden"}} as const;
  const unconfirmed = {result: {ok: false, code: "headless.operation-unconfirmed"}} as const;
  try {
    const fields = record(options, ["prepared", "request", "context", "canUse", "isHostCurrent", "stillBusinessAllowed", "getReaders", "resolveStart", "retainTask"]);
    const prepared = fields.prepared as Prepared;
    const canUse = capture<typeof options.canUse>(options, "canUse"), isHostCurrent = capture<typeof options.isHostCurrent>(options, "isHostCurrent");
    const stillBusinessAllowed = capture<typeof options.stillBusinessAllowed>(options, "stillBusinessAllowed");
    const getReaders = capture<typeof options.getReaders>(options, "getReaders"), resolveStart = capture<typeof options.resolveStart>(options, "resolveStart");
    const retainTask = capture<typeof options.retainTask>(options, "retainTask");
    record(prepared, ["kind", "request", "binding", "scope", "selection", "expiresAt", "isCurrent", "isStartCurrent", "stillAllowed",
      "inspect", "reserve", "issue", "accept", "recordNotStarted", "readReceipt", "publishIfCurrent"]);
    for (const fn of [canUse, isHostCurrent, stillBusinessAllowed, getReaders, resolveStart, retainTask])
      if (typeof fn !== "function" || types.isProxy(fn)) return forbidden;
    const scope = freeze(copy(prepared.scope)), selection = freeze(copy(prepared.selection));
    const original = freeze(copy(prepared.request)), binding = freeze(copy(prepared.binding)), expiresAt = prepared.expiresAt;
    const current = capture<Prepared["isCurrent"]>(prepared, "isCurrent"), startCurrent = capture<Prepared["isStartCurrent"]>(prepared, "isStartCurrent");
    const stillAllowed = capture<Prepared["stillAllowed"]>(prepared, "stillAllowed"), inspect = capture<Prepared["inspect"]>(prepared, "inspect");
    const reserve = capture<Prepared["reserve"]>(prepared, "reserve"), issue = capture<Prepared["issue"]>(prepared, "issue");
    const accept = capture<Prepared["accept"]>(prepared, "accept"), nonStart = capture<Prepared["recordNotStarted"]>(prepared, "recordNotStarted");
    const readReceipt = capture<Prepared["readReceipt"]>(prepared, "readReceipt"), publishApproved = capture<Prepared["publishIfCurrent"]>(prepared, "publishIfCurrent");
    const context = copy(fields.context) as ApplicationRequestContext, parsed = readHeadlessPlanStepRequest(copy(fields.request), selection.hostIncarnationId);
    if (!parsed.ok || parsed.request.transient !== undefined || !isDeepStrictEqual(parsed.request.input, selection) ||
        context.organizationId !== scope.organizationId || context.principalId !== scope.principalId || context.workspaceId !== scope.workspaceId) return forbidden;
    const request = freeze(parsed.request), hostCurrent = () => isHeadlessReadCurrent(isHostCurrent);
    const admit = async () => hostCurrent() && current() && await canUse() === true && current() &&
      await stillAllowed() === true && current() && hostCurrent();
    const business = async () => hostCurrent() && await stillBusinessAllowed() === true && hostCurrent();
    if (!await admit()) return forbidden;
    const observed = await inspect(); if (!observed) return unconfirmed;
    let notStarted = observed.kind === "not-started", kind: "started" | "replayed" = "replayed";
    let reference = observed.kind === "accepted" ? observed.reference : undefined;
    if (observed.kind === "absent") {
      if (!await business() || !await admit()) return forbidden;
      const start = await resolveStart();
      if (typeof start !== "function" || types.isProxy(start) || !await admit() || !await business()) return forbidden;
      const readers = await getReaders();
      if (!readers) return forbidden;
      const selectedReaders = record(readers, ["model", "dataset"]);
      const model = captureHeadlessModelReviewReader<ReadHeadlessModelTrainingModelUseCase["execute"]>(selectedReaders.model);
      const dataset = captureHeadlessModelReviewReader<ReadHeadlessModelTrainingDatasetUseCase["execute"]>(selectedReaders.dataset);
      if (!model || !dataset || !await admit() || !await business()) return forbidden;
      const reserved = await reserve(); if (!reserved) return unconfirmed;
      if (reserved.kind === "capacity") return {result: {ok: false, code: "headless.operation-capacity"}} as const;
      if (reserved.kind === "not-started") notStarted = true;
      else if (reserved.kind === "accepted") reference = reserved.reference;
      else if (reserved.kind === "new") {
        const {taskId, proposalDigest} = reserved;
        const readAuthority = Object.freeze({hostIncarnationId: selection.hostIncarnationId, context: Object.freeze({organizationId: scope.organizationId,
          principalId: scope.principalId, workspaceId: scope.workspaceId}), clientId: scope.registeredClientId,
          isCurrent: () => hostCurrent() && current() && startCurrent(), stillAllowed: async () => await admit() && await business()});
        let privateInputs: ReturnType<typeof datasetInputs>, selected: ReturnType<typeof modelSelection>;
        try {
          if (!await admit() || !await business() || !startCurrent()) throw unavailable();
          selected = modelSelection(await model.execute(original, readAuthority), original, binding);
          if (!await admit() || !await business() || !startCurrent()) throw unavailable();
          // Snapshot and verify every returned byte BEFORE another awaited policy.
          privateInputs = datasetInputs(await dataset.execute(original, readAuthority), original, binding, scope.organizationId);
          if (!await admit() || !await business() || !startCurrent()) throw unavailable();
          const latest = modelSelection(await model.execute(original, readAuthority), original, binding);
          if (!isDeepStrictEqual(latest, selected) || !await admit() || !await business() || !startCurrent()) throw unavailable();
        } catch {
          if (!await nonStart(taskId, proposalDigest)) return unconfirmed;
          return await admit() ? {result: {ok: false, code: "headless.not-started"}} as const : forbidden;
        }
        const input = original.input, settings = input.training;
        const training: ModelTrainingRequest = freeze({workspaceId: scope.workspaceId, trainingTask: settings.trainingTask,
          baseModel: {modelRecordId: input.model.modelRecordId, localPath: selected.localModelReference, provider: selected.model.provider,
            ...(selected.model.modelId ? {modelId: selected.model.modelId} : {}), inferenceMode: selected.model.inferenceMode},
          datasets: privateInputs.inputs.map(row => ({artifactId: row.artifactId, splitRole: row.role, format: media[row.mediaType]})),
          method: settings.method, commonParameters: settings.commonParameters,
          ...(settings.advancedParameters ? {advancedParameters: settings.advancedParameters} : {}),
          ...(settings.validation ? {validation: settings.validation} : {}),
          output: {outputModelName: input.name, destination: {local: {enabled: false}}}});
        if (!await admit() || !await business() || !startCurrent()) {
          if (!await nonStart(taskId, proposalDigest)) return unconfirmed;
          return forbidden;
        }
        const result = await Reflect.apply(start, undefined, [training, {
            requestId: taskId, organizationId: scope.organizationId, principalId: scope.principalId,
            clientId: scope.registeredClientId, hostIncarnationId: selection.hostIncarnationId,
            modelUpdatedAt: input.model.updatedAt, datasetId: input.dataset.datasetId, versionId: input.dataset.versionId,
            versionDigest: input.dataset.versionDigest, proposalDigest, inputs: privateInputs.inputs, recipe: privateInputs.recipe,
            // The application can accept before its outward start Promise
            // returns. This retained control is business-only from entry;
            // separate fences below own every new-start admission.
            control: {isCurrent: hostCurrent, stillAllowed: business},
            isAdmissionCurrent: () => hostCurrent() && current() && startCurrent(),
            acknowledgeIssued: async () => {
              if (!await admit() || !await business() || !startCurrent()) return false;
              const outcome = await issue(taskId, proposalDigest);
              if (outcome === "unconfirmed") throw unavailable();
              return outcome === "issued";
            },
          }]) as Awaited<ReturnType<StartHeadlessModelTraining>>;
        const response = record(result, ["kind", "value", "task"]);
        if (response.kind === "unavailable" && Object.keys(response).length === 1) {
          if (!await nonStart(taskId, proposalDigest)) return unconfirmed;
          notStarted = true;
        } else {
          if (response.kind !== "accepted" || Object.keys(response).length !== 3) return unconfirmed;
          const value = record(copy(response.value), ["runId", "status"]), task = response.task as ApprovedLocalTrainingTask;
          if (value.runId !== taskId || !["queued", "running"].includes(value.status as string) ||
              record(task, ["requestId", "workspaceId", "read", "cancel", "reviewCompletion"]).requestId !== taskId || task.workspaceId !== scope.workspaceId) return unconfirmed;
          const reviewCompletion = optionalCompletion(task);
          const retainedTask = Object.freeze({requestId: taskId, workspaceId: scope.workspaceId,
            read: capture<ApprovedLocalTrainingTask["read"]>(task, "read"), cancel: capture<ApprovedLocalTrainingTask["cancel"]>(task, "cancel"),
            ...(reviewCompletion ? {reviewCompletion} : {})});
          // No await between the original ACK and capturing its private owner.
          const retained: unknown = Reflect.apply(retainTask, undefined, [Object.freeze({scope, selection, proposalDigest, task: retainedTask})]);
          if (types.isPromise(retained)) void Promise.prototype.then.call(retained, undefined, () => {});
          if (retained !== true) return unconfirmed;
          if (!await accept(taskId)) return unconfirmed;
          kind = "started"; reference = await readReceipt();
        }
      }
    }
    if (!await admit()) return forbidden;
    if (notStarted) return {result: {ok: false, code: "headless.not-started"}} as const;
    if (!reference) return unconfirmed;
    return {result: readHeadlessPlanStepResult({ok: true, value: {kind, operation: "models.train", reference,
      fingerprint: request.input.fingerprint, step: request.input.step, approvalRevision: request.input.approvalRevision, expiresAt}},
      request.input, {allowLocalFileSave: false, allowModelTraining: true}),
      async publishIfCurrent(publish: Parameters<Prepared["publishIfCurrent"]>[0]) {
        // Historical receipt disclosure needs current caller policy, not a
        // renewed business-write grant or another input/runtime resolution.
        try {return await admit() && await publishApproved(publish);} catch {return false;}
      }};
  } catch {return unconfirmed;}
}
