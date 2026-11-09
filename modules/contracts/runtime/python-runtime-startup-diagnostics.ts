export const PYTHON_STARTUP_STAGES = [
  "probe-context-dependencies", "install-context-dependencies", "verify-context-dependencies",
  "inspect-environment", "probe-pip", "probe-write-access", "detect-accelerator-nvidia",
  "detect-accelerator-rocm", "probe-torch", "probe-network", "probe-worker-dependencies",
  "install-worker-dependencies", "probe-model-training-dependencies", "install-model-training-dependencies",
  "verify-model-training-dependencies", "install-torch", "verify-torch", "other",
] as const;
export const PYTHON_STARTUP_REASONS = ["none", "composition-failed", "preparation-failed", "unsupported-platform",
  "unsupported-python", "probe-failed", "install-failed", "install-timeout", "verification-failed",
  "launch-failed", "health-failed", "startup-failed", "attempt-retired"] as const;
export type PythonStartupPhase = "none" | "composition" | "context" | "worker" | "launch" | "health";
export interface PythonRuntimeStartupDiagnostics {
  readonly schemaVersion: "1";
  readonly attempt: number;
  readonly outcome: "not-observed" | "starting" | "ready" | "failed" | "retired";
  readonly phase: PythonStartupPhase;
  readonly reason: typeof PYTHON_STARTUP_REASONS[number];
  readonly pythonVersion?: string;
  readonly stagesTruncated?: boolean;
  readonly dependencies: readonly { readonly name: "huggingface_hub" | "transformers"; readonly version?: string | null;
    readonly expectedVersion?: string; readonly comparison?: "unknown" | "missing" | "match" | "mismatch" }[];
  readonly stages: readonly { readonly operation: "context" | "worker"; readonly stage: typeof PYTHON_STARTUP_STAGES[number];
    readonly sequence: number; readonly phase: "entered" | "returned" | "threw" }[];
}
function data(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.some(k => typeof k !== "string" || ![...required, ...optional].includes(k)) || required.some(k => !Object.prototype.hasOwnProperty.call(descriptors, k))) return;
  const result: Record<string, unknown> = {};
  for (const key of keys as string[]) { const d = descriptors[key]!; if (!("value" in d)) return; result[key] = d.value; }
  return result;
}
function items(value: unknown, limit: number): unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return;
  const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as Record<PropertyKey, PropertyDescriptor>;
  const length = descriptors.length?.value;
  if (!Number.isInteger(length) || length < 0 || length > limit || Reflect.ownKeys(descriptors).length !== length + 1) return;
  const result = [];
  for (let i = 0; i < length; i++) { const d = descriptors[String(i)]; if (!d || !("value" in d)) return; result.push(d.value); }
  return result;
}
export function readPythonStartupVersion(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 48 && /^\d{1,4}(?:\.\d{1,4}){1,3}(?:(?:a|b|rc|\.post|\.dev)\d{1,6})?(?:\+(?:cpu|cu\d{2,4}))?$/.test(value) ? value : undefined;
}
/** Strict optional projection. Invalid diagnostics never invalidate core status. */
export function normalizePythonRuntimeStartupDiagnostics(value: unknown): PythonRuntimeStartupDiagnostics | undefined {
  try {
    const row = data(value, ["schemaVersion", "attempt", "outcome", "phase", "reason", "dependencies", "stages"], ["pythonVersion", "stagesTruncated"]);
    const dependencyRows = items(row?.dependencies, 2), stageRows = items(row?.stages, 64);
    if (!row || row.schemaVersion !== "1" || !Number.isSafeInteger(row.attempt) || (row.attempt as number) < 0 ||
      !["not-observed", "starting", "ready", "failed", "retired"].includes(row.outcome as string) ||
      !["none", "composition", "context", "worker", "launch", "health"].includes(row.phase as string) ||
      !PYTHON_STARTUP_REASONS.includes(row.reason as any) ||
      (row.pythonVersion !== undefined && !readPythonStartupVersion(row.pythonVersion)) ||
      (row.stagesTruncated !== undefined && typeof row.stagesTruncated !== "boolean") ||
      !dependencyRows || !stageRows) return;
    if ((row.outcome === "failed" && ["none", "attempt-retired"].includes(row.reason as string)) ||
      (row.outcome === "retired" && row.reason !== "attempt-retired") ||
      (!["failed", "retired"].includes(row.outcome as string) && row.reason !== "none") ||
      (row.outcome === "not-observed" && (row.attempt !== 0 || row.phase !== "none" || row.pythonVersion !== undefined || dependencyRows.length || stageRows.length)) ||
      (row.attempt === 0 && row.outcome !== "not-observed" && !(row.outcome === "failed" && row.phase === "composition" && row.reason === "composition-failed"))) return;
    const names = new Set<string>(), dependencies: PythonRuntimeStartupDiagnostics["dependencies"][number][] = [];
    for (const item of dependencyRows) {
      const d = data(item, ["name"], ["version", "expectedVersion", "comparison"]);
      if (!d || !["huggingface_hub", "transformers"].includes(d.name as string) || names.has(d.name as string) ||
        (d.version !== undefined && d.version !== null && !readPythonStartupVersion(d.version))) return;
      names.add(d.name as string);
      const expectedVersion = d.name === "huggingface_hub" ? "0.31.4" : "4.51.3";
      const comparison = d.version === undefined ? "unknown" : d.version === null ? "missing" : d.version === expectedVersion ? "match" : "mismatch";
      if ((d.expectedVersion !== undefined && d.expectedVersion !== expectedVersion) || (d.comparison !== undefined && d.comparison !== comparison)) return;
      dependencies.push(Object.freeze({ name: d.name as any, ...(d.version !== undefined ? { version: d.version as string | null } : {}), expectedVersion, comparison }));
    }
    const stages: PythonRuntimeStartupDiagnostics["stages"][number][] = [];
    for (const item of stageRows) {
      const s = data(item, ["operation", "stage", "sequence", "phase"]);
      if (!s || !["context", "worker"].includes(s.operation as string) || !PYTHON_STARTUP_STAGES.includes(s.stage as any) ||
        !Number.isInteger(s.sequence) || (s.sequence as number) < 1 || (s.sequence as number) > 64 ||
        !["entered", "returned", "threw"].includes(s.phase as string) ||
        (s.operation === "context") !== (s.stage as string).includes("context-dependencies")) return;
      stages.push(Object.freeze({ operation: s.operation as any, stage: s.stage as any, sequence: s.sequence as number, phase: s.phase as any }));
    }
    return Object.freeze({ schemaVersion: "1", attempt: row.attempt as number, outcome: row.outcome as any,
      phase: row.phase as PythonStartupPhase, reason: row.reason as any,
      ...(row.pythonVersion !== undefined ? { pythonVersion: row.pythonVersion as string } : {}),
      ...(row.stagesTruncated !== undefined ? { stagesTruncated: row.stagesTruncated as boolean } : {}),
      dependencies: Object.freeze(dependencies), stages: Object.freeze(stages) });
  } catch { return undefined; }
}
export function serializePythonRuntimeStartupDiagnostics(value: unknown): string | undefined {
  const report = normalizePythonRuntimeStartupDiagnostics(value);
  if (!report) return;
  const text = JSON.stringify(report, null, 2);
  return new TextEncoder().encode(text).byteLength <= 16 * 1024 ? text : undefined;
}
/** Optional status field failures cannot invalidate otherwise usable status. */
export function readPythonRuntimeStartupDiagnosticsProperty(value: unknown): PythonRuntimeStartupDiagnostics | undefined {
  try { return normalizePythonRuntimeStartupDiagnostics(Object.getOwnPropertyDescriptor(value, "startupDiagnostics")?.value); }
  catch { return undefined; }
}
