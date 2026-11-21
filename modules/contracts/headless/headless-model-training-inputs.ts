import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../shared";
import {normalizeDatasetId, normalizeDatasetVersionId, normalizeDatasetVersionDigest,
  type DatasetId, type DatasetVersionId, type DatasetVersionDigest} from "../dataset";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";
import {isHeadlessModelRecordId, isHeadlessModelTimestamp, readHeadlessModelRecord, type HeadlessRecordedModelSummary} from "./headless-model-metadata";
import {readHeadlessDatasetVersionBatch, type HeadlessDatasetVersionSummary} from "./headless-dataset-metadata";

/** Metadata selection only. Neither a training request nor file/quality proof. */
export interface HeadlessModelTrainingInputsRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "models.preview-training-inputs";
  readonly input: {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId;
    readonly model: {readonly modelRecordId: string; readonly updatedAt: string};
    readonly dataset: {readonly datasetId: DatasetId; readonly versionId: DatasetVersionId; readonly versionDigest: DatasetVersionDigest}};
}
export interface HeadlessModelTrainingInputsValue {
  readonly workspaceId: WorkspaceId;
  readonly model: HeadlessRecordedModelSummary;
  readonly dataset: {readonly datasetId: DatasetId; readonly version: HeadlessDatasetVersionSummary};
  readonly verification: {readonly inputBytes: "not-checked"; readonly runtimeReadiness: "not-checked";
    readonly trainingCompatibility: "not-checked"; readonly resourceAdmission: "not-checked"; readonly licenseRights: "not-checked";
    readonly qualityReport: "recorded-not-rechecked"};
  readonly trainingApproval: "required";
}
export type HeadlessModelTrainingInputsResult =
  {readonly ok: true; readonly operation: "models.preview-training-inputs"; readonly value: HeadlessModelTrainingInputsValue} |
  {readonly ok: false; readonly code: "headless.invalid-request" | "headless.host-changed" | "headless.forbidden" |
    "headless.not-found" | "headless.unavailable" | "headless.stale"};
const invalid = {ok: false, code: "headless.invalid-request"} as const;
function exact(value: unknown, fields: readonly string[]) {
  const row = readStrictPassiveRecord(value, fields);
  if (Object.keys(row).length !== fields.length) throw new Error("Incomplete training input metadata.");
  return row;
}
function reference<T extends string>(value: unknown, normalize: (value: string) => T): T {
  if (typeof value !== "string" || hasKnownPassiveCredential(value)) throw new Error("Invalid training dataset reference.");
  const normalized = normalize(value); if (normalized !== value) throw new Error("Noncanonical training dataset reference.");
  return normalized;
}
export function readHeadlessModelTrainingInputsRequest(value: unknown, host: HeadlessHostIncarnationId) {
  try {
    const outer = exact(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "models.preview-training-inputs") return invalid;
    const input = exact(outer.input, ["hostIncarnationId", "workspaceId", "model", "dataset"]);
    const model = exact(input.model, ["modelRecordId", "updatedAt"]), data = exact(input.dataset, ["datasetId", "versionId", "versionDigest"]);
    if (!isHeadlessHostIncarnationId(host) || !isHeadlessHostIncarnationId(input.hostIncarnationId) || !isWorkspaceId(input.workspaceId) ||
        !isHeadlessModelRecordId(model.modelRecordId) || !isHeadlessModelTimestamp(model.updatedAt)) return invalid;
    const dataset = {datasetId: reference(data.datasetId, normalizeDatasetId), versionId: reference(data.versionId, normalizeDatasetVersionId),
      versionDigest: reference(data.versionDigest, normalizeDatasetVersionDigest)};
    if (input.hostIncarnationId !== host) return {ok: false, code: "headless.host-changed"} as const;
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: "models.preview-training-inputs", input: {
      hostIncarnationId: host, workspaceId: input.workspaceId, model: {modelRecordId: model.modelRecordId, updatedAt: model.updatedAt}, dataset}} satisfies HeadlessModelTrainingInputsRequest} as const;
  } catch {return invalid;}
}
export function readHeadlessModelTrainingInputsValue(value: unknown, target: HeadlessModelTrainingInputsRequest["input"]): HeadlessModelTrainingInputsValue | undefined {
  try {
    const row = exact(copyBoundedPassiveData(value), ["workspaceId", "model", "dataset", "verification", "trainingApproval"]);
    const data = exact(row.dataset, ["datasetId", "version"]);
    const model = readHeadlessModelRecord({workspaceId: row.workspaceId, model: row.model,
      runtimeReadiness: "not-checked", supplyVerification: "not-checked"},
      {hostIncarnationId: target.hostIncarnationId, workspaceId: target.workspaceId, modelRecordId: target.model.modelRecordId});
    const batch = readHeadlessDatasetVersionBatch({workspaceId: row.workspaceId, datasetId: data.datasetId, versions: [data.version]},
      {hostIncarnationId: target.hostIncarnationId, workspaceId: target.workspaceId, datasetId: target.dataset.datasetId, versionIds: [target.dataset.versionId]});
    const verification = exact(row.verification, ["inputBytes", "runtimeReadiness", "trainingCompatibility", "resourceAdmission", "licenseRights", "qualityReport"]);
    if (!model || !batch || model.model.updatedAt !== target.model.updatedAt || batch.versions[0]?.versionDigest !== target.dataset.versionDigest ||
        row.trainingApproval !== "required" || verification.inputBytes !== "not-checked" || verification.runtimeReadiness !== "not-checked" ||
        verification.trainingCompatibility !== "not-checked" || verification.resourceAdmission !== "not-checked" || verification.licenseRights !== "not-checked" ||
        verification.qualityReport !== "recorded-not-rechecked") return;
    return {workspaceId: target.workspaceId, model: model.model, dataset: {datasetId: batch.datasetId, version: batch.versions[0]},
      verification: {inputBytes: "not-checked", runtimeReadiness: "not-checked", trainingCompatibility: "not-checked", resourceAdmission: "not-checked",
        licenseRights: "not-checked", qualityReport: "recorded-not-rechecked"}, trainingApproval: "required"};
  } catch {return;}
}
export function readHeadlessModelTrainingInputsResult(value: unknown, target: HeadlessModelTrainingInputsRequest["input"]): HeadlessModelTrainingInputsResult {
  const unavailable = {ok: false, code: "headless.unavailable"} as const;
  try {
    const row = readStrictPassiveRecord(copyBoundedPassiveData(value), ["ok", "operation", "value", "code"]);
    if (row.ok === false && Object.keys(row).length === 2 && typeof row.code === "string" &&
        ["headless.invalid-request", "headless.host-changed", "headless.forbidden", "headless.not-found", "headless.unavailable", "headless.stale"].includes(row.code))
      return {ok: false, code: row.code as Extract<HeadlessModelTrainingInputsResult, {ok: false}>["code"]};
    if (row.ok !== true || row.operation !== "models.preview-training-inputs" || Object.keys(row).length !== 3) return unavailable;
    const parsed = readHeadlessModelTrainingInputsValue(row.value, target);
    return parsed ? {ok: true, operation: "models.preview-training-inputs", value: parsed} : unavailable;
  } catch {return unavailable;}
}
