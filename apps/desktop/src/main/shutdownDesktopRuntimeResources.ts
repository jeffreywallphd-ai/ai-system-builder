export async function shutdownDesktopRuntimeResources(options: {
  readonly closeRuntimeWindows: () => Promise<void>;
  readonly shutdownBackgroundTasks?: () => Promise<void>;
  readonly stopPythonRuntime: () => Promise<void>;
  readonly closeRuntimeDatabases?: () => Promise<void>;
  readonly closePlatformDatabase: () => void;
}): Promise<void> {
  try {
    await options.closeRuntimeWindows();
  } catch {
    // Shutdown remains best-effort and never exposes internal failure details.
  }
  // A failed worker stop is retryable. Persistence must remain available to its
  // still-owned callbacks until shutdown reconciliation actually succeeds.
  if (options.shutdownBackgroundTasks) await options.shutdownBackgroundTasks();
  else await options.stopPythonRuntime();
  try {
    await options.closeRuntimeDatabases?.();
  } catch {
    // The platform database must still close after a runtime database failure.
  }
  options.closePlatformDatabase();
}
