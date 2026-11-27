import {snapshotBoundedImageGenerationRequest, type ImageGenerationRequest} from "../image-generation";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../shared";
import {isWorkspaceId, type WorkspaceId} from "../workspace";
import {isHeadlessModelRecordId, isHeadlessModelTimestamp} from "./headless-model-metadata";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";

/** Explicit text-to-image settings. Existing image-contract ceilings are syntax
 * bounds, not proof that a particular runtime or machine can admit the work. */
export interface HeadlessModelImageSettings {
  readonly width: number;
  readonly height: number;
  readonly steps: number;
  readonly cfg: number;
  readonly seed: number;
  readonly numImages: number;
  readonly denoise?: number;
  readonly sampler?: string;
  readonly scheduler?: string;
}

/** Standalone intent data only. No public plan family, runtime dispatch, file
 * import or approval is enabled by decoding this object. Prompt text is supplied
 * transiently to a future owner, which must independently match these digests. */
export interface HeadlessModelImagePlanRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "models.generate-image";
  readonly input: {
    readonly hostIncarnationId: HeadlessHostIncarnationId;
    readonly workspaceId: WorkspaceId;
    readonly idempotencyKey: string;
    readonly name: string;
    readonly model: {readonly modelRecordId: string; readonly updatedAt: string};
    readonly promptDigest: string;
    readonly negativePromptDigest?: string;
    readonly settings: HeadlessModelImageSettings;
  };
}

const invalid = {ok: false, code: "headless.invalid-request"} as const;
const digest = (value: unknown): value is string => typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
const credential = (value: string) => hasKnownPassiveCredential(value) || /\bbearer\s+\S+/i.test(value);
const requiredSettings = ["width", "height", "steps", "cfg", "seed", "numImages"] as const;
const optionalSettings = ["denoise", "sampler", "scheduler"] as const;

function record(value: unknown, required: readonly string[], optional: readonly string[] = []) {
  const row = readStrictPassiveRecord(value, [...required, ...optional]);
  if (required.some(key => !Object.prototype.hasOwnProperty.call(row, key))) throw new Error("Incomplete image intent.");
  return row;
}

export function readHeadlessModelImageSettings(value: unknown): HeadlessModelImageSettings | undefined {
  try {
    const row = record(copyBoundedPassiveData(value), requiredSettings, optionalSettings);
    if (requiredSettings.some(key => typeof row[key] !== "number") ||
        ("denoise" in row && typeof row.denoise !== "number")) return;
    for (const key of ["sampler", "scheduler"] as const) {
      if (key in row && (typeof row[key] !== "string" || row[key].length > 128 ||
          !/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(row[key]) || row[key] !== row[key].trim() ||
          credential(row[key]))) return;
    }
    // Reuse the headed request's numeric ceilings without handling any prompt.
    // The literal is validation-only and cannot initiate a runtime operation.
    snapshotBoundedImageGenerationRequest({prompt: "Image settings validation", ...row} as ImageGenerationRequest);
    const settings = Object.fromEntries([...requiredSettings, ...optionalSettings]
      .filter(key => Object.prototype.hasOwnProperty.call(row, key))
      .map(key => [key, typeof row[key] === "number" && row[key] === 0 ? 0 : row[key]]));
    return Object.freeze(settings) as unknown as HeadlessModelImageSettings;
  } catch {return;}
}

export function readHeadlessModelImagePlanRequest(value: unknown, currentHost: HeadlessHostIncarnationId) {
  try {
    const outer = record(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "models.generate-image") return invalid;
    const input = record(outer.input, ["hostIncarnationId", "workspaceId", "idempotencyKey", "name", "model", "promptDigest", "settings"],
      ["negativePromptDigest"]);
    const model = record(input.model, ["modelRecordId", "updatedAt"]);
    if (!isHeadlessHostIncarnationId(currentHost) || !isHeadlessHostIncarnationId(input.hostIncarnationId) ||
        !isWorkspaceId(input.workspaceId) || !isHeadlessHostIncarnationId(input.idempotencyKey) ||
        !isHeadlessModelRecordId(model.modelRecordId) || !isHeadlessModelTimestamp(model.updatedAt) ||
        typeof input.name !== "string" || input.name !== input.name.trim() ||
        !/^[\p{L}\p{N}][\p{L}\p{N} ._()'-]{0,159}$/u.test(input.name) || credential(input.name) ||
        !digest(input.promptDigest) || ("negativePromptDigest" in input && !digest(input.negativePromptDigest))) return invalid;
    const settings = readHeadlessModelImageSettings(input.settings);
    if (!settings) return invalid;
    if (input.hostIncarnationId !== currentHost) return {ok: false, code: "headless.host-changed"} as const;
    const request = Object.freeze({version: HEADLESS_CONTRACT_VERSION, operation: "models.generate-image",
      input: Object.freeze({hostIncarnationId: currentHost, workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey,
        name: input.name, model: Object.freeze({modelRecordId: model.modelRecordId, updatedAt: model.updatedAt}),
        promptDigest: input.promptDigest, ...(typeof input.negativePromptDigest === "string" ? {negativePromptDigest: input.negativePromptDigest} : {}),
        settings})}) satisfies HeadlessModelImagePlanRequest;
    return {ok: true, request} as const;
  } catch {return invalid;}
}
