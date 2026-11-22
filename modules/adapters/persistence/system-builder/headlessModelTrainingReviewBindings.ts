import {createHash} from "node:crypto";
import {copyHeadlessModelWorkflowData} from "../../../application/use-cases/model/headless-model-download-preview.use-case";
import {canonicalHeadlessModelTrainingInputs} from "../../../application/use-cases/model/headless-model-training-plan.use-case";
import {HEADLESS_MAX_BUILD_PLAN_STEPS, readHeadlessModelTrainingInputsValue, readHeadlessModelTrainingPlanRequest,
  type HeadlessBuildPlanRequest, type HeadlessModelTrainingInputsValue} from "../../../contracts/headless";
import {readStrictPassiveRecord} from "../../../contracts/shared";

/** Minimized recorded metadata only. No input-byte, runtime, resource, license,
 * quality, approval or task authority follows from a stored binding. */
export interface ModelTrainingReviewBinding {
  readonly step: number;
  readonly inputs: HeadlessModelTrainingInputsValue;
  readonly proposalDigest: string;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
}
/** The original metadata owner picked these columns, then appended updatedAt
 * and defaulted missing tags. Recognize only its two complete encodings, never
 * permutations or omitted facts. An absent legacy tag column produced [] only. */
function legacyInputs(inputs: HeadlessModelTrainingInputsValue, tagsPresent: boolean): HeadlessModelTrainingInputsValue {
  const names: (keyof HeadlessModelTrainingInputsValue["model"])[] = ["modelRecordId", "source", "lifecycleStatus", "artifactForm",
    "provider", "modelId", "inferenceMode", "serializationFormat", ...(tagsPresent ? ["taskTags" as const] : []),
    "sizeBytes", "parameterCount", "updatedAt", ...(!tagsPresent ? ["taskTags" as const] : [])];
  const model = Object.fromEntries(names.filter(name => Object.prototype.hasOwnProperty.call(inputs.model, name))
    .map(name => [name, inputs.model[name]])) as unknown as HeadlessModelTrainingInputsValue["model"];
  return {...inputs, model};
}

/** Match every training step in order and recompute the original compiler's
 * request-plus-inputs digest. Caller policy and original-target binding remain
 * mandatory; inline proposal data cannot supply this trusted witness. */
export function readModelTrainingReviewBindings(value: unknown,
  requests: readonly HeadlessBuildPlanRequest[]): readonly ModelTrainingReviewBinding[] | undefined {
  try {
    const copied = copyHeadlessModelWorkflowData(requests) as HeadlessBuildPlanRequest[];
    if (!Array.isArray(copied) || copied.length < 1 || copied.length > HEADLESS_MAX_BUILD_PLAN_STEPS) return;
    const expected = copied.flatMap((request, index) => request.operation === "models.train" ? [{request, step: index + 1}] : []);
    const rows = copyHeadlessModelWorkflowData(value);
    if (!expected.length || !Array.isArray(rows) || rows.length !== expected.length) return;
    return Object.freeze(expected.map(({request, step}, index) => {
      const parsed = readHeadlessModelTrainingPlanRequest(request, request.input.hostIncarnationId);
      if (!parsed.ok) throw new Error("Training review metadata is unavailable.");
      const row = readStrictPassiveRecord(rows[index], ["step", "inputs", "proposalDigest"]);
      const inputs = readHeadlessModelTrainingInputsValue(row.inputs, parsed.request.input);
      if (Object.keys(row).length !== 3 || row.step !== step || !inputs) throw new Error("Training review metadata is unavailable.");
      // Preserve unchanged legacy raw records. For storage that reorders JSON
      // members, try the fixed new encoding and the two actual legacy producer
      // encodings. Every candidate includes all facts and needs an exact hash.
      const candidates = [inputs, canonicalHeadlessModelTrainingInputs(inputs), legacyInputs(inputs, true),
        ...(inputs.model.taskTags.length === 0 ? [legacyInputs(inputs, false)] : [])];
      const matched = candidates.find(candidate => row.proposalDigest === "sha256:" + createHash("sha256")
        .update(JSON.stringify({request: parsed.request, inputs: candidate})).digest("hex"));
      if (!matched) throw new Error("Training review metadata is unavailable.");
      // Retain the matched representation so existing task input hashes replay.
      return freeze({step, inputs: matched, proposalDigest: row.proposalDigest as string});
    }));
  } catch {return;}
}
