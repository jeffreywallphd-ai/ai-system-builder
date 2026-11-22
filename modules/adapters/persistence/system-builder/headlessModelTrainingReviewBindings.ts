import {createHash} from "node:crypto";
import {copyHeadlessModelWorkflowData} from "../../../application/use-cases/model/headless-model-download-preview.use-case";
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
      const proposalDigest = "sha256:" + createHash("sha256").update(JSON.stringify({request: parsed.request, inputs})).digest("hex");
      if (row.proposalDigest !== proposalDigest) throw new Error("Training review metadata is unavailable.");
      return freeze({step, inputs, proposalDigest});
    }));
  } catch {return;}
}
