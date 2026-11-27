import {createHash} from "node:crypto";
import {types} from "node:util";
import {readHeadlessModelImagePlanRequest, type HeadlessHostIncarnationId} from "../../../contracts/headless";
import {readStrictPassiveRecord} from "../../../contracts/shared";
import {snapshotBoundedImageGenerationRequest} from "../../../contracts/image-generation";
import {copyHeadlessModelWorkflowData} from "../model/headless-model-download-preview.use-case";

function wellFormed(text: string) {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

/** Private transient preparation only. The returned request contains user text:
 * never persist it in a plan, diagnostic, receipt or public metadata response.
 * Matching a digest grants no approval, current Model selection, runtime access
 * or output-import authority. Original owners must enforce those separately. */
export function prepareHeadlessImageRequest(raw: unknown, currentHost: HeadlessHostIncarnationId) {
  const invalid = {ok: false, code: "headless.invalid-request"} as const;
  const stale = {ok: false, code: "headless.stale"} as const;
  try {
    if (types.isProxy(raw)) return invalid;
    const row = readStrictPassiveRecord(raw, ["plan", "prompt", "negativePrompt"]);
    if (typeof row.prompt !== "string" || row.prompt.length > 10000 || !wellFormed(row.prompt) ||
        (Object.prototype.hasOwnProperty.call(row, "negativePrompt") &&
          (typeof row.negativePrompt !== "string" || row.negativePrompt.length > 10000 || !wellFormed(row.negativePrompt)))) return invalid;
    const parsed = readHeadlessModelImagePlanRequest(copyHeadlessModelWorkflowData(row.plan), currentHost);
    if (!parsed.ok) return parsed;
    const request = parsed.request, input = request.input;
    const hasNegative = Object.prototype.hasOwnProperty.call(row, "negativePrompt");
    const generationRequest = snapshotBoundedImageGenerationRequest({prompt: row.prompt, ...input.settings,
      ...(hasNegative ? {negativePrompt: row.negativePrompt as string} : {})});
    const digest = (text: string) => "sha256:" + createHash("sha256").update(text, "utf8").digest("hex");
    if (digest(generationRequest.prompt) !== input.promptDigest || hasNegative !== (input.negativePromptDigest !== undefined) ||
        (hasNegative && digest(generationRequest.negativePrompt!) !== input.negativePromptDigest)) return stale;
    return {ok: true, prepared: Object.freeze({plan: request, generationRequest: Object.freeze(generationRequest),
      generationApprovalRequired: true as const, outputImportApprovalRequired: true as const,
      modelSelection: "not-checked" as const, runtimeReadiness: "not-checked" as const})} as const;
  } catch {return invalid;}
}
