import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../shared";

/** Descriptive runtime facts, never resource admission, model readiness, output
 * quality, identity attestation or permission to retain/save a result. Original
 * task/workspace/source ownership must be established by the application. */
export interface ModelTrainingExecutionHistory {
  readonly schema: "model-training-execution-v1";
  readonly runId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  /** Monotonic elapsed time; wall-clock timestamps are recorded separately. */
  readonly durationMs: number;
  readonly hardware: {
    readonly devices: readonly ("cpu" | "cuda" | "mps" | "xpu" | "other")[];
    readonly precisions: readonly ("float32" | "float16" | "bfloat16" | "float64" | "int8" | "uint8" | "other")[];
    readonly logicalCpuCount: number | null;
    readonly pythonVersion: string;
    readonly pytorchVersion: string | null;
    readonly transformersVersion: string | null;
  };
  readonly interpretation: "reported-runtime-facts";
}

function exact(value: unknown, keys: readonly string[]) {
  const result = readStrictPassiveRecord(value, keys);
  if (Object.keys(result).length !== keys.length) throw new Error("Incomplete training execution history.");
  return result;
}
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // Record bound, not an execution budget.
function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}
function version(value: unknown): value is string {
  return typeof value === "string" && /^[0-9][0-9A-Za-z.+_-]{0,63}$/.test(value) && !hasKnownPassiveCredential(value);
}
function finiteChoices<T extends string>(value: unknown, choices: readonly T[]): readonly T[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > choices.length ||
    value.some(item => typeof item !== "string" || !choices.includes(item as T)) || new Set(value).size !== value.length ||
    [...value].sort().some((item, index) => item !== value[index])) return;
  return Object.freeze([...value]) as readonly T[];
}

/** Copy first; unknown fields, accessors and out-of-contract values are refused.
 * A caller may bind the decoded report to its original recorded run identity.
 * Hosts still own proxy-safe input capture and current authorization. */
export function readModelTrainingExecutionHistory(raw: unknown, expectedRunId?: string): ModelTrainingExecutionHistory | undefined {
  try {
    const value = exact(copyBoundedPassiveData(raw), ["schema", "runId", "startedAt", "completedAt", "durationMs", "hardware", "interpretation"]);
    if (value.schema !== "model-training-execution-v1" || value.interpretation !== "reported-runtime-facts" ||
      typeof value.runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.runId) || hasKnownPassiveCredential(value.runId) ||
      expectedRunId !== undefined && value.runId !== expectedRunId || !timestamp(value.startedAt) || !timestamp(value.completedAt) ||
      Date.parse(value.completedAt) < Date.parse(value.startedAt) || Date.parse(value.completedAt) - Date.parse(value.startedAt) > MAX_DURATION_MS ||
      typeof value.durationMs !== "number" || !Number.isSafeInteger(value.durationMs) || value.durationMs < 0 || value.durationMs > MAX_DURATION_MS) return;
    const hardware = exact(value.hardware, ["devices", "precisions", "logicalCpuCount", "pythonVersion", "pytorchVersion", "transformersVersion"]);
    const devices = finiteChoices(hardware.devices, ["cpu", "cuda", "mps", "xpu", "other"] as const);
    const precisions = finiteChoices(hardware.precisions, ["float32", "float16", "bfloat16", "float64", "int8", "uint8", "other"] as const);
    if (!devices || !precisions || hardware.logicalCpuCount !== null &&
      (!Number.isSafeInteger(hardware.logicalCpuCount) || (hardware.logicalCpuCount as number) < 1 || (hardware.logicalCpuCount as number) > 4096) ||
      !version(hardware.pythonVersion) || hardware.pytorchVersion !== null && !version(hardware.pytorchVersion) ||
      hardware.transformersVersion !== null && !version(hardware.transformersVersion)) return;
    return Object.freeze({schema: "model-training-execution-v1", runId: value.runId, startedAt: value.startedAt,
      completedAt: value.completedAt, durationMs: value.durationMs, interpretation: "reported-runtime-facts",
      hardware: Object.freeze({devices, precisions, logicalCpuCount: hardware.logicalCpuCount as number | null,
        pythonVersion: hardware.pythonVersion, pytorchVersion: hardware.pytorchVersion as string | null,
        transformersVersion: hardware.transformersVersion as string | null})});
  } catch {return;}
}
