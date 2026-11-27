import {createHash} from "node:crypto";
import {isDeepStrictEqual, types} from "node:util";
import {readHeadlessModelImagePlanRequest, readHeadlessModelRecord, type HeadlessHostIncarnationId} from "../../../contracts/headless";
import {readStrictPassiveRecord} from "../../../contracts/shared";
import {snapshotBoundedImageGenerationRequest} from "../../../contracts/image-generation";
import {copyHeadlessModelWorkflowData} from "../model/headless-model-download-preview.use-case";
import type {ReadHeadlessModelMetadataUseCase} from "../model/headless-model-metadata.use-case";

function wellFormed(text: string) {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

/** Private transient preparation only. The returned request contains user text:
 * never persist it in a plan, diagnostic, receipt or public metadata response.
 * Matching a digest grants no approval, current Model selection, runtime access
 * or output-import authority. Original owners must enforce those separately. */
export function prepareHeadlessImageRequest(raw: unknown, currentHost: HeadlessHostIncarnationId) {
  const invalid = {ok: false, code: "headless.invalid-request"} as const;
  const stale = {ok: false, code: "headless.stale"} as const;
  try {
    if (types.isProxy(raw)) return invalid;
    const row = readStrictPassiveRecord(raw, ["plan", "prompt", "negativePrompt"]);
    if (typeof row.prompt !== "string" || row.prompt.length > 10000 || !wellFormed(row.prompt) ||
        (Object.prototype.hasOwnProperty.call(row, "negativePrompt") &&
          (typeof row.negativePrompt !== "string" || row.negativePrompt.length > 10000 || !wellFormed(row.negativePrompt)))) return invalid;
    const parsed = readHeadlessModelImagePlanRequest(copyHeadlessModelWorkflowData(row.plan), currentHost);
    if (!parsed.ok) return parsed;
    const request = parsed.request, input = request.input;
    const hasNegative = Object.prototype.hasOwnProperty.call(row, "negativePrompt");
    const generationRequest = snapshotBoundedImageGenerationRequest({prompt: row.prompt, ...input.settings,
      ...(hasNegative ? {negativePrompt: row.negativePrompt as string} : {})});
    const digest = (text: string) => "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");
    if (digest(generationRequest.prompt) !== input.promptDigest || hasNegative !== (input.negativePromptDigest !== undefined) ||
        (hasNegative && digest(generationRequest.negativePrompt!) !== input.negativePromptDigest)) return stale;
    return {ok: true, prepared: Object.freeze({plan: request, generationRequest: Object.freeze(generationRequest),
      generationApprovalRequired: true as const, outputImportApprovalRequired: true as const,
      modelSelection: "not-checked" as const, runtimeReadiness: "not-checked" as const})} as const;
  } catch {return invalid;}
}

type ModelAuthority = Parameters<ReadHeadlessModelMetadataUseCase["execute"]>[1];
const forbidden = {ok: false, code: "headless.forbidden"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;
const authorityKeys = ["hostIncarnationId", "context", "isCurrent", "stillAllowed"];
const contextKeys = ["organizationId", "principalId", "workspaceId", "requestId", "correlationId"];
function passiveRecord(value: unknown, keys: readonly string[]) {
  if (types.isProxy(value)) throw Error("Image model selection is unavailable.");
  return readStrictPassiveRecord(value, keys);
}
function frozen<T>(value: T): T {
  if (value && typeof value === "object") {for (const child of Object.values(value)) frozen(child); Object.freeze(value);}
  return value;
}

/** Private metadata preparation, never a dispatch grant. The original approval
 * and runtime owners must revalidate selection before any execution. No paths,
 * files, provider, task, readiness or supply-verification port is available here.
 * The prepared request contains private text; do not persist or return it publicly. */
export class PrepareHeadlessImageModelUseCase {
  constructor(private readonly dependencies: {readonly metadata: Pick<ReadHeadlessModelMetadataUseCase, "execute">}) {}

  async execute(raw: unknown, authority: ModelAuthority) {
    try {
      const captured = passiveRecord(authority, authorityKeys), originalContext = captured.context;
      const actor = passiveRecord(originalContext, contextKeys);
      const {hostIncarnationId, isCurrent, stillAllowed} = captured;
      if (typeof isCurrent !== "function" || types.isProxy(isCurrent) || typeof stillAllowed !== "function" || types.isProxy(stillAllowed)) return forbidden;
      const binding = prepareHeadlessImageRequest(raw, hostIncarnationId as HeadlessHostIncarnationId);
      if (!binding.ok) return binding;
      const input = binding.prepared.plan.input;
      if (actor.workspaceId !== input.workspaceId) return forbidden;
      const same = () => {
        const live = passiveRecord(authority, authorityKeys), context = passiveRecord(originalContext, contextKeys);
        return live.context === originalContext && live.hostIncarnationId === hostIncarnationId && live.isCurrent === isCurrent &&
          live.stillAllowed === stillAllowed && context.organizationId === actor.organizationId &&
          context.principalId === actor.principalId && context.workspaceId === actor.workspaceId;
      };
      const current = () => {
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
      const context = Object.freeze({organizationId: actor.organizationId, principalId: actor.principalId,
        workspaceId: actor.workspaceId}) as ModelAuthority["context"];
      const target = Object.freeze({hostIncarnationId: input.hostIncarnationId, workspaceId: input.workspaceId,
        modelRecordId: input.model.modelRecordId});
      const request = frozen({version: binding.prepared.plan.version, operation: "models.record", input: target});
      const read = this.dependencies.metadata.execute.bind(this.dependencies.metadata);
      const lookup = async () => {
        const reply = passiveRecord(copyHeadlessModelWorkflowData(await read(request,
          {hostIncarnationId: input.hostIncarnationId, context, isCurrent: current, stillAllowed: allowed})), ["ok", "code", "operation", "value"]);
        if (reply.ok !== true || reply.operation !== "models.record" || Object.keys(reply).length !== 3) return;
        const selected = readHeadlessModelRecord(reply.value, target);
        return selected ? frozen(selected) : undefined;
      };
      if (!await allowed()) return forbidden;
      const first = await lookup();
      if (!await allowed()) return forbidden;
      if (!first) return unavailable;
      if (first.model.updatedAt !== input.model.updatedAt) return {ok: false, code: "headless.stale"} as const;
      const model = first.model;
      if (!["downloaded", "generated", "validated"].includes(model.lifecycleStatus) ||
          !["full-model", "merged-model", "checkpoint"].includes(model.artifactForm) || model.serializationFormat !== "safetensors" ||
          !model.taskTags.includes("text-to-image") || model.inferenceMode !== undefined && model.inferenceMode !== "text-to-image") return unavailable;
      const final = await lookup();
      if (!await allowed()) return forbidden;
      if (!final || !isDeepStrictEqual(first, final)) return {ok: false, code: "headless.stale"} as const;
      return {ok: true, prepared: Object.freeze({...binding.prepared,
        generationRequest: Object.freeze({...binding.prepared.generationRequest, model: model.modelRecordId}),
        recordedModel: first, modelSelection: "recorded-only" as const})} as const;
    } catch {return unavailable;}
  }
}
