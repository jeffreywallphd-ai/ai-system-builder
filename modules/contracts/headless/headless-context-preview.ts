import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord as readPassiveRecord} from "../shared";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {normalizeDatasetId, normalizeDatasetVersionId} from "../dataset";
import {normalizeIngestionTaskId, normalizeIngestionTaskFileId, normalizeIngestionSha256Digest} from "../ingestion";
import {normalizeContextSaveName, normalizeContextSourceChecks, type ContextSourceCheckSettings} from "../context-management";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";

export const HEADLESS_CONTEXT_MAX_SOURCES = 4;
export const HEADLESS_CONTEXT_MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export const HEADLESS_CONTEXT_MAX_MODELS = 32;
export type HeadlessContextSource =
  | {readonly kind: "ingestion-file"; readonly taskId: string; readonly fileId: string; readonly taskRevision: number}
  | {readonly kind: "dataset-version"; readonly datasetId: string; readonly versionId: string; readonly versionDigest: string;
      readonly role: "dataset" | "train" | "validation" | "test"};
type ChunkSettings = {readonly chunkCharacters: number; readonly overlapCharacters: number; readonly maximumChunks: number;
  readonly textFields: readonly string[]};
export type HeadlessContextSettings = ChunkSettings & (
  | {readonly kind: "markdown-context-pack"; readonly cleaningPreset: "standard" | "strict"}
  | {readonly kind: "rag-database"; readonly modelRecordId: string; readonly modelUpdatedAt: string;
      readonly batchSize: number; readonly device: "cpu" | "cuda"; readonly sourceChecks: ContextSourceCheckSettings});
type Target = {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId};
export type HeadlessContextReadRequest =
  | {readonly version: typeof HEADLESS_CONTRACT_VERSION; readonly operation: "context.models"; readonly input: Target}
  | {readonly version: typeof HEADLESS_CONTRACT_VERSION; readonly operation: "context.preview-generation";
      readonly input: Target & {readonly name: string; readonly sources: readonly HeadlessContextSource[]; readonly settings: HeadlessContextSettings}};
export type HeadlessContextModel = {readonly modelRecordId: string; readonly updatedAt: string;
  readonly lifecycleStatus: "remote-reference" | "saved-reference" | "downloaded" | "generated" | "validated" | "invalid";
  readonly embeddings: boolean; readonly textGeneration: boolean; readonly runtimeReadiness: "not-checked"};
export type HeadlessContextModels = {readonly workspaceId: WorkspaceId; readonly models: readonly HeadlessContextModel[];
  readonly truncated: boolean; readonly runtimeReadiness: "not-checked"};
export type HeadlessContextPreview = {readonly workspaceId: WorkspaceId; readonly name: string;
  readonly sources: readonly {readonly reference: HeadlessContextSource; readonly digest: string; readonly sizeBytes: number;
    readonly format: string; readonly licenseStatus: "recorded" | "unknown"}[];
  readonly settings: HeadlessContextSettings; readonly totalBytes: number; readonly runtimeReadiness: "not-checked";
  readonly approvalRequired: true; readonly reviewRequired: true; readonly modelCalls: 0; readonly externalProviderCalls: 0};
const invalid = {ok: false, code: "headless.invalid-request"} as const;
function readStrictPassiveRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const record = readPassiveRecord(value, [...required, ...optional]);
  if (required.some(key => !Object.prototype.hasOwnProperty.call(record, key))) throw new Error("Incomplete Context metadata.");
  return record;
}
export const isHeadlessContextReadOperation = (value: unknown): value is HeadlessContextReadRequest["operation"] =>
  value === "context.models" || value === "context.preview-generation";
export function isHeadlessContextModelId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/.test(value) &&
    !value.includes("..") && !hasKnownPassiveCredential(value);
}
export function isHeadlessContextTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function id(value: unknown, normalize: (value: string) => string): string {
  if (typeof value !== "string" || hasKnownPassiveCredential(value) || normalize(value) !== value) throw new Error("Invalid Context reference.");
  return value;
}
export function readHeadlessContextSource(value: unknown): HeadlessContextSource {
  const raw = readStrictPassiveRecord(value, ["kind"], ["taskId", "fileId", "taskRevision", "datasetId", "versionId", "versionDigest", "role"]);
  if (raw.kind === "ingestion-file") {
    const source = readStrictPassiveRecord(value, ["kind", "taskId", "fileId", "taskRevision"]);
    if (!Number.isSafeInteger(source.taskRevision) || (source.taskRevision as number) < 1) throw new Error("Invalid Context revision.");
    return {kind: "ingestion-file", taskId: id(source.taskId, normalizeIngestionTaskId), fileId: id(source.fileId, normalizeIngestionTaskFileId),
      taskRevision: source.taskRevision as number};
  }
  const source = readStrictPassiveRecord(value, ["kind", "datasetId", "versionId", "versionDigest", "role"]);
  if (source.kind !== "dataset-version" || !["dataset", "train", "validation", "test"].includes(source.role as string)) throw new Error("Invalid Context version.");
  return {kind: "dataset-version", datasetId: id(source.datasetId, normalizeDatasetId), versionId: id(source.versionId, normalizeDatasetVersionId),
    versionDigest: id(source.versionDigest, normalizeIngestionSha256Digest), role: source.role as "dataset" | "train" | "validation" | "test"};
}
export function readHeadlessContextSettings(value: unknown): HeadlessContextSettings {
  const fields = ["kind", "chunkCharacters", "overlapCharacters", "maximumChunks", "textFields"];
  const raw = readStrictPassiveRecord(value, fields, ["cleaningPreset", "modelRecordId", "modelUpdatedAt", "batchSize", "device", "sourceChecks"]);
  if (!Number.isSafeInteger(raw.chunkCharacters) || (raw.chunkCharacters as number) < 64 || (raw.chunkCharacters as number) > 32000 ||
      !Number.isSafeInteger(raw.overlapCharacters) || (raw.overlapCharacters as number) < 0 || (raw.overlapCharacters as number) > 8000 ||
      (raw.overlapCharacters as number) >= (raw.chunkCharacters as number) || !Number.isSafeInteger(raw.maximumChunks) ||
      (raw.maximumChunks as number) < 1 || (raw.maximumChunks as number) > 1000 || !Array.isArray(raw.textFields) || raw.textFields.length > 32 ||
      new Set(raw.textFields).size !== raw.textFields.length || raw.textFields.some(field => typeof field !== "string" ||
        !/^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(field) || hasKnownPassiveCredential(field))) throw new Error("Invalid Context chunk settings.");
  const chunk = {chunkCharacters: raw.chunkCharacters as number, overlapCharacters: raw.overlapCharacters as number,
    maximumChunks: raw.maximumChunks as number, textFields: [...raw.textFields] as string[]};
  if (raw.kind === "markdown-context-pack") {
    readStrictPassiveRecord(value, [...fields, "cleaningPreset"]);
    if (raw.cleaningPreset !== "standard" && raw.cleaningPreset !== "strict") throw new Error("Invalid Context cleaning preset.");
    return {...chunk, kind: raw.kind, cleaningPreset: raw.cleaningPreset};
  }
  readStrictPassiveRecord(value, [...fields, "modelRecordId", "modelUpdatedAt", "batchSize", "device", "sourceChecks"]);
  if (raw.kind !== "rag-database" || !isHeadlessContextModelId(raw.modelRecordId) || !isHeadlessContextTimestamp(raw.modelUpdatedAt) ||
      !Number.isSafeInteger(raw.batchSize) || (raw.batchSize as number) < 1 || (raw.batchSize as number) > 32 ||
      (raw.device !== "cpu" && raw.device !== "cuda")) throw new Error("Invalid Context model settings.");
  const checks = readStrictPassiveRecord(raw.sourceChecks, ["preset", "allowedLanguages", "requireLicenseMetadata", "requireConsentMetadata", "includeSourceAttribution"]);
  if (!Array.isArray(checks.allowedLanguages) || checks.allowedLanguages.some(item => typeof item !== "string")) throw new Error("Invalid Context languages.");
  const sourceChecks = normalizeContextSourceChecks(checks as unknown as ContextSourceCheckSettings);
  if (JSON.stringify(sourceChecks) !== JSON.stringify({preset: checks.preset, allowedLanguages: checks.allowedLanguages,
    requireLicenseMetadata: checks.requireLicenseMetadata, requireConsentMetadata: checks.requireConsentMetadata,
    includeSourceAttribution: checks.includeSourceAttribution})) throw new Error("Non-canonical Context source checks.");
  return {...chunk, kind: raw.kind, modelRecordId: raw.modelRecordId, modelUpdatedAt: raw.modelUpdatedAt,
    batchSize: raw.batchSize as number, device: raw.device, sourceChecks};
}
export function readHeadlessContextReadRequest(value: unknown, currentHost: HeadlessHostIncarnationId):
  {readonly ok: true; readonly request: HeadlessContextReadRequest} | typeof invalid | {readonly ok: false; readonly code: "headless.host-changed"} {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (raw.version !== HEADLESS_CONTRACT_VERSION || !isHeadlessContextReadOperation(raw.operation)) return invalid;
    const input = readStrictPassiveRecord(raw.input, raw.operation === "context.models" ? ["hostIncarnationId", "workspaceId"]
      : ["hostIncarnationId", "workspaceId", "name", "sources", "settings"]);
    if (!isHeadlessHostIncarnationId(currentHost) || !isHeadlessHostIncarnationId(input.hostIncarnationId) || !isWorkspaceId(input.workspaceId)) return invalid;
    if (input.hostIncarnationId !== currentHost) return {ok: false, code: "headless.host-changed"};
    const target = {hostIncarnationId: currentHost, workspaceId: input.workspaceId};
    if (raw.operation === "context.models") return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: raw.operation, input: target}};
    if (typeof input.name !== "string" || hasKnownPassiveCredential(input.name) || normalizeContextSaveName(input.name) !== input.name ||
        !Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > HEADLESS_CONTEXT_MAX_SOURCES) return invalid;
    const sources = input.sources.map(readHeadlessContextSource);
    if (new Set(sources.map(source => JSON.stringify(source))).size !== sources.length) return invalid;
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: raw.operation,
      input: {...target, name: input.name, sources, settings: readHeadlessContextSettings(input.settings)}}};
  } catch {return invalid;}
}

/** Reconstruct the finite metadata surface even when a host adapter returns extra private data. */
export function readHeadlessContextModels(value: unknown, workspaceId: WorkspaceId): HeadlessContextModels | undefined {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["workspaceId", "models", "truncated", "runtimeReadiness"]);
    if (raw.workspaceId !== workspaceId || !Array.isArray(raw.models) || raw.models.length > HEADLESS_CONTEXT_MAX_MODELS ||
        typeof raw.truncated !== "boolean" || raw.runtimeReadiness !== "not-checked") return;
    const models = raw.models.map(item => {
      const model = readStrictPassiveRecord(item, ["modelRecordId", "updatedAt", "lifecycleStatus", "embeddings", "textGeneration", "runtimeReadiness"]);
      if (!isHeadlessContextModelId(model.modelRecordId) || !isHeadlessContextTimestamp(model.updatedAt) ||
          !["remote-reference", "saved-reference", "downloaded", "generated", "validated", "invalid"].includes(model.lifecycleStatus as string) ||
          typeof model.embeddings !== "boolean" || typeof model.textGeneration !== "boolean" || model.runtimeReadiness !== "not-checked") throw new Error("Invalid model preview.");
      return model as unknown as HeadlessContextModel;
    });
    if (new Set(models.map(model => model.modelRecordId)).size !== models.length) return;
    return {workspaceId, models, truncated: raw.truncated, runtimeReadiness: "not-checked"};
  } catch {return;}
}
export function readHeadlessContextPreview(value: unknown, target: Extract<HeadlessContextReadRequest, {operation: "context.preview-generation"}>["input"]): HeadlessContextPreview | undefined {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["workspaceId", "name", "sources", "settings", "totalBytes",
      "runtimeReadiness", "approvalRequired", "reviewRequired", "modelCalls", "externalProviderCalls"]);
    if (raw.workspaceId !== target.workspaceId || raw.name !== target.name || raw.runtimeReadiness !== "not-checked" ||
        raw.approvalRequired !== true || raw.reviewRequired !== true || raw.modelCalls !== 0 || raw.externalProviderCalls !== 0 ||
        !Array.isArray(raw.sources) || raw.sources.length !== target.sources.length || raw.sources.length < 1 || raw.sources.length > HEADLESS_CONTEXT_MAX_SOURCES) return;
    const settings = readHeadlessContextSettings(raw.settings);
    if (JSON.stringify(settings) !== JSON.stringify(readHeadlessContextSettings(target.settings))) return;
    const sources = raw.sources.map((item, index) => {
      const source = readStrictPassiveRecord(item, ["reference", "digest", "sizeBytes", "format", "licenseStatus"]);
      const reference = readHeadlessContextSource(source.reference);
      if (JSON.stringify(reference) !== JSON.stringify(readHeadlessContextSource(target.sources[index])) ||
          !Number.isSafeInteger(source.sizeBytes) || (source.sizeBytes as number) < 1 || (source.sizeBytes as number) > HEADLESS_CONTEXT_MAX_SOURCE_BYTES ||
          !["csv", "json", "jsonl", "parquet", "text", "markdown", "html", "pdf", "docx"].includes(source.format as string) ||
          (source.licenseStatus !== "recorded" && source.licenseStatus !== "unknown")) throw new Error("Invalid Context source preview.");
      return {reference, digest: id(source.digest, normalizeIngestionSha256Digest), sizeBytes: source.sizeBytes as number,
        format: source.format as string, licenseStatus: source.licenseStatus as "recorded" | "unknown"};
    });
    const totalBytes = sources.reduce((sum, source) => sum + source.sizeBytes, 0);
    if (raw.totalBytes !== totalBytes || totalBytes > HEADLESS_CONTEXT_MAX_SOURCES * HEADLESS_CONTEXT_MAX_SOURCE_BYTES) return;
    return {workspaceId: target.workspaceId, name: target.name, sources, settings, totalBytes, runtimeReadiness: "not-checked",
      approvalRequired: true, reviewRequired: true, modelCalls: 0, externalProviderCalls: 0};
  } catch {return;}
}
