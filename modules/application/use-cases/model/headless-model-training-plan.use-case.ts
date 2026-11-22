import {createHash} from "node:crypto";
import {types} from "node:util";
import {readStrictPassiveRecord, hasKnownPassiveCredential} from "../../../contracts/shared";
import {isOrganizationId, type OrganizationId} from "../../../contracts/organization";
import {isDesktopHeadlessClientId, readHeadlessModelTrainingPlanRequest, readHeadlessModelTrainingInputsResult,
  type HeadlessModelTrainingInputsValue} from "../../../contracts/headless";
import {copyHeadlessModelWorkflowData} from "./headless-model-download-preview.use-case";
import type {PreviewHeadlessModelTrainingInputsUseCase} from "./headless-model-training-inputs.use-case";

type Authority = Parameters<PreviewHeadlessModelTrainingInputsUseCase["execute"]>[1];
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
}
/** Internal representation of already decoded passive metadata. Keep every
 * validated field and array order; JSON object order is not a storage guarantee.
 * This projection supplies no metadata, approval or runtime authority. */
export function canonicalHeadlessModelTrainingInputs(inputs: HeadlessModelTrainingInputsValue): HeadlessModelTrainingInputsValue {
  const model = inputs.model;
  return {...inputs, model: {modelRecordId: model.modelRecordId, updatedAt: model.updatedAt, source: model.source,
    lifecycleStatus: model.lifecycleStatus, artifactForm: model.artifactForm, provider: model.provider,
    ...("modelId" in model ? {modelId: model.modelId} : {}),
    ...("inferenceMode" in model ? {inferenceMode: model.inferenceMode} : {}),
    ...("serializationFormat" in model ? {serializationFormat: model.serializationFormat} : {}),
    taskTags: model.taskTags, ...("sizeBytes" in model ? {sizeBytes: model.sizeBytes} : {}),
    ...("parameterCount" in model ? {parameterCount: model.parameterCount} : {})}};
}
/** Bind proposal settings to exact authorized saved metadata, without an effect
 * port or claim of execution/file/readiness/rights/quality/approval authority. */
export class PrepareHeadlessModelTrainingPlanUseCase {
  constructor(private readonly dependencies: {readonly organizationId: OrganizationId; readonly inputs: Pick<PreviewHeadlessModelTrainingInputsUseCase, "execute">}) {}

  async execute(raw: unknown, authority: Authority) {
    const forbidden = {ok: false, code: "headless.forbidden"} as const;
    const unavailable = {ok: false, code: "headless.unavailable"} as const;
    let current = () => false;
    try {
      if (types.isProxy(authority)) return forbidden;
      const captured = readStrictPassiveRecord(authority, ["hostIncarnationId", "context", "clientId", "isCurrent", "stillAllowed"]);
      if (types.isProxy(captured.context)) return forbidden;
      const context = captured.context, actor = readStrictPassiveRecord(context, ["organizationId", "principalId", "workspaceId", "requestId", "correlationId"]);
      const {isCurrent, stillAllowed, hostIncarnationId, clientId} = captured;
      if (!isOrganizationId(actor.organizationId) || actor.organizationId !== this.dependencies.organizationId ||
          typeof actor.principalId !== "string" || !actor.principalId || actor.principalId.length > 160 ||
          /[\x00-\x1f\x7f]/.test(actor.principalId) || hasKnownPassiveCredential(actor.principalId) || !isDesktopHeadlessClientId(clientId) ||
          typeof isCurrent !== "function" || types.isProxy(isCurrent) || typeof stillAllowed !== "function" || types.isProxy(stillAllowed)) return forbidden;
      let parsed: ReturnType<typeof readHeadlessModelTrainingPlanRequest>;
      try {parsed = readHeadlessModelTrainingPlanRequest(copyHeadlessModelWorkflowData(raw), hostIncarnationId as Authority["hostIncarnationId"]);}
      catch {return {ok: false, code: "headless.invalid-request"} as const;}
      if (!parsed.ok) return parsed;
      const request = freeze(parsed.request), input = request.input;
      const same = () => {
        if (types.isProxy(authority) || types.isProxy(context)) return false;
        const actual = readStrictPassiveRecord(authority, ["hostIncarnationId", "context", "clientId", "isCurrent", "stillAllowed"]);
        const now = readStrictPassiveRecord(context, ["organizationId", "principalId", "workspaceId", "requestId", "correlationId"]);
        return actual.context === context && actual.hostIncarnationId === input.hostIncarnationId && actual.clientId === clientId &&
          actual.isCurrent === isCurrent && actual.stillAllowed === stillAllowed && now.organizationId === actor.organizationId &&
          now.principalId === actor.principalId && now.workspaceId === actor.workspaceId && now.workspaceId === input.workspaceId;
      };
      current = () => {
        try {
          if (!same()) return false;
          const value: unknown = isCurrent.call(authority);
          if (types.isPromise(value)) void Promise.prototype.then.call(value, undefined, () => {});
          return value === true && same();
        } catch {return false;}
      };
      const owner = this.dependencies.inputs, read = owner.execute.bind(owner);
      const selected = freeze({version: request.version, operation: "models.preview-training-inputs" as const, input: {
        hostIncarnationId: input.hostIncarnationId, workspaceId: input.workspaceId, model: input.model, dataset: input.dataset}});
      if (!current()) return forbidden;
      const observed = await read(selected, authority);
      if (!current()) return forbidden;
      const result = readHeadlessModelTrainingInputsResult(copyHeadlessModelWorkflowData(observed), selected.input);
      if (!result.ok) return result;
      // The original metadata owner authorizes its reads. Retain the original
      // current policy through this separate compiler's awaited return handoff.
      let allowed: unknown;
      try {allowed = await stillAllowed.call(authority);} catch {return forbidden;}
      if (allowed !== true || !current()) return forbidden;
      const proposal = freeze({request, inputs: canonicalHeadlessModelTrainingInputs(result.value)});
      const proposalDigest = "sha256:" + createHash("sha256").update(JSON.stringify(proposal)).digest("hex");
      if (!current()) return forbidden;
      return {ok: true, prepared: freeze({...proposal, proposalDigest, trainingApprovalRequired: true as const,
        resultSaveApprovalRequired: true as const, installationPermission: "not-granted" as const, publicationPermission: "not-granted" as const})} as const;
    } catch {return current() ? unavailable : forbidden;}
  }
}
