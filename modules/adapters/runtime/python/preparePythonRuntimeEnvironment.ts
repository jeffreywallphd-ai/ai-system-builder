import { ensurePythonRuntimeContextDependencies, PythonRuntimeContextDependencyError } from "./ensurePythonRuntimeContextDependencies";
import { ensurePythonRuntimeWorkerDependencies } from "./ensurePythonRuntimeWorkerDependencies";
import type { PythonStartupEnvironmentFacts } from "./pythonRuntimeStartupDiagnostics";
import { readPreparationObserver, snapshotPreparationEnvironment, type PythonRuntimePreparationObserver } from "./pythonRuntimePreparationDiagnostics";

export interface PreparePythonRuntimeEnvironmentOptions {
  readonly command: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly onDiagnosticStage?: PythonRuntimePreparationObserver;
  readonly onDiagnosticEnvironment?: (facts: PythonStartupEnvironmentFacts) => unknown;
  readonly onDiagnosticFailure?: (operation: "context" | "worker", code: string) => unknown;
}

// Internal factory supports deterministic adapter tests; hosts use the real
// preparation function below, without selecting replacement dependencies.
export function createPythonRuntimeEnvironmentPreparer(dependencies = {
  context: ensurePythonRuntimeContextDependencies,
  worker: ensurePythonRuntimeWorkerDependencies,
}) {
  const context = dependencies.context;
  const worker = dependencies.worker;
  if (typeof context !== "function" || typeof worker !== "function") throw new Error("Runtime dependency preparation is unavailable.");
  return async (options: PreparePythonRuntimeEnvironmentOptions): Promise<void> => {
    const { command, cwd, env } = options;
    const capturedEnvironment = snapshotPreparationEnvironment(env);
    const observer = readPreparationObserver(options);
    let environment: PreparePythonRuntimeEnvironmentOptions["onDiagnosticEnvironment"], failure: PreparePythonRuntimeEnvironmentOptions["onDiagnosticFailure"];
    try { if (typeof options.onDiagnosticEnvironment === "function") environment = options.onDiagnosticEnvironment; } catch { /* Optional observer. */ }
    try { if (typeof options.onDiagnosticFailure === "function") failure = options.onDiagnosticFailure; } catch { /* Optional observer. */ }
    const setup = Object.freeze({ command, cwd, env: capturedEnvironment, ...(observer ? { onDiagnosticStage: observer } : {}), ...(environment ? { onDiagnosticEnvironment: environment } : {}) });
    let operation: "context" | "worker" = "context";
    try { await context(setup); operation = "worker"; worker(setup); }
    catch (error) {
      try { void Promise.resolve(failure?.(operation, error instanceof PythonRuntimeContextDependencyError ? error.code : "preparation-failed")).catch(() => {}); } catch { /* Preserve original error. */ }
      throw error;
    }
  };
}

export const preparePythonRuntimeEnvironment = createPythonRuntimeEnvironmentPreparer();
