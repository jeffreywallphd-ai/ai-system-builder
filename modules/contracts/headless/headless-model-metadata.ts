import {MODEL_ARTIFACT_FORMS, MODEL_LIFECYCLE_STATUSES, MODEL_SERIALIZATION_FORMATS, MODEL_SOURCES, MODEL_TASK_TAGS,
  type ModelArtifactForm, type ModelLifecycleStatus, type ModelSerializationFormat, type ModelSource, type ModelTaskTag} from "../../domain/model";
import {MODEL_BROWSE_PROVIDERS, MODEL_INFERENCE_MODES, type ModelBrowseProvider, type ModelInferenceMode} from "../model";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../shared";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";

export const HEADLESS_MODEL_METADATA_LIMIT = 32;
export const HEADLESS_MODEL_READ_OPERATIONS = Object.freeze(["models.inventory", "models.record"] as const);
type Target = {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId};
export type HeadlessModelMetadataRequest =
  | {readonly version: typeof HEADLESS_CONTRACT_VERSION; readonly operation: "models.inventory";
      readonly input: Target & {readonly limit?: number; readonly cursor?: string}}
  | {readonly version: typeof HEADLESS_CONTRACT_VERSION; readonly operation: "models.record";
      readonly input: Target & {readonly modelRecordId: string}};
export interface HeadlessRecordedModelSummary {
  readonly modelRecordId: string;
  readonly updatedAt: string;
  readonly source: ModelSource;
  readonly lifecycleStatus: ModelLifecycleStatus;
  readonly artifactForm: ModelArtifactForm;
  readonly provider: ModelBrowseProvider;
  readonly modelId?: string;
  readonly inferenceMode?: ModelInferenceMode;
  readonly serializationFormat?: ModelSerializationFormat;
  readonly taskTags: readonly ModelTaskTag[];
  readonly sizeBytes?: number;
  readonly parameterCount?: number;
}
export interface HeadlessModelInventory {
  readonly workspaceId: WorkspaceId;
  readonly models: readonly HeadlessRecordedModelSummary[];
  readonly nextCursor?: string;
  readonly runtimeReadiness: "not-checked";
  readonly supplyVerification: "not-checked";
}
export interface HeadlessModelRecord {
  readonly workspaceId: WorkspaceId;
  readonly model: HeadlessRecordedModelSummary;
  readonly runtimeReadiness: "not-checked";
  readonly supplyVerification: "not-checked";
}
const invalid = {ok: false, code: "headless.invalid-request"} as const;
export const isHeadlessModelReadOperation = (value: unknown): value is HeadlessModelMetadataRequest["operation"] =>
  HEADLESS_MODEL_READ_OPERATIONS.some(operation => operation === value);
export const isHeadlessModelRecordId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/.test(value) && !value.includes("..") && !hasKnownPassiveCredential(value);
function timestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
export {timestamp as isHeadlessModelTimestamp};
function oneOf<T extends readonly string[]>(value: unknown, options: T): value is T[number] {
  return typeof value === "string" && options.some(option => option === value);
}
function record(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  const result = readStrictPassiveRecord(value, [...required, ...optional]);
  if (required.some(name => !Object.prototype.hasOwnProperty.call(result, name))) throw new Error("Incomplete model metadata.");
  return result;
}
export function readHeadlessModelMetadataRequest(value: unknown, currentHost: HeadlessHostIncarnationId) {
  try {
    const outer = record(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || !isHeadlessModelReadOperation(outer.operation)) return invalid;
    const input = record(outer.input, ["hostIncarnationId", "workspaceId", ...(outer.operation === "models.record" ? ["modelRecordId"] : [])],
      outer.operation === "models.inventory" ? ["limit", "cursor"] : []);
    if (!isHeadlessHostIncarnationId(currentHost) || !isHeadlessHostIncarnationId(input.hostIncarnationId) || !isWorkspaceId(input.workspaceId)) return invalid;
    if (input.hostIncarnationId !== currentHost) return {ok: false, code: "headless.host-changed"} as const;
    const target = {hostIncarnationId: currentHost, workspaceId: input.workspaceId};
    if (outer.operation === "models.record") {
      if (!isHeadlessModelRecordId(input.modelRecordId)) return invalid;
      return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: outer.operation,
        input: {...target, modelRecordId: input.modelRecordId}} satisfies HeadlessModelMetadataRequest} as const;
    }
    if (("limit" in input && (!Number.isSafeInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > HEADLESS_MODEL_METADATA_LIMIT)) ||
        ("cursor" in input && !isHeadlessModelRecordId(input.cursor))) return invalid;
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: outer.operation, input: {...target,
      ...("limit" in input ? {limit: input.limit as number} : {}), ...("cursor" in input ? {cursor: input.cursor as string} : {})}} satisfies HeadlessModelMetadataRequest} as const;
  } catch {return invalid;}
}

function summary(value: unknown): HeadlessRecordedModelSummary | undefined {
  const model = record(value, ["modelRecordId", "updatedAt", "source", "lifecycleStatus", "artifactForm", "provider", "taskTags"],
    ["modelId", "inferenceMode", "serializationFormat", "sizeBytes", "parameterCount"]);
  if (!isHeadlessModelRecordId(model.modelRecordId) || !timestamp(model.updatedAt) || !oneOf(model.source, MODEL_SOURCES) ||
      !oneOf(model.lifecycleStatus, MODEL_LIFECYCLE_STATUSES) || !oneOf(model.artifactForm, MODEL_ARTIFACT_FORMS) ||
      !oneOf(model.provider, MODEL_BROWSE_PROVIDERS) || !Array.isArray(model.taskTags) || model.taskTags.length > MODEL_TASK_TAGS.length ||
      new Set(model.taskTags).size !== model.taskTags.length || model.taskTags.some(tag => !oneOf(tag, MODEL_TASK_TAGS)) ||
      ("modelId" in model && (typeof model.modelId !== "string" || !/^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(model.modelId) || model.modelId.includes("..") || hasKnownPassiveCredential(model.modelId))) ||
      ("inferenceMode" in model && !oneOf(model.inferenceMode, MODEL_INFERENCE_MODES)) ||
      ("serializationFormat" in model && !oneOf(model.serializationFormat, MODEL_SERIALIZATION_FORMATS)) ||
      ("sizeBytes" in model && (!Number.isSafeInteger(model.sizeBytes) || (model.sizeBytes as number) < 0)) ||
      ("parameterCount" in model && (!Number.isSafeInteger(model.parameterCount) || (model.parameterCount as number) < 1))) return;
  return model as unknown as HeadlessRecordedModelSummary;
}
export function readHeadlessModelInventory(value: unknown, target: Extract<HeadlessModelMetadataRequest, {operation: "models.inventory"}>["input"]): HeadlessModelInventory | undefined {
  try {
    const raw = record(copyBoundedPassiveData(value), ["workspaceId", "models", "runtimeReadiness", "supplyVerification"], ["nextCursor"]);
    if (raw.workspaceId !== target.workspaceId || raw.runtimeReadiness !== "not-checked" || raw.supplyVerification !== "not-checked" ||
        !Array.isArray(raw.models) || raw.models.length > (target.limit ?? HEADLESS_MODEL_METADATA_LIMIT) ||
        ("nextCursor" in raw && (!isHeadlessModelRecordId(raw.nextCursor) || raw.models.length !== (target.limit ?? HEADLESS_MODEL_METADATA_LIMIT)))) return;
    const models = raw.models.map(summary);
    if (models.some(model => !model) || new Set(models.map(model => model!.modelRecordId)).size !== models.length ||
        (raw.nextCursor !== undefined && (raw.nextCursor === target.cursor || models.some(model => model!.modelRecordId === raw.nextCursor)))) return;
    return {workspaceId: target.workspaceId, models: models as HeadlessRecordedModelSummary[],
      ...(raw.nextCursor === undefined ? {} : {nextCursor: raw.nextCursor as string}), runtimeReadiness: "not-checked", supplyVerification: "not-checked"};
  } catch {return;}
}
export function readHeadlessModelRecord(value: unknown, target: Extract<HeadlessModelMetadataRequest, {operation: "models.record"}>["input"]): HeadlessModelRecord | undefined {
  try {
    const raw = record(copyBoundedPassiveData(value), ["workspaceId", "model", "runtimeReadiness", "supplyVerification"]);
    if (raw.workspaceId !== target.workspaceId || raw.runtimeReadiness !== "not-checked" || raw.supplyVerification !== "not-checked") return;
    const model = summary(raw.model);
    return model?.modelRecordId === target.modelRecordId ? {workspaceId: target.workspaceId, model,
      runtimeReadiness: "not-checked", supplyVerification: "not-checked"} : undefined;
  } catch {return;}
}
