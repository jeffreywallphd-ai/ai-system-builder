import {copyBoundedPassiveData, readStrictPassiveRecord} from "../shared";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";
import {readHeadlessContextReadRequest, type HeadlessContextReadRequest, type HeadlessContextSettings} from "./headless-context-preview";

type PreviewInput = Extract<HeadlessContextReadRequest, {operation: "context.preview-generation"}>["input"];
export interface HeadlessContextPackPlanRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "context.generate-pack";
  readonly input: Omit<PreviewInput, "settings"> & {
    readonly idempotencyKey: string;
    readonly settings: Extract<HeadlessContextSettings, {kind: "markdown-context-pack"}>;
  };
}

export interface HeadlessContextRagPlanRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "context.generate-rag";
  readonly input: Omit<PreviewInput, "settings"> & {
    readonly idempotencyKey: string;
    readonly settings: Extract<HeadlessContextSettings, {kind: "rag-database"}>;
  };
}
export type HeadlessContextGenerationPlanRequest = HeadlessContextPackPlanRequest | HeadlessContextRagPlanRequest;

/** A concrete proposal only. The host must separately admit one approved effect. */
export function readHeadlessContextGenerationPlanRequest(value: unknown, host: HeadlessHostIncarnationId) {
  const invalid = {ok: false, code: "headless.invalid-request"} as const;
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION ||
        (outer.operation !== "context.generate-pack" && outer.operation !== "context.generate-rag")) return invalid;
    const raw = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "idempotencyKey", "name", "sources", "settings"]);
    const {idempotencyKey, ...input} = raw;
    if (!isHeadlessHostIncarnationId(idempotencyKey)) return invalid;
    const parsed = readHeadlessContextReadRequest({version: outer.version, operation: "context.preview-generation", input}, host);
    if (!parsed.ok) return parsed;
    if (parsed.request.operation !== "context.preview-generation") return invalid;
    if (outer.operation === "context.generate-pack" && parsed.request.input.settings.kind === "markdown-context-pack")
      return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: outer.operation,
        input: {...parsed.request.input, settings: parsed.request.input.settings, idempotencyKey}} satisfies HeadlessContextPackPlanRequest} as const;
    if (outer.operation === "context.generate-rag" && parsed.request.input.settings.kind === "rag-database")
      return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: outer.operation,
        input: {...parsed.request.input, settings: parsed.request.input.settings, idempotencyKey}} satisfies HeadlessContextRagPlanRequest} as const;
    return invalid;
  } catch {return invalid;}
}

/** Preserve the narrower legacy decoder and its pack-only authority. */
export function readHeadlessContextPackPlanRequest(value: unknown, host: HeadlessHostIncarnationId) {
  const result = readHeadlessContextGenerationPlanRequest(value, host);
  if (!result.ok) return result;
  return result.request.operation === "context.generate-pack"
    ? {ok: true, request: result.request} as const : {ok: false, code: "headless.invalid-request"} as const;
}
