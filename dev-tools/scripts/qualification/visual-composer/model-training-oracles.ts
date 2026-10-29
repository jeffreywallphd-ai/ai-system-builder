import { types } from "node:util";
import { createHash } from "node:crypto";

export const TRAINING_HOST_TIMEOUT_MS = 10 * 60_000;
export const TRAINING_HOST_PHASE_TIMEOUT_MS = 120_000;
export const TRAINING_WORKSPACE_NAME = "Training qualification";
export const TRAINING_OUTPUT_NAME = "training-host-support-adapter";
export const TRAINING_DISPLAY_NAME = "Training host support adapter";
export const TRAINING_HOST_PHASES = Object.freeze([
  "workspace-and-inputs-visible", "configuration-bounded", "training-accepted",
  "private-review-pending", "candidate-unregistered", "explicit-save-completed",
  "record-reopened", "renderer-reload-preserved-record",
] as const);
const invalid = () => new Error("The fixed training host test input is unavailable or invalid.");

function denseStrings(input: unknown, maximum: number): string[] {
  if (types.isProxy(input) || !Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > maximum) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1) throw invalid();
  const values: string[] = [];
  for (let i = 0; i < input.length; i++) {
    const item = descriptors[String(i)];
    if (!item || !("value" in item) || typeof item.value !== "string" || item.value.length > 192) throw invalid();
    values.push(item.value);
  }
  return values;
}
export function trainingPublicId(input: unknown): string {
  if (typeof input !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{3,191}$/.test(input)) throw invalid();
  return input;
}
export function trainingWorkspaceId(run: unknown): string {
  if (typeof run !== "string" || !/^[a-z0-9-]{20,80}$/.test(run)) throw invalid();
  return `workspace.training-host.${createHash("sha256").update(`${run}\0training-host-v1`).digest("hex").slice(0, 16)}`;
}
export function trainingDatasetIds(run: unknown): readonly [string, string] {
  const workspace = trainingWorkspaceId(run);
  return Object.freeze([`workspaces/${workspace}/artifacts/files/training-host-train.jsonl`,
    `workspaces/${workspace}/artifacts/files/training-host-validation.jsonl`]);
}
export interface TrainingHostFixture {
  readonly schemaVersion: "training-host-fixture-v1";
  readonly runId: string;
  readonly sourceRevision: string;
  readonly workspaceId: string;
  readonly baseModelRecordId: string;
  readonly datasetArtifactIds: readonly string[];
  readonly outputName: typeof TRAINING_OUTPUT_NAME;
  readonly displayName: typeof TRAINING_DISPLAY_NAME;
}
/** Only the trusted prelaunch seed produces this declaration. It grants no launch authority. */
export function captureTrainingHostFixture(input: unknown, run: unknown, source: unknown): Readonly<TrainingHostFixture> | undefined {
  if (input === undefined || input === "") return undefined;
  if (typeof run !== "string" || !/^[a-z0-9-]{20,80}$/.test(run) || typeof source !== "string" || !/^source\.[a-f0-9]{64}$/.test(source) ||
      typeof input !== "string" || Buffer.byteLength(input) > 4096) throw invalid();
  let raw: unknown;
  try { raw = JSON.parse(input); } catch { throw invalid(); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid();
  const keys = ["schemaVersion", "runId", "sourceRevision", "workspaceId", "baseModelRecordId", "datasetArtifactIds", "outputName", "displayName"];
  if (Object.keys(raw).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(raw, key))) throw invalid();
  const v = raw as Record<string, unknown>, datasets = denseStrings(v.datasetArtifactIds, 2);
  const expectedDatasets = trainingDatasetIds(run);
  if (v.schemaVersion !== "training-host-fixture-v1" || v.runId !== run || v.sourceRevision !== source ||
      v.workspaceId !== trainingWorkspaceId(run) ||
      datasets.length !== 2 || datasets.some((value, index) => value !== expectedDatasets[index]) || v.outputName !== TRAINING_OUTPUT_NAME || v.displayName !== TRAINING_DISPLAY_NAME) throw invalid();
  const base = trainingPublicId(v.baseModelRecordId);
  return Object.freeze({ schemaVersion: "training-host-fixture-v1", runId: run, sourceRevision: source, workspaceId: trainingWorkspaceId(run),
    baseModelRecordId: base, datasetArtifactIds: Object.freeze(datasets), outputName: TRAINING_OUTPUT_NAME, displayName: TRAINING_DISPLAY_NAME });
}
export function trainingHostReport(phases: readonly string[], failed: boolean) {
  const captured = denseStrings(phases, TRAINING_HOST_PHASES.length);
  if (typeof failed !== "boolean" || captured.some((phase, i) => phase !== TRAINING_HOST_PHASES[i])) throw invalid();
  return { schemaVersion: "training-host-ui-outcome-v1", host: "packaged-desktop", status: !failed && captured.length === TRAINING_HOST_PHASES.length ? "passed" : "failed",
    phases: captured, nextPhase: TRAINING_HOST_PHASES[captured.length] ?? "complete", parentQualificationGranted: false,
    scope: "Actual Train, private review, explicit Save and reopened record. No accuracy, native race, resource-budget or parent qualification." };
}
