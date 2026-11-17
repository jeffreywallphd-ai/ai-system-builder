import {normalizeIngestionTaskId, normalizeIngestionTaskFileId, normalizeIngestionSourceSnapshotId, normalizeIngestionSha256Digest,
  type IngestionTaskId, type IngestionTaskFileId} from "../ingestion";
import {DATASET_PREPARATION_SOURCE_CAPABILITIES} from "../runtime/dataset-preparation-capabilities";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../shared";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";

export const HEADLESS_DATASET_MAX_SOURCES = 4;
export const HEADLESS_DATASET_MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export const HEADLESS_DATASET_MAX_TOTAL_BYTES = HEADLESS_DATASET_MAX_SOURCES * HEADLESS_DATASET_MAX_SOURCE_BYTES;
export const HEADLESS_DATASET_MAX_ROWS_PER_SOURCE = 1_000;
export interface HeadlessDatasetSourceReference {
  readonly taskId: IngestionTaskId;
  readonly fileId: IngestionTaskFileId;
  readonly taskRevision: number;
}
export interface HeadlessDatasetPreparationRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "data.preview-dataset-preparation";
  readonly input: {
    readonly hostIncarnationId: HeadlessHostIncarnationId;
    readonly workspaceId: WorkspaceId;
    readonly sources: readonly HeadlessDatasetSourceReference[];
    readonly recipe: {readonly kind: "provided-instruction-rows-v1"; readonly inputColumn: string; readonly outputColumn: string};
    readonly split: {readonly trainRatio: number; readonly validationRatio: number; readonly testRatio: number; readonly seed: number};
    readonly qualityPreset: "recommended" | "strict";
  };
}

export interface HeadlessDatasetPreparationPreview {
  readonly workspaceId: WorkspaceId;
  readonly sources: readonly (HeadlessDatasetSourceReference & {
    readonly sourceSnapshotId: string; readonly format: string; readonly sizeBytes: number; readonly digest: string;
    readonly licenseStatus: "unknown";
  })[];
  readonly recipe: HeadlessDatasetPreparationRequest["input"]["recipe"];
  readonly split: HeadlessDatasetPreparationRequest["input"]["split"];
  readonly qualityPreset: HeadlessDatasetPreparationRequest["input"]["qualityPreset"];
  readonly totalBytes: number;
  readonly maximumRowsPerSource: typeof HEADLESS_DATASET_MAX_ROWS_PER_SOURCE;
  readonly outputFormat: "jsonl";
  readonly reviewRequired: true;
  readonly externalProviderCalls: 0;
  readonly modelCalls: 0;
}

/** Reconstruct only matching public metadata; the private compiled command never crosses this seam. */
export function readHeadlessDatasetPreparationPreview(value: unknown, target: HeadlessDatasetPreparationRequest["input"]): HeadlessDatasetPreparationPreview | undefined {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["workspaceId", "sources", "recipe", "split", "qualityPreset",
      "totalBytes", "maximumRowsPerSource", "outputFormat", "reviewRequired", "externalProviderCalls", "modelCalls"]);
    if (raw.workspaceId !== target.workspaceId || raw.qualityPreset !== target.qualityPreset ||
        raw.maximumRowsPerSource !== HEADLESS_DATASET_MAX_ROWS_PER_SOURCE || raw.outputFormat !== "jsonl" || raw.reviewRequired !== true ||
        raw.externalProviderCalls !== 0 || raw.modelCalls !== 0 || !Array.isArray(raw.sources) ||
        target.sources.length < 1 || target.sources.length > HEADLESS_DATASET_MAX_SOURCES || raw.sources.length !== target.sources.length ||
        new Set(target.sources.map(source => JSON.stringify([source.taskId, source.fileId]))).size !== target.sources.length) return;
    const recipe = readStrictPassiveRecord(raw.recipe, ["kind", "inputColumn", "outputColumn"]);
    const split = readStrictPassiveRecord(raw.split, ["trainRatio", "validationRatio", "testRatio", "seed"]);
    if (recipe.kind !== target.recipe.kind || recipe.inputColumn !== target.recipe.inputColumn || recipe.outputColumn !== target.recipe.outputColumn ||
        split.trainRatio !== target.split.trainRatio || split.validationRatio !== target.split.validationRatio ||
        split.testRatio !== target.split.testRatio || split.seed !== target.split.seed) return;
    const sources = raw.sources.map((entry, index) => {
      const source = readStrictPassiveRecord(entry, ["taskId", "fileId", "taskRevision", "sourceSnapshotId", "format", "sizeBytes", "digest", "licenseStatus"]);
      const exact = target.sources[index];
      if (source.taskId !== exact.taskId || source.fileId !== exact.fileId || source.taskRevision !== exact.taskRevision ||
          source.licenseStatus !== "unknown" || typeof source.sizeBytes !== "number" || !Number.isSafeInteger(source.sizeBytes) ||
          source.sizeBytes < 1 || source.sizeBytes > HEADLESS_DATASET_MAX_SOURCE_BYTES ||
          !DATASET_PREPARATION_SOURCE_CAPABILITIES.some(item => item.kind === "structured" && item.format === source.format) ||
          typeof source.digest !== "string" || normalizeIngestionSha256Digest(source.digest) !== source.digest) throw new Error("Invalid source preview.");
      return {...exact, sourceSnapshotId: exactId(source.sourceSnapshotId, normalizeIngestionSourceSnapshotId),
        format: source.format as string, sizeBytes: source.sizeBytes, digest: source.digest, licenseStatus: "unknown" as const};
    });
    const totalBytes = sources.reduce((sum, source) => sum + source.sizeBytes, 0);
    if (raw.totalBytes !== totalBytes || totalBytes > HEADLESS_DATASET_MAX_TOTAL_BYTES ||
        new Set(sources.map(source => source.sourceSnapshotId)).size !== sources.length) return;
    return {workspaceId: target.workspaceId, sources, recipe: {...target.recipe}, split: {...target.split}, qualityPreset: target.qualityPreset,
      totalBytes, maximumRowsPerSource: HEADLESS_DATASET_MAX_ROWS_PER_SOURCE, outputFormat: "jsonl", reviewRequired: true,
      externalProviderCalls: 0, modelCalls: 0};
  } catch {return undefined;}
}

const invalid = {ok: false, code: "headless.invalid-request"} as const;
function exactId<T extends string>(value: unknown, normalize: (value: string) => T): T {
  if (typeof value !== "string" || hasKnownPassiveCredential(value) || normalize(value) !== value) throw new Error("Invalid source reference.");
  return normalize(value);
}
function column(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && value === value.trim() &&
    /^[A-Za-z_][A-Za-z0-9_. -]*$/.test(value) && !hasKnownPassiveCredential(value);
}

/** A passive preview request. Host authorization is separate; no runtime or mutation authority is granted. */
export function readHeadlessDatasetPreparationRequest(value: unknown, currentHost: HeadlessHostIncarnationId):
  {readonly ok: true; readonly request: HeadlessDatasetPreparationRequest} | typeof invalid |
  {readonly ok: false; readonly code: "headless.host-changed"} {
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "data.preview-dataset-preparation") return invalid;
    const raw = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "sources", "recipe", "split", "qualityPreset"]);
    const {hostIncarnationId, workspaceId, qualityPreset} = raw;
    if (!isHeadlessHostIncarnationId(currentHost) || !isHeadlessHostIncarnationId(hostIncarnationId) || !isWorkspaceId(workspaceId) ||
        (qualityPreset !== "recommended" && qualityPreset !== "strict") || !Array.isArray(raw.sources) ||
        raw.sources.length < 1 || raw.sources.length > HEADLESS_DATASET_MAX_SOURCES) return invalid;
    const sources = raw.sources.map(value => {
      const item = readStrictPassiveRecord(value, ["taskId", "fileId", "taskRevision"]);
      if (typeof item.taskRevision !== "number" || !Number.isSafeInteger(item.taskRevision) || item.taskRevision < 1) throw new Error("Invalid source revision.");
      return {taskId: exactId(item.taskId, normalizeIngestionTaskId), fileId: exactId(item.fileId, normalizeIngestionTaskFileId), taskRevision: item.taskRevision};
    });
    if (new Set(sources.map(source => JSON.stringify([source.taskId, source.fileId]))).size !== sources.length) return invalid;
    const recipe = readStrictPassiveRecord(raw.recipe, ["kind", "inputColumn", "outputColumn"]);
    if (recipe.kind !== "provided-instruction-rows-v1" || !column(recipe.inputColumn) || !column(recipe.outputColumn) ||
        recipe.inputColumn === recipe.outputColumn) return invalid;
    const split = readStrictPassiveRecord(raw.split, ["trainRatio", "validationRatio", "testRatio", "seed"]);
    const {trainRatio, validationRatio, testRatio, seed} = split;
    if (typeof trainRatio !== "number" || typeof validationRatio !== "number" || typeof testRatio !== "number" ||
        ![trainRatio, validationRatio, testRatio].every(value => value >= 0 && value <= 1 && Math.abs(value * 10_000 - Math.round(value * 10_000)) < 1e-8) ||
        trainRatio <= 0 || (validationRatio === 0 && testRatio === 0) || Math.abs(trainRatio + validationRatio + testRatio - 1) > 1e-8 ||
        typeof seed !== "number" || !Number.isSafeInteger(seed) || seed < 0 || seed > 2_147_483_647) return invalid;
    if (hostIncarnationId !== currentHost) return {ok: false, code: "headless.host-changed"};
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: "data.preview-dataset-preparation", input: {
      hostIncarnationId, workspaceId, sources,
      recipe: {kind: "provided-instruction-rows-v1", inputColumn: recipe.inputColumn, outputColumn: recipe.outputColumn},
      split: {trainRatio, validationRatio, testRatio, seed}, qualityPreset,
    }}};
  } catch {return invalid;}
}
