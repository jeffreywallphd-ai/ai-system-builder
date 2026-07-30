export async function shutdownDesktopRuntimeResources(options: {
  readonly closeRuntimeWindows: () => Promise<void>;
  readonly stopPythonRuntime: () => Promise<void>;
  readonly closeRuntimeDatabases?: () => Promise<void>;
  readonly closePlatformDatabase: () => void;
}): Promise<void> {
  try {
    await options.closeRuntimeWindows();
  } catch {
    // Shutdown remains best-effort and never exposes internal failure details.
  }
  try {
    await options.stopPythonRuntime();
  } catch {
    // Continue closing owned persistence even when the sidecar already exited.
  }
  try {
    await options.closeRuntimeDatabases?.();
  } catch {
    // The platform database must still close after a runtime database failure.
  }
  options.closePlatformDatabase();
}
