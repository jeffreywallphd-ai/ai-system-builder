import {copyBoundedPassiveData, readStrictPassiveRecord} from "../shared";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";
import {readHeadlessSavedContextReference, type HeadlessSavedContextReference} from "./headless-context-result-plan";
import {HEADLESS_CONTEXT_MAX_SOURCES, isHeadlessContextModelId, isHeadlessContextTimestamp} from "./headless-context-preview";

/** Fits the existing 8 KiB headless envelope; ordinary Context keeps its own bound. */
export const HEADLESS_CONTEXT_QUERY_MAX_CHARACTERS = 2_000;
export interface HeadlessContextQueryPreviewRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "context.preview-query";
  readonly input: {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId;
    readonly reference: HeadlessSavedContextReference; readonly query: string;
    readonly maximumResults: number; readonly embeddingDevice: "cpu" | "cuda"};
}
export interface HeadlessContextQueryPreviewValue {
  readonly reference: HeadlessSavedContextReference;
  readonly queryDigest: string;
  readonly maximumResults: number;
  readonly embeddingDevice: "cpu" | "cuda";
  readonly modelRecordId: string;
  readonly modelUpdatedAt: string;
  readonly sourceCount: number;
  readonly maximumQueryCharacters: typeof HEADLESS_CONTEXT_QUERY_MAX_CHARACTERS;
  readonly runtimeReadiness: "not-checked";
  readonly byteAvailability: "not-checked";
  readonly approvalRequired: true;
  readonly output: "citation-summary";
}
const isDigest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
export function isHeadlessContextQuestion(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= HEADLESS_CONTEXT_QUERY_MAX_CHARACTERS &&
    value === value.trim() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) &&
    new TextDecoder("utf-8", {fatal: true}).decode(new TextEncoder().encode(value)) === value;
}

export function readHeadlessContextQueryPreviewRequest(value: unknown, host: HeadlessHostIncarnationId) {
  const invalid = {ok: false, code: "headless.invalid-request"} as const;
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "context.preview-query") return invalid;
    const raw = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "reference", "query", "maximumResults", "embeddingDevice"]);
    if (!isHeadlessHostIncarnationId(host) || !isHeadlessHostIncarnationId(raw.hostIncarnationId) || !isWorkspaceId(raw.workspaceId) ||
        !isHeadlessContextQuestion(raw.query) || typeof raw.maximumResults !== "number" || !Number.isSafeInteger(raw.maximumResults) ||
        raw.maximumResults < 1 || raw.maximumResults > 20 || (raw.embeddingDevice !== "cpu" && raw.embeddingDevice !== "cuda")) return invalid;
    const reference = readHeadlessSavedContextReference(raw.reference, raw.workspaceId);
    if (!reference || reference.kind !== "rag-database") return invalid;
    if (raw.hostIncarnationId !== host) return {ok: false, code: "headless.host-changed"} as const;
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: "context.preview-query", input: {
      hostIncarnationId: host, workspaceId: raw.workspaceId, reference, query: raw.query,
      maximumResults: raw.maximumResults, embeddingDevice: raw.embeddingDevice}} satisfies HeadlessContextQueryPreviewRequest} as const;
  } catch {return invalid;}
}

/** The Node caller computes the expected digest from the exact transient UTF8 question. */
export function readHeadlessContextQueryPreviewValue(value: unknown, target: Omit<HeadlessContextQueryPreviewRequest["input"], "query">,
  expectedQueryDigest: string): HeadlessContextQueryPreviewValue | undefined {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["reference", "queryDigest", "maximumResults", "embeddingDevice",
      "modelRecordId", "modelUpdatedAt", "sourceCount", "maximumQueryCharacters", "runtimeReadiness", "byteAvailability", "approvalRequired", "output"]);
    const reference = readHeadlessSavedContextReference(raw.reference, target.workspaceId);
    if (!reference || reference.kind !== "rag-database" || !Object.entries(target.reference).every(([key, item]) =>
        reference[key as keyof HeadlessSavedContextReference] === item) || !isDigest(expectedQueryDigest) || raw.queryDigest !== expectedQueryDigest ||
        raw.maximumResults !== target.maximumResults || raw.embeddingDevice !== target.embeddingDevice ||
        !isHeadlessContextModelId(raw.modelRecordId) || !isHeadlessContextTimestamp(raw.modelUpdatedAt) ||
        typeof raw.sourceCount !== "number" || !Number.isSafeInteger(raw.sourceCount) || raw.sourceCount < 1 || raw.sourceCount > HEADLESS_CONTEXT_MAX_SOURCES ||
        raw.maximumQueryCharacters !== HEADLESS_CONTEXT_QUERY_MAX_CHARACTERS || raw.runtimeReadiness !== "not-checked" ||
        raw.byteAvailability !== "not-checked" || raw.approvalRequired !== true || raw.output !== "citation-summary") return;
    return {reference, queryDigest: expectedQueryDigest, maximumResults: target.maximumResults, embeddingDevice: target.embeddingDevice,
      modelRecordId: raw.modelRecordId, modelUpdatedAt: raw.modelUpdatedAt, sourceCount: raw.sourceCount,
      maximumQueryCharacters: HEADLESS_CONTEXT_QUERY_MAX_CHARACTERS, runtimeReadiness: "not-checked", byteAvailability: "not-checked",
      approvalRequired: true, output: "citation-summary"};
  } catch {return;}
}
