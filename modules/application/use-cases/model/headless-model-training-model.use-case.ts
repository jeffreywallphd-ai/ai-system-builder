import {createHash} from "node:crypto";
import {isAbsolute} from "node:path";
import {isDeepStrictEqual, types} from "node:util";
import {isOrganizationId, type OrganizationId} from "../../../contracts/organization";
import {hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import {isDesktopHeadlessClientId, readHeadlessModelRecord, readHeadlessModelTrainingPlanRequest} from "../../../contracts/headless";
import type {ModelRegistryPort} from "../../ports/model";
import type {ReadHeadlessModelMetadataUseCase} from "./headless-model-metadata.use-case";
import type {PreviewHeadlessModelTrainingInputsUseCase} from "./headless-model-training-inputs.use-case";
import {copyHeadlessModelWorkflowData} from "./headless-model-download-preview.use-case";

type Authority = Parameters<PreviewHeadlessModelTrainingInputsUseCase["execute"]>[1];
const forbidden = {ok: false, code: "headless.forbidden"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;
const notFound = {ok: false, code: "headless.not-found"} as const;
const stale = {ok: false, code: "headless.stale"} as const;
const authorityKeys = ["hostIncarnationId", "context", "clientId", "isCurrent", "stillAllowed"];
const contextKeys = ["organizationId", "principalId", "workspaceId", "requestId", "correlationId"];
const modelFields = ["workspaceId", "modelRecordId", "createdAt", "updatedAt", "source", "lifecycleStatus",
  "artifactForm", "provider", "modelId", "inferenceMode", "serializationFormat", "taskTags", "sizeBytes", "parameterCount"];

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
}
function record(value: unknown, keys: readonly string[]) {
  if (types.isProxy(value)) throw new Error("The private model selection is unavailable.");
  return readStrictPassiveRecord(value, keys);
}
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || types.isProxy(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Invalid recorded model.");
  const own = Object.getOwnPropertyDescriptor(value, key);
  if (own && (!("value" in own) || !own.enumerable)) throw new Error("Invalid recorded model.");
  return own?.value;
}
function metadata(value: unknown, target: Parameters<typeof readHeadlessModelRecord>[1]) {
  const row = record(copyHeadlessModelWorkflowData(value), ["ok", "code", "operation", "value"]);
  if (row.ok === false && Object.keys(row).length === 2) {
    return row.code === "headless.forbidden" ? forbidden : row.code === "headless.not-found" ? notFound : unavailable;
  }
  if (row.ok !== true || Object.keys(row).length !== 3 || row.operation !== "models.record") return unavailable;
  const model = readHeadlessModelRecord(row.value, target);
  return model ? {ok: true, record: model} as const : unavailable;
}
function selected(value: unknown, target: Parameters<typeof readHeadlessModelRecord>[1]) {
  const picked: Record<string, unknown> = {};
  for (const name of modelFields) {const item = field(value, name); if (item !== undefined) picked[name] = item;}
  const local = field(value, "localPath");
  if (typeof local !== "string" || !isAbsolute(local) || local.length > 4096 || /^[\\/]{2}/.test(local) ||
      /[\x00-\x1f\x7f]/.test(local)) throw new Error("Invalid recorded model location.");
  // Never copy or evaluate unrelated private metadata, display labels or paths.
  const copied = record(copyHeadlessModelWorkflowData(picked), modelFields);
  const {workspaceId, createdAt, updatedAt, ...summary} = copied;
  const model = readHeadlessModelRecord({workspaceId, model: {...summary, updatedAt: updatedAt ?? createdAt,
    taskTags: summary.taskTags ?? []}, runtimeReadiness: "not-checked", supplyVerification: "not-checked"}, target);
  if (!model || model.model.artifactForm !== "full-model" || model.model.serializationFormat !== "safetensors" ||
      model.model.inferenceMode !== "causal") throw new Error("Unsupported recorded training model.");
  return freeze({model: model.model, localModelReference: local});
}

/** Private persisted selection only. The caller must compose the original
 * ModelRead policy; ModelWrite is not a read grant. No file, runtime, provider,
 * discovery or write port is present. Never serialize this result to a tool.
 * A recorded path is not installation, content, native custody or load authority. */
export class ReadHeadlessModelTrainingModelUseCase {
  constructor(private readonly dependencies: {readonly organizationId: OrganizationId;
    readonly metadata: Pick<ReadHeadlessModelMetadataUseCase, "execute">;
    readonly models: Pick<ModelRegistryPort, "readRecordedModel">}) {}

  async execute(raw: unknown, authority: Authority) {
    let current = () => false;
    try {
      const captured = record(authority, authorityKeys), originalContext = captured.context;
      const actor = record(originalContext, contextKeys);
      const {hostIncarnationId, clientId, isCurrent, stillAllowed} = captured;
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
      const same = () => {
        const now = record(authority, authorityKeys), context = record(originalContext, contextKeys);
        return now.context === originalContext && now.hostIncarnationId === input.hostIncarnationId && now.clientId === clientId &&
          now.isCurrent === isCurrent && now.stillAllowed === stillAllowed && context.organizationId === actor.organizationId &&
          context.principalId === actor.principalId && context.workspaceId === actor.workspaceId;
      };
      current = () => {
        try {
          if (!same()) return false;
          const result: unknown = isCurrent.call(authority);
          if (types.isPromise(result)) void Promise.prototype.then.call(result, undefined, () => {});
          return result === true && same();
        } catch {return false;}
      };
      const allowed = async () => {
        try {return current() && await stillAllowed.call(authority) === true && current();} catch {return false;}
      };
      const owner = this.dependencies.metadata, readMetadata = owner.execute.bind(owner);
      const models = this.dependencies.models, read = models.readRecordedModel?.bind(models);
      const target = freeze({hostIncarnationId: input.hostIncarnationId, workspaceId: input.workspaceId, modelRecordId: input.model.modelRecordId});
      const query = freeze({version: request.version, operation: "models.record" as const, input: target});
      const context = freeze({organizationId: actor.organizationId, principalId: actor.principalId, workspaceId: input.workspaceId});
      const readAuthority = {hostIncarnationId: input.hostIncarnationId, context, isCurrent: current, stillAllowed: allowed};
      if (!await allowed() || !current()) return forbidden;
      if (!read) return unavailable;
      const initial = await readMetadata(query, readAuthority);
      if (!await allowed() || !current()) return forbidden;
      const initialValue = metadata(initial, target);
      if (!initialValue.ok) return initialValue;
      const first = initialValue.record;
      if (first.model.updatedAt !== input.model.updatedAt) return stale;
      const rawModel = await read(input.workspaceId, input.model.modelRecordId);
      if (!await allowed() || !current()) return forbidden;
      if (rawModel === undefined) return notFound;
      const model = selected(rawModel, target);
      if (!isDeepStrictEqual(model.model, first.model)) return stale;
      const final = await readMetadata(query, readAuthority);
      if (!await allowed() || !current()) return forbidden;
      const last = metadata(final, target);
      if (!last.ok || !isDeepStrictEqual(first, last.record)) return stale;
      const finalRaw = await read(input.workspaceId, input.model.modelRecordId);
      if (!await allowed() || !current()) return forbidden;
      if (finalRaw === undefined || !isDeepStrictEqual(selected(finalRaw, target), model)) return stale;
      const prepared = freeze({request, workspaceId: input.workspaceId, ...model,
        selectionDigest: "sha256:" + createHash("sha256").update(JSON.stringify({request, model})).digest("hex"),
        verification: {installation: "not-checked" as const, modelBytes: "not-checked" as const, nativeCustody: "not-checked" as const,
          trainingCompatibility: "not-checked" as const, resourceAdmission: "not-checked" as const, licenseRights: "not-checked" as const},
        trainingApprovalRequired: true as const, resultSaveApprovalRequired: true as const});
      if (!await allowed() || !current()) return forbidden;
      return {ok: true, prepared} as const;
    } catch {return current() ? unavailable : forbidden;}
  }
}
