import {createHash} from "node:crypto";
import {isDeepStrictEqual, types} from "node:util";
import {readStrictPassiveRecord, hasKnownPassiveCredential} from "../../../contracts/shared";
import {isOrganizationId, type OrganizationId} from "../../../contracts/organization";
import {normalizeDatasetVersionRecord, type DatasetVersionRecord, type DatasetVersionArtifact} from "../../../contracts/dataset";
import {createRetrieveArtifactRequest, RETRIEVE_ARTIFACT_MAXIMUM_BYTES} from "../../../contracts/storage";
import {isDesktopHeadlessClientId, readHeadlessModelTrainingPlanRequest} from "../../../contracts/headless";
import type {ArtifactObjectStoragePort} from "../../ports/storage";
import type {ReadDatasetVersionUseCase} from "../dataset-version/dataset-version-read.use-cases";
import type {PreviewHeadlessModelTrainingInputsUseCase} from "./headless-model-training-inputs.use-case";
import {copyHeadlessModelWorkflowData} from "./headless-model-download-preview.use-case";

type Authority = Parameters<PreviewHeadlessModelTrainingInputsUseCase["execute"]>[1];
const forbidden = {ok: false, code: "headless.forbidden"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;
const stale = {ok: false, code: "headless.stale"} as const;
const recipeLimit = 512 * 1024;
const aggregateLimit = 256 * 1024 * 1024;
const mediaTypes = new Set(["application/x-ndjson", "application/jsonl", "application/json", "text/json",
  "text/csv", "application/csv", "application/x-parquet", "application/vnd.apache.parquet"]);
const authorityKeys = ["hostIncarnationId", "context", "clientId", "isCurrent", "stillAllowed"];
const contextKeys = ["organizationId", "principalId", "workspaceId", "requestId", "correlationId"];
const typedArray = Object.getPrototypeOf(Uint8Array.prototype);
const byteLengthOf = Object.getOwnPropertyDescriptor(typedArray, "byteLength")!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(typedArray, "buffer")!.get!;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
}
function record(raw: unknown, keys: readonly string[]) {
  if (types.isProxy(raw)) throw new Error("Private training data is unavailable.");
  return readStrictPassiveRecord(raw, keys);
}
function digest(bytes: Uint8Array) {return "sha256:" + createHash("sha256").update(bytes).digest("hex");}
/** Copy intrinsic typed-array bytes without calling subclass/species hooks. */
function bytes(raw: unknown, limit: number): Uint8Array {
  if (!types.isUint8Array(raw) || types.isProxy(raw)) throw new Error("Private training data is unavailable.");
  const length = byteLengthOf.call(raw) as number, buffer = bufferOf.call(raw);
  if (types.isSharedArrayBuffer(buffer) || length < 1 || length > limit) throw new Error("Private training data is unavailable.");
  const copy = new Uint8Array(length);
  Uint8Array.prototype.set.call(copy, raw);
  return copy;
}
function selectedArtifacts(version: DatasetVersionRecord) {
  const train = version.artifacts.filter(row => row.role === "train");
  const validation = version.artifacts.filter(row => row.role === "validation");
  const hasSplit = Boolean(version.lineage.split) || version.artifacts.some(row => ["train", "validation", "test"].includes(row.role));
  if (hasSplit && !train.length) throw new Error("The saved training split is unavailable.");
  const selected: {readonly artifact: DatasetVersionArtifact; readonly role: "train" | "validation"}[] = [
    ...(train.length ? train : version.artifacts.filter(row => row.role === "dataset")).map(artifact => ({artifact, role: "train" as const})),
    ...validation.map(artifact => ({artifact, role: "validation" as const})),
  ];
  if (!selected.length || selected.length > 16 ||
      new Set(selected.map(row => row.artifact.artifactKey)).size !== selected.length) throw new Error("Training inputs exceed their bound.");
  // Role:key uniqueness does not make roles disjoint: an otherwise valid saved
  // version may label the SAME key both train and test/report/aggregate/source.
  // Test digests also deny identical held-out bytes under an alternate key.
  // This uses recorded exact digests, not fresh test reads or row-level quality.
  const excludedKeys = new Set([
    ...version.artifacts.filter(row => row.role !== "train" && row.role !== "validation" && (train.length > 0 || row.role !== "dataset"))
      .map(row => row.artifactKey),
    ...version.lineage.sources.map(row => row.artifactKey),
  ]);
  const testDigests = new Set(version.artifacts.filter(row => row.role === "test").map(row => row.digest));
  if (selected.some(row => excludedKeys.has(row.artifact.artifactKey) || testDigests.has(row.artifact.digest)))
    throw new Error("Saved training inputs conflict with excluded data.");
  let total = 0;
  for (const {artifact} of selected) {
    if (!Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 1 || artifact.sizeBytes > RETRIEVE_ARTIFACT_MAXIMUM_BYTES ||
        artifact.rowCount === 0 || !mediaTypes.has(artifact.mediaType)) throw new Error("The saved training input is unavailable.");
    total += artifact.sizeBytes;
  }
  if (total > aggregateLimit) throw new Error("Training inputs exceed their bound.");
  return selected;
}

/** Private byte preparation ONLY. Never serialize this result as a tool reply.
 * It proves copied Dataset/recipe content, not Model bytes, task compatibility,
 * readiness/resources/rights/quality, approval, or a durable native file fence.
 * The eventual execution owner must separately authorize and stage its copies. */
export class ReadHeadlessModelTrainingDatasetUseCase {
  constructor(private readonly dependencies: {readonly organizationId: OrganizationId;
    readonly versions: Pick<ReadDatasetVersionUseCase, "execute">;
    readonly artifacts: Pick<ArtifactObjectStoragePort, "retrieveArtifact">}) {}

  async execute(raw: unknown, authority: Authority) {
    let current = () => false;
    try {
      const captured = record(authority, authorityKeys), originalContext = captured.context;
      const actor = record(originalContext, contextKeys);
      const {isCurrent, stillAllowed, hostIncarnationId, clientId} = captured;
      if (!isOrganizationId(actor.organizationId) || actor.organizationId !== this.dependencies.organizationId ||
          typeof actor.principalId !== "string" || !actor.principalId || actor.principalId.length > 160 ||
          /[\x00-\x1f\x7f]/.test(actor.principalId) || hasKnownPassiveCredential(actor.principalId) ||
          !isDesktopHeadlessClientId(clientId) || typeof isCurrent !== "function" || types.isProxy(isCurrent) ||
          typeof stillAllowed !== "function" || types.isProxy(stillAllowed)) return forbidden;
      let parsed: ReturnType<typeof readHeadlessModelTrainingPlanRequest>;
      try {parsed = readHeadlessModelTrainingPlanRequest(copyHeadlessModelWorkflowData(raw), hostIncarnationId as Authority["hostIncarnationId"]);}
      catch {return {ok: false, code: "headless.invalid-request"} as const;}
      if (!parsed.ok) return parsed;
      const request = freeze(parsed.request), input = request.input;
      if (actor.workspaceId !== input.workspaceId) return forbidden;
      const context = Object.freeze({organizationId: actor.organizationId, principalId: actor.principalId, workspaceId: input.workspaceId});
      const same = () => {
        const actual = record(authority, authorityKeys), now = record(originalContext, contextKeys);
        return actual.context === originalContext && actual.clientId === clientId && actual.hostIncarnationId === input.hostIncarnationId &&
          actual.isCurrent === isCurrent && actual.stillAllowed === stillAllowed && now.organizationId === context.organizationId &&
          now.principalId === context.principalId && now.workspaceId === context.workspaceId;
      };
      current = () => {
        try {
          if (!same()) return false;
          const value: unknown = isCurrent.call(authority);
          if (types.isPromise(value)) void Promise.prototype.then.call(value, undefined, () => {});
          return value === true && same();
        } catch {return false;}
      };
      const allowed = async () => {
        try {return current() && await stillAllowed.call(authority) === true && current();} catch {return false;}
      };
      const versionOwner = this.dependencies.versions, storageOwner = this.dependencies.artifacts;
      if (types.isProxy(versionOwner) || types.isProxy(storageOwner)) return unavailable;
      const readVersion = versionOwner.execute.bind(versionOwner), retrieve = storageOwner.retrieveArtifact.bind(storageOwner);
      const selection = Object.freeze({workspaceId: input.workspaceId, versionId: input.dataset.versionId});
      const captureVersion = (value: unknown) => {
        const version = normalizeDatasetVersionRecord(copyHeadlessModelWorkflowData(value) as DatasetVersionRecord);
        if (version.organizationId !== context.organizationId || version.workspaceId !== context.workspaceId ||
            version.datasetId !== input.dataset.datasetId || version.versionId !== input.dataset.versionId) throw new Error("Private training selection is unavailable.");
        return freeze(version);
      };
      if (!await allowed() || !current()) return forbidden;
      const observed = await readVersion(selection, context);
      if (!current()) return forbidden;
      const version = observed ? captureVersion(observed) : undefined;
      if (!await allowed() || !current()) return forbidden;
      if (!version) return {ok: false, code: "headless.not-found"} as const;
      if (version.versionDigest !== input.dataset.versionDigest) return stale;
      const selected = selectedArtifacts(version);
      const recipe = version.lineage.recipe;
      if (selected.some(row => row.artifact.artifactKey === recipe.artifactKey)) return unavailable;
      const recipeEntries = version.artifacts.filter(row => row.role === "recipe");
      const recordedRecipe = recipeEntries[0];
      if (recipeEntries.length !== 1 || !recordedRecipe || recordedRecipe.artifactKey !== recipe.artifactKey ||
          recordedRecipe.digest !== recipe.digest || recordedRecipe.mediaType !== "application/json" ||
          !Number.isSafeInteger(recordedRecipe.sizeBytes) || recordedRecipe.sizeBytes < 1 || recordedRecipe.sizeBytes > recipeLimit ||
          selected.reduce((total, row) => total + row.artifact.sizeBytes, recordedRecipe.sizeBytes) > aggregateLimit) return unavailable;
      const readBytes = async (artifact: DatasetVersionArtifact, limit: number) => {
        if (!await allowed() || !current()) return forbidden;
        const reply = await retrieve(createRetrieveArtifactRequest(artifact.artifactKey, {maximumBytes: Math.min(limit, artifact.sizeBytes)}), context);
        if (!current()) return forbidden;
        const result = record(reply, ["ok", "value", "error", "requestId", "correlationId"]);
        if (result.ok !== true) return unavailable;
        const value = record(result.value, ["descriptor", "content"]);
        const descriptor = record(value.descriptor, ["key", "mediaType", "sizeBytes", "checksum", "metadata"]);
        if (descriptor.key !== artifact.artifactKey || (descriptor.mediaType !== undefined && descriptor.mediaType !== artifact.mediaType) ||
            (descriptor.sizeBytes !== undefined && descriptor.sizeBytes !== artifact.sizeBytes)) return unavailable;
        const content = bytes(value.content, limit);
        if (content.byteLength !== artifact.sizeBytes || digest(content) !== artifact.digest) return unavailable;
        if (!await allowed() || !current()) return forbidden;
        return {ok: true, content} as const;
      };
      const contents: {readonly role: "train" | "validation"; readonly artifact: DatasetVersionArtifact; readonly content: Uint8Array}[] = [];
      for (const selectedArtifact of selected) {
        const result = await readBytes(selectedArtifact.artifact, RETRIEVE_ARTIFACT_MAXIMUM_BYTES);
        if (!current()) return forbidden;
        if (!result.ok) return result;
        contents.push(Object.freeze({...selectedArtifact, content: result.content}));
      }
      const savedRecipe = await readBytes(recordedRecipe, recipeLimit);
      if (!current()) return forbidden;
      if (!savedRecipe.ok) return savedRecipe;
      if (!await allowed() || !current()) return forbidden;
      const latest = await readVersion(selection, context);
      if (!current()) return forbidden;
      const finalVersion = latest ? captureVersion(latest) : undefined;
      if (!await allowed() || !current()) return forbidden;
      if (!finalVersion || !isDeepStrictEqual(finalVersion, version)) return stale;
      // Bytes are detached from storage and remain PRIVATE execution inputs.
      // Do not freeze typed arrays, which are intrinsically mutable. The caller
      // owns these copies and must not treat their digest as later file proof.
      return {ok: true, prepared: Object.freeze({request, version, contents: Object.freeze(contents),
        recipe: Object.freeze({artifact: recordedRecipe, content: savedRecipe.content}),
        verification: Object.freeze({datasetBytes: "copied-and-verified" as const, recipeBytes: "copied-and-verified" as const,
          modelBytes: "not-checked" as const, trainingCompatibility: "not-checked" as const, runtimeReadiness: "not-checked" as const,
          resourceAdmission: "not-checked" as const, licenseRights: "not-checked" as const, quality: "not-checked" as const}),
        trainingApproval: "required" as const, resultSaveApproval: "required" as const})} as const;
    } catch {return current() ? unavailable : forbidden;}
  }
}
