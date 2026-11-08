import { execFile, type ExecFileException } from "node:child_process";
import { platform as runtimePlatform } from "node:os";
import {
  createPreparationStageDiagnostics, readPreparationObserver, snapshotPreparationEnvironment,
  type PreparationStageDiagnostics, type PreparationStage,
  type PythonRuntimePreparationObserver,
} from "./pythonRuntimePreparationDiagnostics";

export const PYTHON_RUNTIME_LANCEDB_VERSION = "0.34.0";
export const PYTHON_RUNTIME_CONTEXT_REQUIREMENTS_FILE =
  "requirements-context.txt";

export type PythonRuntimeContextDependencyPhase = "installing" | "installed";

export interface PythonRuntimeContextDependencyProgress {
  readonly phase: PythonRuntimeContextDependencyPhase;
  readonly message: string;
}

export interface EnsurePythonRuntimeContextDependenciesResult {
  readonly installed: boolean;
  readonly version: typeof PYTHON_RUNTIME_LANCEDB_VERSION;
}

type ContextDependencyExecFile = (
  command: string,
  args: readonly string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    encoding: "utf8";
    timeout: number;
    windowsHide: true;
    maxBuffer: number;
  },
  callback: (
    error: ExecFileException | null,
    stdout: string,
    stderr: string,
  ) => void,
) => unknown;

export interface EnsurePythonRuntimeContextDependenciesOptions {
  readonly command: string;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly requirementsFile?: string;
  readonly installTimeoutMs?: number;
  readonly platform?: NodeJS.Platform;
  readonly execFileImplementation?: ContextDependencyExecFile;
  readonly onProgress?: (
    progress: PythonRuntimeContextDependencyProgress,
  ) => void;
  /** Passive trusted observer; no persistence or readiness authority. */
  readonly onDiagnosticStage?: PythonRuntimePreparationObserver;
}

export class PythonRuntimeContextDependencyError extends Error {
  public constructor(
    public readonly code:
      | "unsupported-platform"
      | "unsupported-python"
      | "probe-failed"
      | "install-failed"
      | "install-timeout"
      | "verification-failed",
    message: string,
  ) {
    super(message);
    this.name = "PythonRuntimeContextDependencyError";
  }
}

interface CommandResult {
  readonly error: ExecFileException | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface ActiveEnsure {
  promise?: Promise<EnsurePythonRuntimeContextDependenciesResult>;
  readonly listeners: Set<
    (progress: PythonRuntimeContextDependencyProgress) => void
  >;
  lastProgress?: PythonRuntimeContextDependencyProgress;
  readonly diagnostics: PreparationStageDiagnostics;
}

const DEFAULT_INSTALL_TIMEOUT_MS = 5 * 60 * 1_000;
const MAXIMUM_OUTPUT_BYTES = 256 * 1_024;
const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>([
  "win32",
  "linux",
  "darwin",
]);
const activeEnsures = new Map<string, ActiveEnsure>();

const CONTEXT_DEPENDENCY_PROBE_SCRIPT = `
# asb:context-dependency-probe
import importlib.metadata
import importlib.util
import sys

if not ((3, 10) <= sys.version_info[:2] < (3, 15)):
  print("ASB_CONTEXT_DEPENDENCY_UNSUPPORTED_PYTHON")
  raise SystemExit(11)

required = ["lancedb", "pyarrow"]
missing = [name for name in required if importlib.util.find_spec(name) is None]
if missing:
  print("ASB_CONTEXT_DEPENDENCY_MISSING")
  raise SystemExit(12)

expected = {"lancedb": "0.34.0", "pyarrow": "25.0.0"}
if any(importlib.metadata.version(name) != version for name, version in expected.items()):
  print("ASB_CONTEXT_DEPENDENCY_VERSION_MISMATCH")
  raise SystemExit(13)

try:
  import lancedb
  import pyarrow
except Exception:
  print("ASB_CONTEXT_DEPENDENCY_IMPORT_FAILED")
  raise SystemExit(14)

print("ASB_CONTEXT_DEPENDENCY_READY")
`.trim();

function runCommand(
  implementation: ContextDependencyExecFile,
  options: EnsurePythonRuntimeContextDependenciesOptions,
  args: readonly string[],
  active: ActiveEnsure,
  stage: PreparationStage,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const capturedArgs = Object.freeze([...args]);
    const dispatchOptions = {
      cwd: options.cwd, env: options.env, encoding: "utf8" as const,
      timeout: options.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS,
      windowsHide: true as const, maxBuffer: MAXIMUM_OUTPUT_BYTES,
    };
    const token = active.diagnostics.enter(stage);
    try {
      implementation(
        options.command,
        capturedArgs,
        dispatchOptions,
        (error, stdout, stderr) => {
          active.diagnostics.settle(token, "returned");
          resolve({
            error,
            stdout: typeof stdout === "string" ? stdout : "",
            stderr: typeof stderr === "string" ? stderr : "",
          });
        },
      );
    } catch (error) {
      active.diagnostics.settle(token, "threw");
      throw error;
    }
  });
}

function marker(result: CommandResult): string | undefined {
  return `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => /^ASB_CONTEXT_DEPENDENCY_[A-Z_]+$/u.test(line));
}

function emitProgress(
  active: ActiveEnsure,
  progress: PythonRuntimeContextDependencyProgress,
): void {
  active.lastProgress = progress;
  for (const listener of active.listeners) {
    try {
      listener(progress);
    } catch {
      // Progress observers cannot change dependency installation behavior.
    }
  }
}

async function performEnsure(
  options: EnsurePythonRuntimeContextDependenciesOptions,
  active: ActiveEnsure,
): Promise<EnsurePythonRuntimeContextDependenciesResult> {
  const platform = options.platform ?? runtimePlatform();
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new PythonRuntimeContextDependencyError(
      "unsupported-platform",
      "The local vector database is unavailable on this platform.",
    );
  }
  if (!options.command.trim() || /[\r\n\0]/u.test(options.command)) {
    throw new PythonRuntimeContextDependencyError(
      "probe-failed",
      "The managed Python runtime command is invalid.",
    );
  }

  const implementation =
    options.execFileImplementation ??
    (execFile as unknown as ContextDependencyExecFile);
  const probeArgs = ["-c", CONTEXT_DEPENDENCY_PROBE_SCRIPT] as const;
  const probe = await runCommand(implementation, options, probeArgs, active, "probe-context-dependencies");
  const probeMarker = marker(probe);
  if (!probe.error && probeMarker === "ASB_CONTEXT_DEPENDENCY_READY") {
    return { installed: false, version: PYTHON_RUNTIME_LANCEDB_VERSION };
  }
  if (probeMarker === "ASB_CONTEXT_DEPENDENCY_UNSUPPORTED_PYTHON") {
    throw new PythonRuntimeContextDependencyError(
      "unsupported-python",
      "The local vector database requires the supported managed Python version.",
    );
  }
  if (
    probeMarker !== "ASB_CONTEXT_DEPENDENCY_MISSING" &&
    probeMarker !== "ASB_CONTEXT_DEPENDENCY_VERSION_MISMATCH" &&
    probeMarker !== "ASB_CONTEXT_DEPENDENCY_IMPORT_FAILED"
  ) {
    throw new PythonRuntimeContextDependencyError(
      "probe-failed",
      "The local vector database dependency check failed.",
    );
  }

  emitProgress(active, {
    phase: "installing",
    message:
      "Installing the local vector database. This runs once for the managed Python runtime.",
  });
  const requirementsFile =
    options.requirementsFile ?? PYTHON_RUNTIME_CONTEXT_REQUIREMENTS_FILE;
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(requirementsFile) ||
    !requirementsFile.endsWith(".txt")
  ) {
    throw new PythonRuntimeContextDependencyError(
      "install-failed",
      "The managed vector database dependency declaration is invalid.",
    );
  }
  const install = await runCommand(implementation, options, [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--no-input",
    "-r",
    requirementsFile,
  ], active, "install-context-dependencies");
  if (install.error) {
    const timedOut =
      install.error.killed === true ||
      install.error.code === "ETIMEDOUT" ||
      install.error.signal === "SIGTERM";
    throw new PythonRuntimeContextDependencyError(
      timedOut ? "install-timeout" : "install-failed",
      timedOut
        ? "Installing the local vector database timed out. Check network access and retry."
        : "The local vector database could not be installed. Check network access and retry.",
    );
  }

  const verification = await runCommand(implementation, options, probeArgs, active, "verify-context-dependencies");
  if (
    verification.error ||
    marker(verification) !== "ASB_CONTEXT_DEPENDENCY_READY"
  ) {
    throw new PythonRuntimeContextDependencyError(
      "verification-failed",
      "The local vector database remained unavailable after installation. Retry runtime setup.",
    );
  }
  emitProgress(active, {
    phase: "installed",
    message: "Local vector database installed. Preparing Context work.",
  });
  return { installed: true, version: PYTHON_RUNTIME_LANCEDB_VERSION };
}

export function ensurePythonRuntimeContextDependencies(
  options: EnsurePythonRuntimeContextDependenciesOptions,
): Promise<EnsurePythonRuntimeContextDependenciesResult> {
  const captured = {
    command: options.command, cwd: options.cwd, env: snapshotPreparationEnvironment(options.env),
    requirementsFile: options.requirementsFile, installTimeoutMs: options.installTimeoutMs,
    platform: options.platform, execFileImplementation: options.execFileImplementation,
    onProgress: options.onProgress,
  };
  options = Object.freeze({ ...captured, onDiagnosticStage: readPreparationObserver(options) });
  const requirementsFile =
    options.requirementsFile ?? PYTHON_RUNTIME_CONTEXT_REQUIREMENTS_FILE;
  const key = [
    options.command.trim(),
    options.cwd ?? "",
    requirementsFile,
    options.platform ?? runtimePlatform(),
  ].join("\0");
  const existing = activeEnsures.get(key);
  if (existing?.promise) {
    existing.diagnostics.subscribe(readPreparationObserver(options));
    if (options.onProgress) {
      existing.listeners.add(options.onProgress);
      if (existing.lastProgress) {
        try {
          options.onProgress(existing.lastProgress);
        } catch {
          // Progress observers cannot change dependency installation behavior.
        }
      }
    }
    return existing.promise;
  }

  const active: ActiveEnsure = {
    listeners: new Set(),
    diagnostics: createPreparationStageDiagnostics("context", readPreparationObserver(options)),
  };
  if (options.onProgress) active.listeners.add(options.onProgress);
  let resolve!: (result: EnsurePythonRuntimeContextDependenciesResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<EnsurePythonRuntimeContextDependenciesResult>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  active.promise = promise;
  // Register before the first observation can invoke a reentrant subscriber.
  activeEnsures.set(key, active);
  void performEnsure(options, active).finally(() => {
    active.diagnostics.close();
    if (activeEnsures.get(key) === active) activeEnsures.delete(key);
  }).then(resolve, reject);
  return promise;
}
