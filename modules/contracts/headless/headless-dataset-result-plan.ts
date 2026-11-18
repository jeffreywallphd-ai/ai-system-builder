import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../shared";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {validateDatasetPreparationSaveName} from "../runtime/dataset-preparation";
import {normalizeDatasetId, normalizeDatasetVersionId, normalizeDatasetVersionDigest,
  type DatasetId, type DatasetVersionId, type DatasetVersionDigest} from "../dataset";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";

export interface HeadlessDatasetResultSavePlanRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "data.save-prepared-dataset";
  readonly input: {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId;
    readonly idempotencyKey: string; readonly taskId: string; readonly reportFingerprint: string; readonly outputBaseName: string};
}
export interface HeadlessSavedDatasetReference {
  readonly workspaceId: WorkspaceId;
  readonly taskId: string;
  readonly datasetId: DatasetId;
  readonly versionId: DatasetVersionId;
  readonly versionDigest: DatasetVersionDigest;
}

export function readHeadlessDatasetResultSavePlanRequest(value: unknown, host: HeadlessHostIncarnationId):
  {readonly ok: true; readonly request: HeadlessDatasetResultSavePlanRequest} |
  {readonly ok: false; readonly code: "headless.invalid-request" | "headless.host-changed"} {
  const invalid = {ok: false, code: "headless.invalid-request"} as const;
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "data.save-prepared-dataset") return invalid;
    const {hostIncarnationId, workspaceId, idempotencyKey, taskId, reportFingerprint, outputBaseName} = readStrictPassiveRecord(outer.input,
      ["hostIncarnationId", "workspaceId", "idempotencyKey", "taskId", "reportFingerprint", "outputBaseName"]);
    if (!isHeadlessHostIncarnationId(host) || !isHeadlessHostIncarnationId(hostIncarnationId) || !isWorkspaceId(workspaceId) ||
        !isHeadlessHostIncarnationId(idempotencyKey) || !isHeadlessHostIncarnationId(taskId) ||
        typeof reportFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(reportFingerprint) ||
        typeof outputBaseName !== "string" || outputBaseName !== outputBaseName.trim() || outputBaseName.length < 1 ||
        outputBaseName.length > 160 || hasKnownPassiveCredential(outputBaseName) || validateDatasetPreparationSaveName(outputBaseName)) return invalid;
    if (hostIncarnationId !== host) return {ok: false, code: "headless.host-changed"};
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: "data.save-prepared-dataset",
      input: {hostIncarnationId, workspaceId, idempotencyKey, taskId, reportFingerprint, outputBaseName}}};
  } catch {return invalid;}
}

export function readHeadlessSavedDatasetReference(value: unknown, workspaceId: WorkspaceId, expectedTaskId?: string): HeadlessSavedDatasetReference | undefined {
  try {
    const row = readStrictPassiveRecord(copyBoundedPassiveData(value), ["workspaceId", "taskId", "datasetId", "versionId", "versionDigest"]);
    if (row.workspaceId !== workspaceId || !isHeadlessHostIncarnationId(row.taskId) ||
        (expectedTaskId !== undefined && row.taskId !== expectedTaskId) ||
        typeof row.datasetId !== "string" || typeof row.versionId !== "string" || typeof row.versionDigest !== "string" ||
        hasKnownPassiveCredential(row.datasetId) || hasKnownPassiveCredential(row.versionId)) return;
    const datasetId = normalizeDatasetId(row.datasetId), versionId = normalizeDatasetVersionId(row.versionId),
      versionDigest = normalizeDatasetVersionDigest(row.versionDigest);
    if (datasetId !== row.datasetId || versionId !== row.versionId || versionDigest !== row.versionDigest) return;
    return {workspaceId, taskId: row.taskId, datasetId, versionId, versionDigest};
  } catch {return;}
}
