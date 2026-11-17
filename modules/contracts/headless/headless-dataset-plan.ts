import {copyBoundedPassiveData, readStrictPassiveRecord} from "../shared";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId} from "./headless-protocol";
import {readHeadlessDatasetPreparationRequest, type HeadlessDatasetPreparationRequest} from "./headless-dataset-preparation";

export interface HeadlessLocalDatasetPlanRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "data.prepare-local-dataset";
  readonly input: HeadlessDatasetPreparationRequest["input"] & {readonly idempotencyKey: string};
}

/** An exact concrete proposal, never an execution permission or a runtime ID. */
export function readHeadlessLocalDatasetPlanRequest(value: unknown, host: HeadlessHostIncarnationId):
  {readonly ok: true; readonly request: HeadlessLocalDatasetPlanRequest} |
  {readonly ok: false; readonly code: "headless.invalid-request" | "headless.host-changed"} {
  const invalid = {ok: false, code: "headless.invalid-request"} as const;
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "data.prepare-local-dataset") return invalid;
    const raw = readStrictPassiveRecord(outer.input, ["hostIncarnationId", "workspaceId", "idempotencyKey", "sources", "recipe", "split", "qualityPreset"]);
    const {idempotencyKey, ...input} = raw;
    if (!isHeadlessHostIncarnationId(idempotencyKey)) return invalid;
    const parsed = readHeadlessDatasetPreparationRequest({version: outer.version, operation: "data.preview-dataset-preparation", input}, host);
    if (!parsed.ok) return parsed;
    return {ok: true, request: {version: HEADLESS_CONTRACT_VERSION, operation: "data.prepare-local-dataset",
      input: {...parsed.request.input, idempotencyKey}}};
  } catch {return invalid;}
}
