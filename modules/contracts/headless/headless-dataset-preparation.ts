import {normalizeIngestionTaskId, normalizeIngestionTaskFileId, type IngestionTaskId, type IngestionTaskFileId} from "../ingestion";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../shared";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-read-request";

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

const invalid = {ok: false, code: "headless.invalid-request"} as const;
function exactId<T extends string>(value: unknown, normalize: (value: string) => T): T {
  if (typeof value !== "string" || hasKnownPassiveCredential(value) || normalize(value) !== value) throw new Error("Invalid source reference.");
  return normalize(value);
}
function column(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && value === value.trim() &&
    /^[A-Za-z_][A-Za-z0-9_. -]*$/.test(value) && !hasKnownPassiveCredential(value);
}

/** A passive internal preview contract. It grants no runtime, mutation or transport authority. */
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
