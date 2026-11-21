import {isDeepStrictEqual, types} from "node:util";
import type {ApplicationRequestContext} from "../../ports";
import {isOrganizationId, type OrganizationId} from "../../../contracts/organization";
import {hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import {isDesktopHeadlessClientId, readHeadlessModelTrainingInputsRequest, readHeadlessModelTrainingInputsValue,
  readHeadlessModelRecord, readHeadlessDatasetVersionBatch, type HeadlessHostIncarnationId, type HeadlessModelTrainingInputsResult} from "../../../contracts/headless";
import type {ReadHeadlessModelMetadataUseCase} from "./headless-model-metadata.use-case";
import type {ReadHeadlessDatasetMetadataUseCase} from "../dataset-version/headless-dataset-metadata.use-case";
import {copyHeadlessModelWorkflowData} from "./headless-model-download-preview.use-case";

const forbidden = {ok: false, code: "headless.forbidden"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;
const stale = {ok: false, code: "headless.stale"} as const;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
}
const authorityFields = ["hostIncarnationId", "context", "clientId", "isCurrent", "stillAllowed"];
const contextFields = ["organizationId", "principalId", "workspaceId", "requestId", "correlationId"];
function result(value: unknown, operation: string) {
  const row = readStrictPassiveRecord(copyHeadlessModelWorkflowData(value), ["ok", "operation", "value", "code"]);
  if (row.ok === false && Object.keys(row).length === 2 && typeof row.code === "string" &&
      ["headless.forbidden", "headless.not-found", "headless.unavailable"].includes(row.code))
    return {ok: false, code: row.code as "headless.forbidden" | "headless.not-found" | "headless.unavailable"} as const;
  if (row.ok !== true || Object.keys(row).length !== 3 || row.operation !== operation) throw new Error("Invalid training input metadata reply.");
  return {ok: true, value: row.value} as const;
}

/** Private read-only input review. Compose ONLY existing minimized authorized
 * metadata owners; no runtime, provider, artifact-byte, task or write port. */
export class PreviewHeadlessModelTrainingInputsUseCase {
  constructor(private readonly dependencies: {readonly organizationId: OrganizationId;
    readonly models: Pick<ReadHeadlessModelMetadataUseCase, "execute">;
    readonly datasets: Pick<ReadHeadlessDatasetMetadataUseCase, "execute">}) {}

  async execute(raw: unknown, authority: {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly context: ApplicationRequestContext;
    readonly clientId: string; readonly isCurrent: () => boolean; readonly stillAllowed: () => Promise<boolean>}): Promise<HeadlessModelTrainingInputsResult> {
    let current = () => false;
    try {
      if (types.isProxy(authority)) return forbidden;
      const captured = readStrictPassiveRecord(authority, authorityFields);
      if (types.isProxy(captured.context)) return forbidden;
      const originalContext = captured.context as ApplicationRequestContext, actor = readStrictPassiveRecord(originalContext, contextFields);
      const {isCurrent, stillAllowed, clientId, hostIncarnationId} = captured;
      const organizationId = this.dependencies.organizationId;
      if (!isOrganizationId(actor.organizationId) || actor.organizationId !== organizationId || typeof actor.principalId !== "string" ||
          !actor.principalId || actor.principalId.length > 160 || /[\x00-\x1f\x7f]/.test(actor.principalId) || hasKnownPassiveCredential(actor.principalId) ||
          !isDesktopHeadlessClientId(clientId) || typeof isCurrent !== "function" || types.isProxy(isCurrent) ||
          typeof stillAllowed !== "function" || types.isProxy(stillAllowed)) return forbidden;
      let parsed: ReturnType<typeof readHeadlessModelTrainingInputsRequest>;
      try {parsed = readHeadlessModelTrainingInputsRequest(copyHeadlessModelWorkflowData(raw), hostIncarnationId as HeadlessHostIncarnationId);}
      catch {return {ok: false, code: "headless.invalid-request"};}
      if (!parsed.ok) return parsed;
      const request = freeze(parsed.request), input = request.input;
      if (actor.workspaceId !== input.workspaceId) return forbidden;
      const context = freeze({organizationId: actor.organizationId, principalId: actor.principalId, workspaceId: input.workspaceId});
      const same = () => {
        if (types.isProxy(authority) || types.isProxy(originalContext)) return false;
        const actual = readStrictPassiveRecord(authority, authorityFields), now = readStrictPassiveRecord(originalContext, contextFields);
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
      // Retain the original reader methods and receivers across every await.
      const modelReader = this.dependencies.models, datasetReader = this.dependencies.datasets;
      const readModel = modelReader.execute.bind(modelReader), readDataset = datasetReader.execute.bind(datasetReader);
      const modelQuery = freeze({version: request.version, operation: "models.record" as const,
        input: {hostIncarnationId: input.hostIncarnationId, workspaceId: input.workspaceId, modelRecordId: input.model.modelRecordId}});
      const datasetQuery = freeze({version: request.version, operation: "data.dataset-versions" as const, input: {
        hostIncarnationId: input.hostIncarnationId, workspaceId: input.workspaceId, datasetId: input.dataset.datasetId, versionIds: [input.dataset.versionId]}});
      const modelAuthority = {hostIncarnationId: input.hostIncarnationId, context, isCurrent: current, stillAllowed: allowed};
      const datasetAuthority = {context, stillAllowed: allowed};
      if (!await allowed() || !current()) return forbidden;
      const first = result(await readModel(modelQuery, modelAuthority), "models.record");
      if (!await allowed() || !current()) return forbidden;
      if (!first.ok) return {ok: false, code: first.code} as const;
      const initialModel = readHeadlessModelRecord(first.value, modelQuery.input);
      if (!initialModel) return unavailable;
      if (initialModel.model.updatedAt !== input.model.updatedAt) return stale;
      const selected = result(await readDataset(datasetQuery, datasetAuthority), "data.dataset-versions");
      if (!await allowed() || !current()) return forbidden;
      if (!selected.ok) return {ok: false, code: selected.code} as const;
      const data = readHeadlessDatasetVersionBatch(selected.value, datasetQuery.input);
      if (!data) return unavailable;
      if (data.versions[0]?.versionDigest !== input.dataset.versionDigest) return stale;
      const final = result(await readModel(modelQuery, modelAuthority), "models.record");
      if (!await allowed() || !current()) return forbidden;
      if (!final.ok) return {ok: false, code: final.code} as const;
      const latestModel = readHeadlessModelRecord(final.value, modelQuery.input);
      if (!latestModel) return unavailable;
      if (!isDeepStrictEqual(latestModel, initialModel)) return stale;
      const value = readHeadlessModelTrainingInputsValue({workspaceId: input.workspaceId, model: latestModel.model,
        dataset: {datasetId: data.datasetId, version: data.versions[0]}, verification: {inputBytes: "not-checked", runtimeReadiness: "not-checked",
          trainingCompatibility: "not-checked", resourceAdmission: "not-checked", licenseRights: "not-checked", qualityReport: "recorded-not-rechecked"},
        trainingApproval: "required"}, input);
      if (!await allowed() || !current()) return forbidden;
      return value && current() ? {ok: true, operation: request.operation, value: freeze(value)} as const : current() ? unavailable : forbidden;
    } catch {return current() ? unavailable : forbidden;}
  }
}
