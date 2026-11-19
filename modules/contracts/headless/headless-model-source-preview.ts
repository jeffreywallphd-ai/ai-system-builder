import {copyBoundedPassiveData, readStrictPassiveRecord} from "../shared";
import {readModelDownloadSource, readModelDownloadSourceRequest, type ModelDownloadSource} from "../model";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";

export interface HeadlessModelSourcePreviewRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "models.preview-source";
  readonly input: {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId;
    readonly modelId: string; readonly revision?: string};
}
export interface HeadlessModelSourcePreview {
  readonly workspaceId: WorkspaceId;
  readonly source: ModelDownloadSource;
  /** SHA256 of normalized provider metadata, never a local model-byte verification. */
  readonly manifestDigest: string;
  readonly downloadApprovalRequired: true;
}
const invalid = {ok: false, code: "headless.invalid-request"} as const;
export function readHeadlessModelSourcePreviewRequest(value: unknown, host: HeadlessHostIncarnationId) {
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "models.preview-source") return invalid;
    const input = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "modelId", "revision"]);
    if (!isHeadlessHostIncarnationId(host) || !isHeadlessHostIncarnationId(input.hostIncarnationId) || !isWorkspaceId(input.workspaceId)) return invalid;
    if (input.hostIncarnationId !== host) return {ok: false, code: "headless.host-changed"} as const;
    const target = readModelDownloadSourceRequest({provider: "huggingface", modelId: input.modelId,
      ...("revision" in input ? {revision: input.revision} : {})});
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: "models.preview-source", input: {
      hostIncarnationId: host, workspaceId: input.workspaceId, modelId: target.modelId,
      ...(target.revision === undefined ? {} : {revision: target.revision})}} satisfies HeadlessModelSourcePreviewRequest} as const;
  } catch {return invalid;}
}
/** Structural/target codec. Node host/API/SDK boundaries separately verify the metadata digest. */
export function readHeadlessModelSourcePreviewValue(value: unknown, target: HeadlessModelSourcePreviewRequest["input"]): HeadlessModelSourcePreview | undefined {
  try {
    const result = readStrictPassiveRecord(copyBoundedPassiveData(value), ["workspaceId", "source", "manifestDigest", "downloadApprovalRequired"]);
    if (result.workspaceId !== target.workspaceId || result.downloadApprovalRequired !== true ||
        typeof result.manifestDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(result.manifestDigest)) return;
    const source = readModelDownloadSource(result.source, {provider: "huggingface", modelId: target.modelId,
      ...(target.revision === undefined ? {} : {revision: target.revision})});
    return {workspaceId: target.workspaceId, source, manifestDigest: result.manifestDigest, downloadApprovalRequired: true};
  } catch {return;}
}
