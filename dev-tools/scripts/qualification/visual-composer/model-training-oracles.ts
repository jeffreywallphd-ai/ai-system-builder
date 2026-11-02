import { types } from "node:util";
import { createHash } from "node:crypto";
import { safeQualificationFailureType } from "./qualification-reporting";

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
export const TRAINING_CONFIGURATION_ACTIONS = Object.freeze([
  "base-model-select", "base-model-value", "dataset-check", "training-task-select", "method-select",
  "epochs", "max-steps", "batch-size", "sequence-length", "seed", "advanced-open",
  "lora-rank", "lora-alpha", "grad-accumulation", "output-name", "display-name",
  "store-local", "publish-disabled", "validation-disabled", "start-enabled",
] as const);
export type TrainingConfigurationAction = typeof TRAINING_CONFIGURATION_ACTIONS[number];
const invalid = () => new Error("The fixed training host test input is unavailable or invalid.");

const TRAINING_DIAGNOSTIC_EVENTS = ["desktop.host.feature.load.failed", "desktop.host.model.operation.failed"] as const;
const TRAINING_DIAGNOSTIC_FEATURES = ["model-registry", "runtime-task-registry", "python-runtime-foundation", "comfyui-image-runtime"] as const;
const TRAINING_DIAGNOSTIC_STAGES = ["import", "compose", "trainModel.execute", "trainModel.read", "trainModel.save", "trainModel.discard"] as const;
const TRAINING_DIAGNOSTIC_ERRORS = ["Error", "TypeError", "RangeError", "SyntaxError", "RuntimeCapabilityUnavailableError", "PythonRuntimeContextDependencyError"] as const;
const TRAINING_DIAGNOSTIC_CODES = ["unavailable", "ENOENT", "EACCES", "EPERM", "ETIMEDOUT", "MODULE_NOT_FOUND", "ERR_MODULE_NOT_FOUND", "ERR_REQUIRE_ESM",
  "MODEL_TRAINING_START_REQUEST_VALIDATION", "MODEL_TRAINING_START_RUNTIME_READINESS", "MODEL_TRAINING_START_BASE_MODEL",
  "MODEL_TRAINING_START_DATASET_RESOLUTION", "MODEL_TRAINING_START_TASK_DISPATCH", "MODEL_TRAINING_START_TASK_REGISTRATION"] as const;
type TrainingRuntimeFailureReport = Readonly<{
  schemaVersion: "training-host-runtime-failures-v1";
  observations: readonly Readonly<Record<"event" | "featureKey" | "stage" | "errorName" | "errorCode", string>>[];
  overflow: boolean; malformed: boolean; incompleteLine: boolean; observerFailure: boolean; parentQualificationGranted: false;
}>;

/** Child bytes are untrusted. Keep only finite known codes, never messages or raw lines. */
export function createTrainingRuntimeFailureCollector() {
  const streams = { stdout: { decoder: new TextDecoder(), pending: "", discarding: false }, stderr: { decoder: new TextDecoder(), pending: "", discarding: false } };
  const observations: Array<TrainingRuntimeFailureReport["observations"][number]> = [];
  let inputBytes = 0, overflow = false, malformed = false, finished: TrainingRuntimeFailureReport | undefined;
  const allowed = (value: unknown, values: readonly string[], fallback: string) => typeof value === "string" && values.includes(value) ? value : fallback;
  const line = (value: string) => {
    if (!TRAINING_DIAGNOSTIC_EVENTS.some(event => value.includes(event))) return;
    try {
      const entry: unknown = JSON.parse(value);
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) { malformed = true; return; }
      const parsed = entry as Record<string, unknown>;
      if (typeof parsed.event !== "string" || !(TRAINING_DIAGNOSTIC_EVENTS as readonly string[]).includes(parsed.event)) return;
      if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) { malformed = true; return; }
      if (observations.length === 8) { overflow = true; return; }
      const data = parsed.data as Record<string, unknown>;
      observations.push(Object.freeze({ event: parsed.event,
        featureKey: allowed(data.featureKey, TRAINING_DIAGNOSTIC_FEATURES, "other"),
        stage: allowed(data.stage, TRAINING_DIAGNOSTIC_STAGES, "other"),
        errorName: allowed(data.errorName, TRAINING_DIAGNOSTIC_ERRORS, "OtherError"),
        errorCode: allowed(data.errorCode, TRAINING_DIAGNOSTIC_CODES, "other") }));
    } catch { malformed = true; }
  };
  const push = (stream: unknown, chunk: unknown) => {
    if (finished) return;
    try {
      if (stream !== "stdout" && stream !== "stderr" || types.isProxy(chunk)) { malformed = true; return; }
      let bytes: Uint8Array;
      if (typeof chunk === "string") {
        if (chunk.length > 65_536 || Buffer.byteLength(chunk) > 65_536) { overflow = true; return; }
        bytes = Buffer.from(chunk);
      } else if (Buffer.isBuffer(chunk) && Object.getPrototypeOf(chunk) === Buffer.prototype) {
        if (["length", "byteLength", "byteOffset", "buffer"].some(key => Object.getOwnPropertyDescriptor(chunk, key))) { malformed = true; return; }
        const getBytes = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")!.get!;
        const size = getBytes.call(chunk) as number;
        if (size > 65_536) { overflow = true; return; }
        bytes = chunk;
      } else { malformed = true; return; }
      inputBytes += bytes.byteLength;
      if (inputBytes > 256 * 1024) { overflow = true; return; }
      const state = streams[stream];
      for (const char of state.decoder.decode(bytes, { stream: true })) {
        if (char === "\n") {
          if (!state.discarding) line(state.pending.endsWith("\r") ? state.pending.slice(0, -1) : state.pending);
          state.pending = ""; state.discarding = false;
        } else if (!state.discarding) {
          if (state.pending.length + char.length > 4096) { state.pending = ""; state.discarding = true; overflow = true; }
          else state.pending += char;
        }
      }
    } catch { malformed = true; }
  };
  const finish = (): TrainingRuntimeFailureReport => {
    if (finished) return finished;
    let incompleteLine = false;
    for (const state of Object.values(streams)) {
      const tail = state.decoder.decode();
      if (state.pending.trim() || tail.trim() || state.discarding) incompleteLine = true;
      state.pending = "";
    }
    finished = Object.freeze({ schemaVersion: "training-host-runtime-failures-v1", observations: Object.freeze(observations.slice()), overflow, malformed, incompleteLine, observerFailure: false, parentQualificationGranted: false });
    return finished;
  };
  return Object.freeze({ push, finish });
}

type TrainingDiagnosticStream = { on(event: "data", listener: (chunk: unknown) => void): unknown; off(event: "data", listener: (chunk: unknown) => void): unknown };
export async function withTrainingRuntimeFailureDiagnostics(
  streams: { stdout?: TrainingDiagnosticStream | null; stderr?: TrainingDiagnosticStream | null },
  action: () => Promise<void>, publishFailure: (report: TrainingRuntimeFailureReport) => Promise<void>,
): Promise<void> {
  const collector = createTrainingRuntimeFailureCollector();
  const stdout = (chunk: unknown) => collector.push("stdout", chunk), stderr = (chunk: unknown) => collector.push("stderr", chunk);
  let outAttempted = false, errAttempted = false, failed = false, failure: unknown;
  const observerErrors: Error[] = [];
  try {
    if (streams.stdout) { outAttempted = true; try { streams.stdout.on("data", stdout); } catch { observerErrors.push(new Error("Training diagnostic listener registration failed.")); } }
    if (streams.stderr) { errAttempted = true; try { streams.stderr.on("data", stderr); } catch { observerErrors.push(new Error("Training diagnostic listener registration failed.")); } }
    // Observation is non-authoritative. The original owned action/shutdown must
    // still run exactly once when an optional listener cannot be registered.
    try { await action(); } catch (error) { failed = true; failure = error; }
  } finally {
    for (const [stream, listener, attempted] of [[streams.stdout, stdout, outAttempted], [streams.stderr, stderr, errAttempted]] as const) {
      if (!attempted) continue;
      try { stream?.off("data", listener); }
      catch { observerErrors.push(new Error("Training diagnostic listener cleanup failed.")); }
    }
  }
  const report = collector.finish();
  if (observerErrors.length) {
    failure = new AggregateError(failed ? [failure, ...observerErrors] : observerErrors, "Training diagnostic observation failed."); failed = true;
  }
  if (failed) {
    try { await publishFailure(observerErrors.length ? Object.freeze({ ...report, observerFailure: true }) : report); }
    catch { failure = new AggregateError([failure, new Error("Bounded training diagnostics could not be stored.")], "Training and diagnostic finalization failed."); }
  }
  if (failed) throw failure;
}

/** Closed diagnostics only. Never inspect a locator, field value or raw error text. */
export function trainingFailureDetails(phase: unknown, action: unknown, error: unknown) {
  if (typeof phase !== "string" || !(TRAINING_HOST_PHASES as readonly string[]).includes(phase) ||
      typeof action !== "string" || action !== "phase" && (phase !== "configuration-bounded" ||
        !(TRAINING_CONFIGURATION_ACTIONS as readonly string[]).includes(action))) throw invalid();
  return Object.freeze({ schemaVersion: "training-host-failure-v1", status: "failed", phase, action,
    errorType: safeQualificationFailureType(error), parentQualificationGranted: false });
}

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
  readonly schemaVersion: "training-host-fixture-v1" | "training-host-fixture-v2";
  readonly inputProfile?: "generated-tiny-qwen2-v1";
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
  const v = raw as Record<string, unknown>, tiny = v.schemaVersion === "training-host-fixture-v2";
  const keys = ["schemaVersion", "runId", "sourceRevision", "workspaceId", "baseModelRecordId", "datasetArtifactIds", "outputName", "displayName", ...(tiny ? ["inputProfile"] : [])];
  if (Object.keys(raw).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(raw, key))) throw invalid();
  const datasets = denseStrings(v.datasetArtifactIds, 2);
  const expectedDatasets = trainingDatasetIds(run);
  if ((!tiny && v.schemaVersion !== "training-host-fixture-v1") || (tiny && v.inputProfile !== "generated-tiny-qwen2-v1") || v.runId !== run || v.sourceRevision !== source ||
      v.workspaceId !== trainingWorkspaceId(run) ||
      datasets.length !== 2 || datasets.some((value, index) => value !== expectedDatasets[index]) || v.outputName !== TRAINING_OUTPUT_NAME || v.displayName !== TRAINING_DISPLAY_NAME) throw invalid();
  const base = trainingPublicId(v.baseModelRecordId);
  return Object.freeze({ schemaVersion: tiny ? "training-host-fixture-v2" : "training-host-fixture-v1", ...(tiny ? { inputProfile: "generated-tiny-qwen2-v1" as const } : {}), runId: run, sourceRevision: source, workspaceId: trainingWorkspaceId(run),
    baseModelRecordId: base, datasetArtifactIds: Object.freeze(datasets), outputName: TRAINING_OUTPUT_NAME, displayName: TRAINING_DISPLAY_NAME });
}
export function trainingBaseName(fixture: Readonly<TrainingHostFixture>): "Qualified Qwen 0.5B input" | "Generated tiny training input" {
  return fixture.schemaVersion === "training-host-fixture-v2" ? "Generated tiny training input" : "Qualified Qwen 0.5B input";
}
export function trainingHostReport(phases: readonly string[], failed: boolean, inputProfile: "approved-qwen05" | "generated-tiny-qwen2-v1" = "approved-qwen05") {
  const captured = denseStrings(phases, TRAINING_HOST_PHASES.length);
  if (typeof failed !== "boolean" || !["approved-qwen05", "generated-tiny-qwen2-v1"].includes(inputProfile) || captured.some((phase, i) => phase !== TRAINING_HOST_PHASES[i])) throw invalid();
  return { schemaVersion: "training-host-ui-outcome-v1", host: "packaged-desktop", status: !failed && captured.length === TRAINING_HOST_PHASES.length ? "passed" : "failed",
    inputProfile, phases: captured, nextPhase: TRAINING_HOST_PHASES[captured.length] ?? "complete", parentQualificationGranted: false,
    scope: "Actual Train, private review, explicit Save and reopened record. No accuracy, native race, resource-budget or parent qualification." };
}
