import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { platform as runtimePlatform, tmpdir } from "node:os";
import { spawnSync, type SpawnSyncReturns, type SpawnSyncOptions } from "node:child_process";

export interface EnsurePythonRuntimeWorkerDependenciesOptions {
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requirementsFile?: string;
  diagnosticsFile?: string;
  torchPackageSpecifier?: string;
  torchIndexesByBackend?: Partial<Record<TorchInstallBackend, string>>;
  installTimeoutMs?: number;
  retryCount?: number;
  platform?: NodeJS.Platform;
  spawnSyncImplementation?: typeof spawnSync;
}

export type TorchInstallBackend = "cpu" | "cuda" | "rocm";

interface PythonRuntimeEnvironmentInspection {
  platform: string;
  pythonVersion: string;
  pythonMajor: number;
  pythonMinor: number;
  pythonExecutable: string;
}

interface TorchInstallTarget {
  backend: TorchInstallBackend;
  packageSpecifier: string;
  indexUrl: string;
  fallbackBackend?: "cpu";
  reason: string;
}

interface TorchInstallationProbeResult {
  installed: boolean;
  version?: string;
  cudaVersion?: string | null;
  hipVersion?: string | null;
  cudaAvailable?: boolean;
  importError?: string;
}

interface CommandExecutionRecord {
  stage: string;
  command: string;
  args: readonly string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorMessage?: string;
}

interface TorchInstallDiagnostics {
  os: string;
  pythonVersion?: string;
  packageManagerPath?: string;
  detectedAccelerator?: TorchInstallBackend;
  selectedInstallTarget?: TorchInstallTarget;
  executedCommands: CommandExecutionRecord[];
  verificationResult?: {
    success: boolean;
    backend: TorchInstallBackend;
    detail: string;
  };
  fallbackActions: string[];
}

const DEFAULT_TORCH_INDEX_BY_BACKEND: Record<TorchInstallBackend, string> = {
  cpu: "https://download.pytorch.org/whl/cpu",
  cuda: "https://download.pytorch.org/whl/cu124",
  rocm: "https://download.pytorch.org/whl/rocm6.2.4",
};

const DEFAULT_INSTALL_TIMEOUT_MS = 180_000;
const DEFAULT_RETRY_COUNT = 1;
const RETRYABLE_NETWORK_FAILURE_PATTERN = /(timed out|connection reset|connection aborted|temporary failure|503|504|502)/i;
const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(["win32", "linux", "darwin"]);

const ENV_INSPECTION_SCRIPT = `
# asb:python-env-inspect
import json
import platform
import sys
print(json.dumps({
  "platform": platform.system(),
  "pythonVersion": ".".join(str(v) for v in sys.version_info[:3]),
  "pythonMajor": int(sys.version_info[0]),
  "pythonMinor": int(sys.version_info[1]),
  "pythonExecutable": sys.executable,
}))
`.trim();

const WORKER_DEPENDENCY_PROBE_SCRIPT = "import accelerate, fastapi, hf_xet, uvicorn, huggingface_hub, transformers";

const TORCH_INSTALL_PROBE_SCRIPT = `
# asb:torch-install-probe
import json
result = {"installed": False}
try:
  import torch
  result["installed"] = True
  result["version"] = getattr(torch, "__version__", None)
  result["cudaVersion"] = getattr(getattr(torch, "version", None), "cuda", None)
  result["hipVersion"] = getattr(getattr(torch, "version", None), "hip", None)
  try:
    result["cudaAvailable"] = bool(torch.cuda.is_available())
  except Exception as error:
    result["cudaAvailable"] = False
    result["importError"] = str(error)
except Exception as error:
  result["importError"] = str(error)
print(json.dumps(result))
`.trim();

function normalizeOutput(result: SpawnSyncReturns<string>): string {
  const output = [result.stdout, result.stderr]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n")
    .trim();
  return output.length > 0 ? output : "No output captured.";
}

function runCommand(
  spawnSyncImplementation: typeof spawnSync,
  command: string,
  args: readonly string[],
  options: Pick<EnsurePythonRuntimeWorkerDependenciesOptions, "cwd" | "env" | "installTimeoutMs">,
): SpawnSyncReturns<string> {
  return spawnSyncImplementation(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.installTimeoutMs ?? DEFAULT_INSTALL_TIMEOUT_MS,
  } satisfies SpawnSyncOptions);
}

function buildRecord(
  stage: string,
  command: string,
  args: readonly string[],
  result: SpawnSyncReturns<string>,
): CommandExecutionRecord {
  return {
    stage,
    command,
    args,
    exitCode: result.status,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    errorMessage: result.error?.message,
  };
}

function parseJsonFromOutput<T>(label: string, output: string): T {
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error(`${label} returned invalid JSON output: ${output || "No output captured."}`);
  }
}

function parsePipPathFromVersion(output: string): string | undefined {
  const match = output.match(/\(([^)]+)\)/);
  if (!match?.[1]) {
    return undefined;
  }

  return match[1];
}

function inspectPythonRuntimeEnvironment(
  spawnSyncImplementation: typeof spawnSync,
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
  diagnostics: TorchInstallDiagnostics,
): PythonRuntimeEnvironmentInspection {
  const inspectionResult = runCommand(
    spawnSyncImplementation,
    options.command,
    ["-c", ENV_INSPECTION_SCRIPT],
    options,
  );
  diagnostics.executedCommands.push(buildRecord("inspect-environment", options.command, ["-c", ENV_INSPECTION_SCRIPT], inspectionResult));

  if (inspectionResult.status !== 0) {
    throw new Error(
      `Failed to inspect Python runtime environment. ${normalizeOutput(inspectionResult)}`,
    );
  }

  const parsed = parseJsonFromOutput<PythonRuntimeEnvironmentInspection>(
    "Python runtime environment inspection",
    typeof inspectionResult.stdout === "string" ? inspectionResult.stdout.trim() : "",
  );

  return parsed;
}

function validatePrerequisites(
  spawnSyncImplementation: typeof spawnSync,
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
  diagnostics: TorchInstallDiagnostics,
): PythonRuntimeEnvironmentInspection {
  const hostPlatform = options.platform ?? runtimePlatform();
  if (!SUPPORTED_PLATFORMS.has(hostPlatform)) {
    throw new Error(`Unsupported host platform for Python runtime worker dependencies: ${hostPlatform}`);
  }

  const environment = inspectPythonRuntimeEnvironment(spawnSyncImplementation, options, diagnostics);
  diagnostics.pythonVersion = environment.pythonVersion;

  if (environment.pythonMajor !== 3 || environment.pythonMinor < 9) {
    throw new Error(
      `Unsupported Python version ${environment.pythonVersion}. Python 3.9+ is required for runtime dependency setup.`,
    );
  }

  const pipVersionResult = runCommand(
    spawnSyncImplementation,
    options.command,
    ["-m", "pip", "--version"],
    options,
  );
  diagnostics.executedCommands.push(buildRecord("probe-pip", options.command, ["-m", "pip", "--version"], pipVersionResult));
  if (pipVersionResult.status !== 0) {
    throw new Error(`Python pip is unavailable for runtime dependency setup. ${normalizeOutput(pipVersionResult)}`);
  }
  diagnostics.packageManagerPath = parsePipPathFromVersion(typeof pipVersionResult.stdout === "string" ? pipVersionResult.stdout : "");

  if (!options.cwd) {
    return environment;
  }

  const writeAccessProbe = runCommand(
    spawnSyncImplementation,
    options.command,
    ["-c", "import os; import sys; target=sys.argv[1]; print('1' if os.access(target, os.W_OK) else '0')", options.cwd],
    options,
  );
  diagnostics.executedCommands.push(
    buildRecord("probe-write-access", options.command, ["-c", "import os; import sys; target=sys.argv[1]; print('1' if os.access(target, os.W_OK) else '0')", options.cwd], writeAccessProbe),
  );
  if (writeAccessProbe.status !== 0) {
    diagnostics.fallbackActions.push(
      `Unable to verify write access for Python runtime worker directory (${options.cwd}); continuing startup without write-access precondition.`,
    );
    return environment;
  }

  if (!String(writeAccessProbe.stdout ?? "").trim().endsWith("1")) {
    diagnostics.fallbackActions.push(
      `Python runtime worker directory is not writable (${options.cwd}); continuing startup with read-only worker directory.`,
    );
  }

  return environment;
}

function detectComputeBackend(
  spawnSyncImplementation: typeof spawnSync,
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
  diagnostics: TorchInstallDiagnostics,
): TorchInstallBackend {
  const nvidiaResult = runCommand(
    spawnSyncImplementation,
    "nvidia-smi",
    ["--query-gpu=name", "--format=csv,noheader"],
    options,
  );
  diagnostics.executedCommands.push(
    buildRecord("detect-accelerator-nvidia", "nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], nvidiaResult),
  );
  if (nvidiaResult.status === 0 && typeof nvidiaResult.stdout === "string" && nvidiaResult.stdout.trim().length > 0) {
    diagnostics.detectedAccelerator = "cuda";
    return "cuda";
  }

  const rocmResult = runCommand(
    spawnSyncImplementation,
    "rocminfo",
    [],
    options,
  );
  diagnostics.executedCommands.push(buildRecord("detect-accelerator-rocm", "rocminfo", [], rocmResult));
  if (
    (options.platform ?? runtimePlatform()) === "linux" &&
    rocmResult.status === 0 &&
    typeof rocmResult.stdout === "string" &&
    rocmResult.stdout.trim().length > 0
  ) {
    diagnostics.detectedAccelerator = "rocm";
    return "rocm";
  }

  diagnostics.detectedAccelerator = "cpu";
  return "cpu";
}

function resolveInstallTarget(
  backend: TorchInstallBackend,
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
): TorchInstallTarget {
  const indexes = {
    ...DEFAULT_TORCH_INDEX_BY_BACKEND,
    ...(options.torchIndexesByBackend ?? {}),
  };

  return {
    backend,
    packageSpecifier: options.torchPackageSpecifier ?? "torch",
    indexUrl: indexes[backend],
    fallbackBackend: backend === "cpu" ? undefined : "cpu",
    reason: backend === "cpu"
      ? "No supported GPU runtime detected; selecting CPU build."
      : `Detected ${backend.toUpperCase()} runtime support.`,
  };
}

function probeTorchInstallation(
  spawnSyncImplementation: typeof spawnSync,
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
  diagnostics: TorchInstallDiagnostics,
): TorchInstallationProbeResult {
  const probeResult = runCommand(
    spawnSyncImplementation,
    options.command,
    ["-c", TORCH_INSTALL_PROBE_SCRIPT],
    options,
  );
  diagnostics.executedCommands.push(buildRecord("probe-torch", options.command, ["-c", TORCH_INSTALL_PROBE_SCRIPT], probeResult));
  if (probeResult.status !== 0) {
    return {
      installed: false,
      importError: normalizeOutput(probeResult),
    };
  }

  return parseJsonFromOutput<TorchInstallationProbeResult>(
    "Torch installation probe",
    typeof probeResult.stdout === "string" ? probeResult.stdout.trim() : "",
  );
}

function torchMatchesTarget(probe: TorchInstallationProbeResult, target: TorchInstallTarget): boolean {
  if (!probe.installed) {
    return false;
  }

  if (target.backend === "cuda") {
    return Boolean(probe.cudaVersion);
  }

  if (target.backend === "rocm") {
    return Boolean(probe.hipVersion);
  }

  return !probe.cudaVersion && !probe.hipVersion;
}

function ensureNetworkReachabilityForIndex(
  spawnSyncImplementation: typeof spawnSync,
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
  indexUrl: string,
  diagnostics: TorchInstallDiagnostics,
): void {
  const url: URL = new URL(indexUrl);
  const host = url.hostname;
  const port = url.port ? Number(url.port) : (url.protocol === "https:" ? 443 : 80);
  const networkProbeScript = `# asb:torch-network-probe\nimport socket\nsocket.create_connection((${JSON.stringify(host)}, ${port}), timeout=4).close()\nprint("ok")`;
  const probeResult = runCommand(
    spawnSyncImplementation,
    options.command,
    ["-c", networkProbeScript],
    options,
  );
  diagnostics.executedCommands.push(buildRecord("probe-network", options.command, ["-c", networkProbeScript], probeResult));

  if (probeResult.status !== 0) {
    throw new Error(
      `Network check failed for PyTorch index host ${host}:${port}. ${normalizeOutput(probeResult)}`,
    );
  }
}

function executeInstallWithRetry(
  spawnSyncImplementation: typeof spawnSync,
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
  target: TorchInstallTarget,
  diagnostics: TorchInstallDiagnostics,
): SpawnSyncReturns<string> {
  const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;
  const maxAttempts = retryCount + 1;

  let lastResult: SpawnSyncReturns<string> | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const installArgs = [
      "-m",
      "pip",
      "install",
      "--upgrade",
      target.packageSpecifier,
      "--index-url",
      target.indexUrl,
    ];
    const installResult = runCommand(
      spawnSyncImplementation,
      options.command,
      installArgs,
      options,
    );
    diagnostics.executedCommands.push(buildRecord(`install-torch-${target.backend}-attempt-${attempt}`, options.command, installArgs, installResult));

    if (installResult.status === 0) {
      return installResult;
    }

    lastResult = installResult;
    const output = normalizeOutput(installResult);
    const isRetryable = RETRYABLE_NETWORK_FAILURE_PATTERN.test(output);
    if (!isRetryable || attempt === maxAttempts) {
      break;
    }
  }

  return lastResult ?? {
    pid: 0,
    output: [],
    stdout: "",
    stderr: "No install attempt was executed.",
    status: 1,
    signal: null,
    error: undefined,
  };
}

function verifyTorchInstallation(
  spawnSyncImplementation: typeof spawnSync,
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
  backend: TorchInstallBackend,
  diagnostics: TorchInstallDiagnostics,
): { success: boolean; detail: string } {
  const verificationScript = `
# asb:torch-verification
import json
import sys
expected = ${JSON.stringify(backend)}
try:
  import torch
  version = getattr(torch, "__version__", "unknown")
  cuda_version = getattr(getattr(torch, "version", None), "cuda", None)
  hip_version = getattr(getattr(torch, "version", None), "hip", None)
  cuda_available = bool(torch.cuda.is_available()) if hasattr(torch, "cuda") else False
  if expected == "cuda":
    if not cuda_version:
      raise RuntimeError("Expected CUDA torch build, but torch.version.cuda is empty.")
    if not cuda_available:
      raise RuntimeError("Expected CUDA availability, but torch.cuda.is_available() is false.")
  if expected == "rocm":
    if not hip_version:
      raise RuntimeError("Expected ROCm torch build, but torch.version.hip is empty.")
    if not cuda_available:
      raise RuntimeError("Expected ROCm availability, but torch.cuda.is_available() is false.")
  print(json.dumps({
    "ok": True,
    "backend": expected,
    "version": version,
    "cudaVersion": cuda_version,
    "hipVersion": hip_version,
    "cudaAvailable": cuda_available,
  }))
except Exception as error:
  print(json.dumps({"ok": False, "backend": expected, "error": str(error)}))
  sys.exit(1)
`.trim();

  const verificationResult = runCommand(
    spawnSyncImplementation,
    options.command,
    ["-c", verificationScript],
    options,
  );
  diagnostics.executedCommands.push(
    buildRecord(`verify-torch-${backend}`, options.command, ["-c", verificationScript], verificationResult),
  );

  if (verificationResult.status !== 0) {
    return {
      success: false,
      detail: normalizeOutput(verificationResult),
    };
  }

  return {
    success: true,
    detail: normalizeOutput(verificationResult),
  };
}

function persistDiagnostics(options: EnsurePythonRuntimeWorkerDependenciesOptions, diagnostics: TorchInstallDiagnostics): void {
  const diagnosticsDirectory = join(tmpdir(), "ai-system-builder", "python-runtime");
  const defaultPath = join(diagnosticsDirectory, "worker-dependency-diagnostics.json");
  const filePath = options.diagnosticsFile ?? defaultPath;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
  } catch {
    // Best-effort diagnostics persistence. Dependency setup should still fail/succeed independently.
  }
}

function installWorkerRequirementsIfNeeded(
  spawnSyncImplementation: typeof spawnSync,
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
  diagnostics: TorchInstallDiagnostics,
): void {
  const requirementsFile = options.requirementsFile ?? "requirements.txt";
  const dependencyProbe = runCommand(
    spawnSyncImplementation,
    options.command,
    ["-c", WORKER_DEPENDENCY_PROBE_SCRIPT],
    options,
  );
  diagnostics.executedCommands.push(
    buildRecord("probe-worker-dependencies", options.command, ["-c", WORKER_DEPENDENCY_PROBE_SCRIPT], dependencyProbe),
  );
  if (dependencyProbe.status === 0) {
    return;
  }

  const probeOutput = normalizeOutput(dependencyProbe);
  if (dependencyProbe.error) {
    throw new Error(`Failed to probe Python runtime worker dependencies: ${probeOutput}`);
  }

  const missingDependencyPattern = /No module named ['"](accelerate|fastapi|hf_xet|uvicorn|huggingface_hub|transformers)['"]/i;
  if (!missingDependencyPattern.test(probeOutput)) {
    throw new Error(
      `Python dependency probe failed for an unexpected reason; aborting startup. ${probeOutput}`,
    );
  }

  const installResult = runCommand(
    spawnSyncImplementation,
    options.command,
    ["-m", "pip", "install", "-r", requirementsFile],
    options,
  );
  diagnostics.executedCommands.push(
    buildRecord("install-worker-dependencies", options.command, ["-m", "pip", "install", "-r", requirementsFile], installResult),
  );

  if (installResult.status === 0) {
    return;
  }

  throw new Error(`Failed to install Python runtime worker dependencies. ${normalizeOutput(installResult)}`);
}

function attemptTorchInstallFlow(
  spawnSyncImplementation: typeof spawnSync,
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
  initialTarget: TorchInstallTarget,
  diagnostics: TorchInstallDiagnostics,
): void {
  let target = initialTarget;

  for (let fallbackAttempt = 0; fallbackAttempt < 2; fallbackAttempt += 1) {
    diagnostics.selectedInstallTarget = target;
    ensureNetworkReachabilityForIndex(spawnSyncImplementation, options, target.indexUrl, diagnostics);

    const installResult = executeInstallWithRetry(
      spawnSyncImplementation,
      options,
      target,
      diagnostics,
    );

    if (installResult.status !== 0) {
      const installOutput = normalizeOutput(installResult);
      if (target.fallbackBackend) {
        diagnostics.fallbackActions.push(
          `Torch ${target.backend.toUpperCase()} install failed; falling back to CPU install target.`,
        );
        target = resolveInstallTarget(target.fallbackBackend, options);
        continue;
      }

      throw new Error(`Failed to install PyTorch (${target.backend}). ${installOutput}`);
    }

    const verification = verifyTorchInstallation(spawnSyncImplementation, options, target.backend, diagnostics);
    diagnostics.verificationResult = {
      success: verification.success,
      backend: target.backend,
      detail: verification.detail,
    };
    if (verification.success) {
      return;
    }

    if (target.fallbackBackend) {
      diagnostics.fallbackActions.push(
        `Torch ${target.backend.toUpperCase()} verification failed; falling back to CPU install target.`,
      );
      target = resolveInstallTarget(target.fallbackBackend, options);
      continue;
    }

    throw new Error(`PyTorch verification failed for backend '${target.backend}'. ${verification.detail}`);
  }

  throw new Error("PyTorch installation flow exhausted fallback attempts without success.");
}

export function ensurePythonRuntimeWorkerDependencies(
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
): void {
  const spawnSyncImplementation = options.spawnSyncImplementation ?? spawnSync;
  const diagnostics: TorchInstallDiagnostics = {
    os: options.platform ?? runtimePlatform(),
    executedCommands: [],
    fallbackActions: [],
  };

  try {
    validatePrerequisites(spawnSyncImplementation, options, diagnostics);
    installWorkerRequirementsIfNeeded(spawnSyncImplementation, options, diagnostics);

    const detectedBackend = detectComputeBackend(spawnSyncImplementation, options, diagnostics);
    const target = resolveInstallTarget(detectedBackend, options);
    diagnostics.selectedInstallTarget = target;

    const currentTorch = probeTorchInstallation(spawnSyncImplementation, options, diagnostics);
    if (torchMatchesTarget(currentTorch, target)) {
      const verification = verifyTorchInstallation(spawnSyncImplementation, options, target.backend, diagnostics);
      diagnostics.verificationResult = {
        success: verification.success,
        backend: target.backend,
        detail: verification.detail,
      };
      if (verification.success) {
        return;
      }
    }

    attemptTorchInstallFlow(spawnSyncImplementation, options, target, diagnostics);
  } catch (error) {
    persistDiagnostics(options, diagnostics);
    throw error;
  }

  persistDiagnostics(options, diagnostics);
}
