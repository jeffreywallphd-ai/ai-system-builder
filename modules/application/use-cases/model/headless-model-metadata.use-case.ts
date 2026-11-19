import {types} from "node:util";
import {MODEL_TASK_TAGS} from "../../../domain/model";
import type {ApplicationRequestContext} from "../../ports";
import type {ModelRegistryPort} from "../../ports/model";
import type {OrganizationId} from "../../../contracts/organization";
import {copyBoundedPassiveData, readStrictPassiveRecord} from "../../../contracts/shared";
import {HEADLESS_MODEL_METADATA_LIMIT, readHeadlessModelMetadataRequest, readHeadlessModelInventory, readHeadlessModelRecord,
  type HeadlessHostIncarnationId} from "../../../contracts/headless";

const forbidden = {ok: false, code: "headless.forbidden"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;
const notFound = {ok: false, code: "headless.not-found"} as const;
const fields = ["workspaceId", "modelRecordId", "createdAt", "updatedAt", "source", "lifecycleStatus", "artifactForm", "provider",
  "modelId", "inferenceMode", "serializationFormat", "taskTags", "sizeBytes", "parameterCount"] as const;

function ownData(value: unknown, name: string) {
  if (types.isProxy(value) || !value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Invalid recorded model data.");
  const field = Object.getOwnPropertyDescriptor(value, name);
  if (field && (!("value" in field) || !field.enumerable)) throw new Error("Invalid recorded model data.");
  if (types.isProxy(field?.value)) throw new Error("Invalid recorded model data.");
  return field?.value;
}

function copiedTags(value: unknown): string[] | undefined {
  if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > MODEL_TASK_TAGS.length || Reflect.ownKeys(value).length !== value.length + 1) return;
  const tags: string[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item?.enumerable || !("value" in item) || typeof item.value !== "string") return;
    tags.push(item.value);
  }
  return tags;
}

/** Node ingress rejects local Proxy objects before portable JSON codecs reflect. */
function preparedRequest(value: unknown) {
  if (types.isProxy(value)) throw new Error("Invalid model request.");
  const outer = readStrictPassiveRecord(value, ["version", "operation", "input"]);
  if (typeof outer.version !== "string" || typeof outer.operation !== "string" || types.isProxy(outer.input)) throw new Error("Invalid model request.");
  const input = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "modelRecordId", "limit", "cursor"]);
  if (Object.values(input).some(item => typeof item === "function" || typeof item === "object" && item !== null)) throw new Error("Invalid model request.");
  return {version: outer.version, operation: outer.operation, input};
}

/** Select recorded metadata without evaluating unselected private fields. */
function selectedModel(value: unknown) {
  if (types.isProxy(value) || !value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return;
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (descriptor && (!("value" in descriptor) || !descriptor.enumerable)) return;
    if (descriptor?.value !== undefined) {
      if (types.isProxy(descriptor.value)) return;
      if (field === "taskTags") {
        const tags = copiedTags(descriptor.value); if (!tags) return;
        picked[field] = tags;
      } else {
        if (typeof descriptor.value === "function" || typeof descriptor.value === "object" && descriptor.value !== null) return;
        picked[field] = descriptor.value;
      }
    }
  }
  const model = copyBoundedPassiveData(picked) as Record<string, unknown>;
  const {workspaceId, createdAt, updatedAt, ...summary} = model;
  const projected: Record<string, unknown> = {...summary, updatedAt: updatedAt ?? createdAt, taskTags: summary.taskTags ?? []};
  return {workspaceId, summary: projected};
}

/** Persisted-only reads. No runtime, provider, file discovery, task or write port. */
export class ReadHeadlessModelMetadataUseCase {
  constructor(private readonly dependencies: {readonly organizationId: OrganizationId;
    readonly models: Pick<ModelRegistryPort, "readRecordedModel" | "listModels">}) {}

  async execute(request: unknown, authority: {readonly hostIncarnationId: HeadlessHostIncarnationId;
    readonly context: ApplicationRequestContext; readonly stillAllowed: () => Promise<boolean>; readonly isCurrent: () => boolean}) {
    let prepared: unknown;
    try {prepared = preparedRequest(request);} catch {return {ok: false, code: "headless.invalid-request"} as const;}
    const parsed = readHeadlessModelMetadataRequest(prepared, authority.hostIncarnationId);
    if (!parsed.ok) return parsed;
    const {operation, input} = parsed.request;
    const context = authority.context;
    const organizationId = context.organizationId, principalId = context.principalId, workspaceId = context.workspaceId;
    if (!principalId || organizationId !== this.dependencies.organizationId || workspaceId !== input.workspaceId) return forbidden;
    const policy = authority.stillAllowed, isCurrent = authority.isCurrent;
    const sameActor = () => context.organizationId === organizationId && context.principalId === principalId && context.workspaceId === workspaceId;
    const current = () => {
      if (!sameActor()) return false;
      const result: unknown = isCurrent();
      // Deny an accidentally async fence while observing native rejection.
      // Do not await it or invoke an arbitrary thenable method.
      if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
      return result === true && sameActor();
    };
    const stillAllowed = async () => current() && await policy() === true && current();
    try {
      if (!await stillAllowed() || !current()) return forbidden;
      if (operation === "models.record") {
        if (!this.dependencies.models.readRecordedModel) return unavailable;
        const raw = await this.dependencies.models.readRecordedModel(input.workspaceId, input.modelRecordId);
        if (!await stillAllowed() || !current()) return forbidden;
        const selected = selectedModel(raw);
        if (!selected || selected.workspaceId !== input.workspaceId || selected.summary.modelRecordId !== input.modelRecordId) return notFound;
        const value = readHeadlessModelRecord({workspaceId: input.workspaceId, model: selected.summary,
          runtimeReadiness: "not-checked", supplyVerification: "not-checked"}, input);
        if (!await stillAllowed() || !current()) return forbidden;
        return value ? {ok: true, operation, value} as const : unavailable;
      }
      const listed = await this.dependencies.models.listModels({workspaceId: input.workspaceId, limit: input.limit ?? HEADLESS_MODEL_METADATA_LIMIT,
        ...(input.cursor === undefined ? {} : {cursor: input.cursor}), includeDiscovered: false, includeSharedStorage: false});
      if (!await stillAllowed() || !current()) return forbidden;
      const models = ownData(listed, "models"), nextCursor = ownData(listed, "nextCursor");
      if (types.isProxy(models) || !Array.isArray(models) || Object.getPrototypeOf(models) !== Array.prototype ||
          models.length > (input.limit ?? HEADLESS_MODEL_METADATA_LIMIT) || Reflect.ownKeys(models).length !== models.length + 1) return unavailable;
      if (nextCursor !== undefined && typeof nextCursor !== "string") return unavailable;
      const selected = [];
      for (let index = 0; index < models.length; index++) {
        const item = Object.getOwnPropertyDescriptor(models, String(index));
        if (!item || !("value" in item) || !item.enumerable) return unavailable;
        selected.push(selectedModel(item.value));
      }
      if (selected.some(model => !model || model.workspaceId !== input.workspaceId)) return unavailable;
      const value = readHeadlessModelInventory({workspaceId: input.workspaceId, models: selected.map(model => model!.summary),
        ...(nextCursor === undefined ? {} : {nextCursor}),
        runtimeReadiness: "not-checked", supplyVerification: "not-checked"}, input);
      if (!await stillAllowed() || !current()) return forbidden;
      return value ? {ok: true, operation, value} as const : unavailable;
    } catch {return unavailable;}
  }
}
