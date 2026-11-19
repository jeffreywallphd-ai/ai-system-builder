import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../shared";
import {readModelDownloadSource, MODEL_INFERENCE_MODES, type ModelDownloadSource, type ModelInferenceMode} from "../model";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";

/** Proposal data only. Provider revalidation and exact human approval are separate. */
export interface HeadlessModelDownloadPlanRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "models.download";
  readonly input: {
    readonly hostIncarnationId: HeadlessHostIncarnationId;
    readonly workspaceId: WorkspaceId;
    readonly idempotencyKey: string;
    readonly name: string;
    readonly sourceManifest: {readonly source: ModelDownloadSource; readonly manifestDigest: string};
    readonly allowedOrigins: readonly string[];
    readonly maximumDurationSeconds: number;
    readonly inferenceMode?: ModelInferenceMode;
  };
}
const invalid = {ok: false, code: "headless.invalid-request"} as const;
export function readHeadlessModelDownloadPlanRequest(value: unknown, host: HeadlessHostIncarnationId) {
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "models.download" || !isHeadlessHostIncarnationId(host)) return invalid;
    const input = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "idempotencyKey", "name",
      "sourceManifest", "allowedOrigins", "maximumDurationSeconds", "inferenceMode"]);
    if (!isHeadlessHostIncarnationId(input.hostIncarnationId) || !isWorkspaceId(input.workspaceId) ||
        !isHeadlessHostIncarnationId(input.idempotencyKey) || typeof input.name !== "string" || !input.name ||
        input.name !== input.name.trim() || input.name.length > 120 || /[\u0000-\u001f\u007f]/.test(input.name) || hasKnownPassiveCredential(input.name) ||
        /\b(?:token|secret|password|api[_-]?key|authorization)\s*[:=]/i.test(input.name) ||
        !Number.isSafeInteger(input.maximumDurationSeconds) || (input.maximumDurationSeconds as number) < 1 ||
        (input.maximumDurationSeconds as number) > 3600 || !Array.isArray(input.allowedOrigins) || input.allowedOrigins.length < 1 ||
        input.allowedOrigins.length > 4) return invalid;
    const origins = input.allowedOrigins.map(raw => {
      if (typeof raw !== "string" || raw.length > 253 || !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(raw) ||
          hasKnownPassiveCredential(raw)) throw new Error("Invalid transfer origin.");
      const url = new URL(raw);
      if (url.origin !== raw || !url.hostname.includes(".") || url.hostname.includes("..") ||
          /^[0-9.]+$/.test(url.hostname) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname))
        throw new Error("Invalid transfer origin.");
      return raw;
    });
    if (!origins.includes("https://huggingface.co") || new Set(origins).size !== origins.length) return invalid;
    const manifest = readStrictPassiveRecord(input.sourceManifest, ["source", "manifestDigest"]);
    if (typeof manifest.manifestDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(manifest.manifestDigest)) return invalid;
    const raw = readStrictPassiveRecord(manifest.source, ["provider", "modelId", "revision", "format", "license", "files", "totalBytes",
      "excludedFileCount", "sourceVerification", "bytesVerification", "runtimeReadiness"]);
    if (typeof raw.modelId !== "string" || typeof raw.revision !== "string") return invalid;
    const source = readModelDownloadSource(raw, {provider: "huggingface", modelId: raw.modelId, revision: raw.revision});
    if ("inferenceMode" in input && (typeof input.inferenceMode !== "string" ||
        !(MODEL_INFERENCE_MODES as readonly string[]).includes(input.inferenceMode))) return invalid;
    if (input.hostIncarnationId !== host) return {ok: false, code: "headless.host-changed"} as const;
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: "models.download", input: {
      hostIncarnationId: host, workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey, name: input.name,
      sourceManifest: {source, manifestDigest: manifest.manifestDigest}, allowedOrigins: origins.sort(),
      maximumDurationSeconds: input.maximumDurationSeconds as number,
      ...("inferenceMode" in input ? {inferenceMode: input.inferenceMode as ModelInferenceMode} : {}),
    }} satisfies HeadlessModelDownloadPlanRequest} as const;
  } catch {return invalid;}
}
