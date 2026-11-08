import { ensurePythonRuntimeContextDependencies } from "./ensurePythonRuntimeContextDependencies";
import { ensurePythonRuntimeWorkerDependencies } from "./ensurePythonRuntimeWorkerDependencies";
import { readPreparationObserver, snapshotPreparationEnvironment, type PythonRuntimePreparationObserver } from "./pythonRuntimePreparationDiagnostics";

export interface PreparePythonRuntimeEnvironmentOptions {
  readonly command: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly onDiagnosticStage?: PythonRuntimePreparationObserver;
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
    const setup = Object.freeze({ command, cwd, env: capturedEnvironment, ...(observer ? { onDiagnosticStage: observer } : {}) });
    await context(setup);
    worker(setup);
  };
}

export const preparePythonRuntimeEnvironment = createPythonRuntimeEnvironmentPreparer();
