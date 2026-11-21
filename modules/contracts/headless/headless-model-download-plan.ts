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
function readSourceManifest(value: unknown) {
  const manifest = readStrictPassiveRecord(value, ["source", "manifestDigest"]);
  if (typeof manifest.manifestDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(manifest.manifestDigest))
    throw new Error("Invalid Model source manifest.");
  const raw = readStrictPassiveRecord(manifest.source, ["provider", "modelId", "revision", "format", "license", "files", "totalBytes",
    "excludedFileCount", "sourceVerification", "bytesVerification", "runtimeReadiness"]);
  if (typeof raw.modelId !== "string" || typeof raw.revision !== "string") throw new Error("Invalid Model source identity.");
  return {source: readModelDownloadSource(raw, {provider: "huggingface", modelId: raw.modelId, revision: raw.revision}), manifestDigest: manifest.manifestDigest};
}
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
    const manifest = readSourceManifest(input.sourceManifest), source = manifest.source;
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

/** A NEW metadata-save proposal, never a download grant or current-file proof.
 * The host must bind this exact manifest to the accepted original cached task. */
export interface HeadlessModelReferenceSavePlanRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "models.save-download";
  readonly input: {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId;
    readonly idempotencyKey: string; readonly name: string; readonly taskId: string;
    readonly sourceManifest: HeadlessModelDownloadPlanRequest["input"]["sourceManifest"]};
}
export interface HeadlessSavedModelReference {
  readonly workspaceId: WorkspaceId;
  readonly modelRecordId: string;
  readonly taskId: string;
  readonly manifestDigest: string;
  readonly storageAuthority: "reference-only";
  readonly runtimeReadiness: "not-checked";
}
export function readHeadlessModelReferenceSavePlanRequest(value: unknown, host: HeadlessHostIncarnationId) {
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "models.save-download" || !isHeadlessHostIncarnationId(host)) return invalid;
    const input = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "idempotencyKey", "name", "taskId", "sourceManifest"]);
    if (!isHeadlessHostIncarnationId(input.hostIncarnationId) || !isWorkspaceId(input.workspaceId) ||
        !isHeadlessHostIncarnationId(input.idempotencyKey) || !isHeadlessHostIncarnationId(input.taskId) ||
        typeof input.name !== "string" || !input.name || input.name !== input.name.trim() || input.name.length > 160 ||
        /[\x00-\x1f\x7f]/.test(input.name) || hasKnownPassiveCredential(input.name) ||
        /\b(?:token|secret|password|api[_-]?key|authorization)\s*[:=]/i.test(input.name)) return invalid;
    const sourceManifest = readSourceManifest(input.sourceManifest);
    if (input.hostIncarnationId !== host) return {ok: false, code: "headless.host-changed"} as const;
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: "models.save-download", input: {
      hostIncarnationId: host, workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey,
      name: input.name, taskId: input.taskId, sourceManifest}} satisfies HeadlessModelReferenceSavePlanRequest} as const;
  } catch {return invalid;}
}
export function readHeadlessSavedModelReference(value: unknown, workspaceId: WorkspaceId): HeadlessSavedModelReference | undefined {
  try {
    const row = readStrictPassiveRecord(copyBoundedPassiveData(value),
      ["workspaceId", "modelRecordId", "taskId", "manifestDigest", "storageAuthority", "runtimeReadiness"]);
    if (row.workspaceId !== workspaceId || typeof row.modelRecordId !== "string" || !/^model_headless_[a-f0-9]{32}$/.test(row.modelRecordId) ||
        !isHeadlessHostIncarnationId(row.taskId) || typeof row.manifestDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(row.manifestDigest) ||
        row.storageAuthority !== "reference-only" || row.runtimeReadiness !== "not-checked") return;
    return {workspaceId, modelRecordId: row.modelRecordId, taskId: row.taskId, manifestDigest: row.manifestDigest,
      storageAuthority: "reference-only", runtimeReadiness: "not-checked"};
  } catch {return;}
}
