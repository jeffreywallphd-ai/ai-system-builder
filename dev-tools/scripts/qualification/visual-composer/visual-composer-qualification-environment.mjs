// Trusted qualification plans only. This projection grants no launch authority.
export function resolveVisualComposerQualificationEnvironment(launchPlan, sourceRevision) {
  const desktop = launchPlan?.desktop;
  const runtime = desktop?.env;
  const bindings = {
    VISUAL_COMPOSER_QUALIFICATION_RUN_ID: launchPlan?.runId,
    VISUAL_COMPOSER_QUALIFICATION_ENVIRONMENT_ID: `local-${process.platform}-${process.arch}`,
    VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION: sourceRevision,
    VISUAL_COMPOSER_DESKTOP_EXECUTABLE: desktop?.executablePath,
    VISUAL_COMPOSER_DESKTOP_DATA_ROOT: launchPlan?.paths?.desktopDataRoot,
    VISUAL_COMPOSER_ELECTRON_NODE_EXECUTABLE: desktop?.seed?.command,
    PYTHON_RUNTIME_BASE_URL: runtime?.PYTHON_RUNTIME_BASE_URL,
    PYTHON_RUNTIME_HOST: runtime?.PYTHON_RUNTIME_HOST,
    PYTHON_RUNTIME_PORT: runtime?.PYTHON_RUNTIME_PORT,
    PYTHON_RUNTIME_COMMAND: runtime?.PYTHON_RUNTIME_COMMAND,
    PYTHON_RUNTIME_ARGS: runtime?.PYTHON_RUNTIME_ARGS,
    PYTHON_RUNTIME_WORKER_DIR: runtime?.PYTHON_RUNTIME_WORKER_DIR,
    PYTHON_RUNTIME_STARTUP_TIMEOUT_MS: runtime?.PYTHON_RUNTIME_STARTUP_TIMEOUT_MS,
  };
  if (typeof sourceRevision !== "string" || !/^source\.[a-f0-9]{64}$/.test(sourceRevision) ||
      Object.values(bindings).some(value => typeof value !== "string" || value.length === 0 ||
        Buffer.byteLength(value) > 32_768 || /[\0\r\n]/.test(value))) {
    throw new Error("Invalid qualification environment bindings.");
  }
  return Object.freeze(bindings);
}
