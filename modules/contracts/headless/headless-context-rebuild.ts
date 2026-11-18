import {copyBoundedPassiveData, readStrictPassiveRecord} from "../shared";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";
import {readHeadlessSavedContextReference, type HeadlessSavedContextReference} from "./headless-context-result-plan";
import {readHeadlessContextReadRequest, readHeadlessContextPreview, type HeadlessContextPreview} from "./headless-context-preview";

export interface HeadlessContextRebuildRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "context.preview-rebuild";
  readonly input: {readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId;
    readonly reference: HeadlessSavedContextReference};
}
export interface HeadlessContextRebuildValue {
  readonly reference: HeadlessSavedContextReference;
  readonly preview: HeadlessContextPreview;
  readonly byteAvailability: "not-checked";
}

export function readHeadlessContextRebuildRequest(value: unknown, host: HeadlessHostIncarnationId) {
  const invalid = {ok: false, code: "headless.invalid-request"} as const;
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "context.preview-rebuild") return invalid;
    const raw = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "reference"]);
    if (!isHeadlessHostIncarnationId(host) || !isHeadlessHostIncarnationId(raw.hostIncarnationId) || !isWorkspaceId(raw.workspaceId)) return invalid;
    const reference = readHeadlessSavedContextReference(raw.reference, raw.workspaceId);
    if (!reference) return invalid;
    if (raw.hostIncarnationId !== host) return {ok: false, code: "headless.host-changed"} as const;
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: "context.preview-rebuild",
      input: {hostIncarnationId: host, workspaceId: raw.workspaceId, reference}} satisfies HeadlessContextRebuildRequest} as const;
  } catch {return invalid;}
}

export function readHeadlessContextRebuildValue(value: unknown, target: HeadlessContextRebuildRequest["input"]): HeadlessContextRebuildValue | undefined {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["reference", "preview", "byteAvailability"]);
    const reference = readHeadlessSavedContextReference(raw.reference, target.workspaceId);
    if (!reference || !Object.entries(target.reference).every(([key, item]) => reference[key as keyof HeadlessSavedContextReference] === item) ||
        raw.byteAvailability !== "not-checked") return;
    const candidate = readStrictPassiveRecord(raw.preview, ["workspaceId", "name", "sources", "settings", "totalBytes",
      "runtimeReadiness", "approvalRequired", "reviewRequired", "modelCalls", "externalProviderCalls"]);
    if (!Array.isArray(candidate.sources)) return;
    const parsed = readHeadlessContextReadRequest({version: HEADLESS_CONTRACT_VERSION, operation: "context.preview-generation", input: {
      hostIncarnationId: target.hostIncarnationId, workspaceId: target.workspaceId, name: candidate.name,
      sources: candidate.sources.map(source => readStrictPassiveRecord(source,
        ["reference", "digest", "sizeBytes", "format", "licenseStatus"]).reference), settings: candidate.settings,
    }}, target.hostIncarnationId);
    if (!parsed.ok || parsed.request.operation !== "context.preview-generation" || parsed.request.input.settings.kind !== reference.kind) return;
    const preview = readHeadlessContextPreview(candidate, parsed.request.input);
    return preview ? {reference, preview, byteAvailability: "not-checked"} : undefined;
  } catch {return;}
}
