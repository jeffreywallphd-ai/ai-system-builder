import {copyBoundedPassiveData, readStrictPassiveRecord} from "../shared";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";
import {readHeadlessSavedContextReference, type HeadlessSavedContextReference} from "./headless-context-result-plan";
import {isHeadlessContextModelId, isHeadlessContextTimestamp, readHeadlessContextSource, HEADLESS_CONTEXT_MAX_SOURCES,
  type HeadlessContextSource} from "./headless-context-preview";

/** Durable plan data contains only the question fingerprint, never its text. */
export interface HeadlessContextQueryPlanRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "context.query";
  readonly input: {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId;
    readonly idempotencyKey: string; readonly reference: HeadlessSavedContextReference; readonly queryDigest: string;
    readonly modelRecordId: string; readonly modelUpdatedAt: string; readonly maximumResults: number; readonly embeddingDevice: "cpu" | "cuda"};
}
export interface HeadlessContextQueryMatch {
  readonly rank: number;
  readonly score: number;
  readonly sourceOrdinal: number;
  readonly chunkIndex: number;
  readonly rowIndex?: number;
  readonly normalizedStart?: number;
  readonly normalizedEnd?: number;
  readonly pageNumber?: number;
}
export interface HeadlessContextQuerySummary {
  /** Task identity binds the plan; source references are scoped to its request workspace. */
  readonly queryDigest: string;
  readonly maximumResults: number;
  readonly embeddingDevice: "cpu" | "cuda";
  readonly sources: readonly {readonly reference: HeadlessContextSource; readonly digest: string}[];
  readonly matches: readonly HeadlessContextQueryMatch[];
  readonly cleanupPending: boolean;
}
const isDigest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const bounded = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;

export function readHeadlessContextQueryPlanRequest(value: unknown, host: HeadlessHostIncarnationId) {
  const invalid = {ok: false, code: "headless.invalid-request"} as const;
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "context.query") return invalid;
    const raw = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "idempotencyKey", "reference", "queryDigest",
      "modelRecordId", "modelUpdatedAt", "maximumResults", "embeddingDevice"]);
    if (!isHeadlessHostIncarnationId(host) || !isHeadlessHostIncarnationId(raw.hostIncarnationId) || !isWorkspaceId(raw.workspaceId) ||
        !isHeadlessHostIncarnationId(raw.idempotencyKey) || !isDigest(raw.queryDigest) || !isHeadlessContextModelId(raw.modelRecordId) ||
        !isHeadlessContextTimestamp(raw.modelUpdatedAt) || !bounded(raw.maximumResults, 1, 20) ||
        (raw.embeddingDevice !== "cpu" && raw.embeddingDevice !== "cuda")) return invalid;
    const reference = readHeadlessSavedContextReference(raw.reference, raw.workspaceId);
    if (!reference || reference.kind !== "rag-database") return invalid;
    if (raw.hostIncarnationId !== host) return {ok: false, code: "headless.host-changed"} as const;
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: "context.query", input: {
      hostIncarnationId: host, workspaceId: raw.workspaceId, idempotencyKey: raw.idempotencyKey, reference, queryDigest: raw.queryDigest,
      modelRecordId: raw.modelRecordId, modelUpdatedAt: raw.modelUpdatedAt, maximumResults: raw.maximumResults,
      embeddingDevice: raw.embeddingDevice}} satisfies HeadlessContextQueryPlanRequest} as const;
  } catch {return invalid;}
}

/** Only finite coordinates with their original public source references cross the wire. */
export function readHeadlessContextQuerySummary(value: unknown): HeadlessContextQuerySummary | undefined {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["queryDigest",
      "maximumResults", "embeddingDevice", "sources", "matches", "cleanupPending"]);
    if (!isDigest(raw.queryDigest) || !bounded(raw.maximumResults, 1, 20) ||
        (raw.embeddingDevice !== "cpu" && raw.embeddingDevice !== "cuda") || typeof raw.cleanupPending !== "boolean" ||
        !Array.isArray(raw.sources) || raw.sources.length < 1 || raw.sources.length > HEADLESS_CONTEXT_MAX_SOURCES ||
        !Array.isArray(raw.matches) || raw.matches.length > raw.maximumResults) return;
    const sources = raw.sources.map(value => {
      const source = readStrictPassiveRecord(value, ["reference", "digest"]);
      if (!isDigest(source.digest)) throw new Error();
      return {reference: readHeadlessContextSource(source.reference), digest: source.digest};
    });
    if (new Set(sources.map(source => JSON.stringify(source.reference))).size !== sources.length) return;
    const matches = raw.matches.map((value, index) => {
      const match = readStrictPassiveRecord(value, ["rank", "score", "sourceOrdinal", "chunkIndex", "rowIndex", "normalizedStart", "normalizedEnd", "pageNumber"]);
      if (match.rank !== index + 1 || typeof match.score !== "number" || !Number.isFinite(match.score) || match.score < -1 || match.score > 1 ||
          !bounded(match.sourceOrdinal, 1, sources.length) || !bounded(match.chunkIndex, 0, 999)) throw new Error();
      for (const key of ["rowIndex", "normalizedStart", "normalizedEnd"] as const)
        if (key in match && !bounded(match[key], 0, Number.MAX_SAFE_INTEGER)) throw new Error();
      if ("pageNumber" in match && !bounded(match.pageNumber, 1, Number.MAX_SAFE_INTEGER)) throw new Error();
      if (("normalizedStart" in match) !== ("normalizedEnd" in match) ||
          ("normalizedStart" in match && (match.normalizedEnd as number) <= (match.normalizedStart as number))) throw new Error();
      return {rank: index + 1, score: match.score, sourceOrdinal: match.sourceOrdinal, chunkIndex: match.chunkIndex,
        ...("rowIndex" in match ? {rowIndex: match.rowIndex as number} : {}),
        ...("normalizedStart" in match ? {normalizedStart: match.normalizedStart as number, normalizedEnd: match.normalizedEnd as number} : {}),
        ...("pageNumber" in match ? {pageNumber: match.pageNumber as number} : {})};
    });
    // Structured extraction restarts chunkIndex within each row. Document
    // extractors also retain page/span coordinates. Use the entire public
    // citation location, not a source-wide chunk index that the worker never
    // promised. Rank/score cannot make an identical location distinct.
    if (new Set(matches.map(match => JSON.stringify([match.sourceOrdinal, match.chunkIndex, match.rowIndex,
      match.normalizedStart, match.normalizedEnd, match.pageNumber]))).size !== matches.length) return;
    return {queryDigest: raw.queryDigest, maximumResults: raw.maximumResults, embeddingDevice: raw.embeddingDevice,
      sources, matches, cleanupPending: raw.cleanupPending};
  } catch {return;}
}
