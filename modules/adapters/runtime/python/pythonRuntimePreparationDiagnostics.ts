import type { RuntimeExecutionDiagnostic } from "../../../contracts/runtime";

export const WORKER_PREPARATION_STAGES = Object.freeze([
  "inspect-environment", "probe-pip", "probe-write-access",
  "detect-accelerator-nvidia", "detect-accelerator-rocm", "probe-torch",
  "probe-network", "probe-worker-dependencies", "install-worker-dependencies",
  "probe-model-training-dependencies", "install-model-training-dependencies",
  "verify-model-training-dependencies", "install-torch", "verify-torch", "other",
] as const);

const CONTEXT_STAGES = [
  "probe-context-dependencies", "install-context-dependencies", "verify-context-dependencies",
] as const;
export const MAX_PREPARATION_COMMAND_OBSERVATIONS = 64;
export const MAX_PREPARATION_OBSERVERS = 16;
export type PreparationOperation = "worker" | "model-training" | "context";
export type PreparationStage = typeof WORKER_PREPARATION_STAGES[number] | typeof CONTEXT_STAGES[number];
export type PreparationBackend = "cpu" | "cuda" | "rocm";
type ObservationData = Readonly<{
  sequence: number;
  phase: "entered" | "returned" | "threw";
  backend?: PreparationBackend;
}>;

export interface PythonRuntimePreparationDiagnostic extends RuntimeExecutionDiagnostic<ObservationData> {
  readonly event: "runtime.python.dependencies.stage";
  readonly operation: PreparationOperation;
  readonly stage: PreparationStage;
  readonly data: ObservationData;
}

export type PythonRuntimePreparationObserver = (
  observation: Readonly<PythonRuntimePreparationDiagnostic>,
) => unknown;

/** Keep inherited or explicit child-environment values private to one setup. */
export function snapshotPreparationEnvironment(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.freeze({ ...(env ?? process.env) });
}

function validStage(operation: unknown, stage: unknown, backend: unknown): boolean {
  if (typeof operation !== "string" || !["worker", "model-training", "context"].includes(operation) || typeof stage !== "string") return false;
  const stages: readonly string[] = operation === "context" ? CONTEXT_STAGES : WORKER_PREPARATION_STAGES;
  return stages.includes(stage) && (backend === undefined ||
    ["install-torch", "verify-torch"].includes(stage) && ["cpu", "cuda", "rocm"].includes(backend as string));
}

function ownData(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== "string" || ![...required, ...optional].includes(key)) || required.some(key => !Object.prototype.hasOwnProperty.call(descriptors, key))) return;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const descriptor = descriptors[key]!;
    if (!("value" in descriptor)) return;
    result[key] = descriptor.value;
  }
  return result;
}

/** Copy only validated primitive fields. Do not serialize the input object. */
export function readPythonRuntimePreparationDiagnostic(value: unknown): Readonly<PythonRuntimePreparationDiagnostic> | undefined {
  try {
    const row = ownData(value, ["timestamp", "level", "verbosity", "event", "component", "operation", "stage", "message", "data"]);
    if (!row || row.level !== "debug" || row.verbosity !== "verbose" || row.event !== "runtime.python.dependencies.stage" ||
        row.component !== "python-runtime-dependencies" || row.message !== "Dependency command stage observed." ||
        typeof row.timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.timestamp) ||
        new Date(row.timestamp).toISOString() !== row.timestamp) return;
    const data = ownData(row.data, ["sequence", "phase"], ["backend"]);
    if (!data || !Number.isInteger(data.sequence) || (data.sequence as number) < 1 || (data.sequence as number) > MAX_PREPARATION_COMMAND_OBSERVATIONS ||
        !["entered", "returned", "threw"].includes(data.phase as string) || !validStage(row.operation, row.stage, data.backend)) return;
    return Object.freeze({
      timestamp: row.timestamp, level: "debug", verbosity: "verbose", event: "runtime.python.dependencies.stage",
      component: "python-runtime-dependencies", operation: row.operation as PreparationOperation,
      stage: row.stage as PreparationStage, message: "Dependency command stage observed.",
      data: Object.freeze({ sequence: data.sequence as number, phase: data.phase as ObservationData["phase"],
        ...(data.backend !== undefined ? { backend: data.backend as PreparationBackend } : {}) }),
    });
  } catch {
    return undefined;
  }
}

export function readPreparationObserver(options: {
  readonly onDiagnosticStage?: PythonRuntimePreparationObserver;
}): PythonRuntimePreparationObserver | undefined {
  try {
    const observer = options.onDiagnosticStage;
    return typeof observer === "function" ? observer : undefined;
  } catch {
    return undefined;
  }
}

/** Passive session observations. Neither a returned call nor a label is readiness. */
export function createPreparationStageDiagnostics(
  operation: PreparationOperation,
  initialObserver?: PythonRuntimePreparationObserver,
) {
  const listeners = new Set<PythonRuntimePreparationObserver>();
  const pending = new Map<symbol, { sequence: number; stage: PreparationStage; backend?: PreparationBackend }>();
  let sequence = 0;
  let closed = false;

  function subscribe(observer?: PythonRuntimePreparationObserver): void {
    if (!closed && typeof observer === "function" && listeners.size < MAX_PREPARATION_OBSERVERS) {
      listeners.add(observer);
    }
    // Late listeners receive only future observations. Never replay entry.
  }

  function publish(row: { sequence: number; stage: PreparationStage; backend?: PreparationBackend }, phase: ObservationData["phase"]): void {
    if (closed || listeners.size === 0) return;
    try {
      const data = Object.freeze({ sequence: row.sequence, phase, ...(row.backend ? { backend: row.backend } : {}) });
      const event: Readonly<PythonRuntimePreparationDiagnostic> = Object.freeze({
        timestamp: new Date().toISOString(), level: "debug", verbosity: "verbose",
        event: "runtime.python.dependencies.stage", component: "python-runtime-dependencies",
        operation, stage: row.stage, message: "Dependency command stage observed.", data,
      });
      for (const observer of [...listeners]) {
        try {
          const result = observer(event);
          // Observers are not awaited. A synchronous sink may record entry before
          // dispatch; merely starting an asynchronous sink does not prove that.
          if (result !== undefined) void Promise.resolve(result).catch(() => {});
        } catch {
          // Diagnostics cannot replace the dependency command's real outcome.
        }
      }
    } catch {
      // Even a diagnostic envelope failure must leave setup behavior intact.
    }
  }

  subscribe(initialObserver);
  return {
    subscribe,
    enter(stage: PreparationStage, backend?: PreparationBackend): symbol | undefined {
      if (closed || sequence >= MAX_PREPARATION_COMMAND_OBSERVATIONS || !validStage(operation, stage, backend)) return;
      const token = Symbol();
      const row = { sequence: ++sequence, stage, ...(backend ? { backend } : {}) };
      pending.set(token, row);
      publish(row, "entered");
      return token;
    },
    settle(token: symbol | undefined, phase: "returned" | "threw"): void {
      if (closed || token === undefined || !["returned", "threw"].includes(phase)) return;
      const row = pending.get(token);
      if (!row) return;
      pending.delete(token);
      publish(row, phase);
    },
    close(): void {
      closed = true;
      pending.clear();
      listeners.clear();
    },
  };
}

export type PreparationStageDiagnostics = ReturnType<typeof createPreparationStageDiagnostics>;
