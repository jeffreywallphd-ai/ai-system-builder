import { platform as runtimePlatform } from "node:os";
import {
  spawnSync,
  type SpawnSyncReturns,
  type SpawnSyncOptions,
} from "node:child_process";

export interface EnsurePythonRuntimeWorkerDependenciesOptions {
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requirementsFile?: string;
  trainingRequirementsFile?: string;
  /** @deprecated Ignored: a pathname grants no private persistence authority. */
  diagnosticsFile?: string;
  onDiagnosticOutcomes?: (outcomes: PythonDependencyOutcomes) => void | Promise<void>;
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

const OUTCOME_STAGES = [
  "inspect-environment", "probe-pip", "probe-write-access",
  "detect-accelerator-nvidia", "detect-accelerator-rocm", "probe-torch",
  "probe-network", "probe-worker-dependencies", "install-worker-dependencies",
  "probe-model-training-dependencies", "install-model-training-dependencies",
  "verify-model-training-dependencies", "install-torch", "verify-torch", "other",
] as const;
type OutcomeStage = typeof OUTCOME_STAGES[number];

interface CommandExecutionRecord {
  stage: OutcomeStage;
  backend?: TorchInstallBackend;
  exitCode: number | null;
  success: boolean;
  attempts: number;
  failedAttempts: number;
}

interface TorchInstallDiagnostics {
  operation: "worker" | "model-training";
  success: boolean;
  os: string;
  detectedAccelerator?: TorchInstallBackend;
  selectedBackend?: TorchInstallBackend;
  executedCommands: CommandExecutionRecord[];
  verificationResult?: {
    success: boolean;
    backend: TorchInstallBackend;
  };
}

export interface PythonDependencyOutcomes {
  readonly schemaVersion: "python-dependency-outcomes-v1";
  readonly operation: "worker" | "model-training";
  readonly platform: string;
  readonly success: boolean;
  readonly detectedBackend?: TorchInstallBackend;
  readonly selectedBackend?: TorchInstallBackend;
  readonly verificationResult?: Readonly<{ success: boolean; backend: TorchInstallBackend }>;
  readonly stages: readonly Readonly<CommandExecutionRecord>[];
}

// Two finite operation keys, replaced on every attempt; no transcript history.
const sessionOutcomes = new Map<PythonDependencyOutcomes["operation"], PythonDependencyOutcomes>();

export function readPythonRuntimeDependencySessionOutcomes(): readonly PythonDependencyOutcomes[] {
  return Object.freeze([...sessionOutcomes.values()]);
}

const DEFAULT_TORCH_INDEX_BY_BACKEND: Record<TorchInstallBackend, string> = {
  cpu: "https://download.pytorch.org/whl/cpu",
  cuda: "https://download.pytorch.org/whl/cu124",
  rocm: "https://download.pytorch.org/whl/rocm6.2.4",
};

const DEFAULT_INSTALL_TIMEOUT_MS = 180_000;
const DEFAULT_RETRY_COUNT = 1;
const RETRYABLE_NETWORK_FAILURE_PATTERN =
  /(timed out|connection reset|connection aborted|temporary failure|503|504|502)/i;
const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>([
  "win32",
  "linux",
  "darwin",
]);

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

const WORKER_DEPENDENCY_PROBE_SCRIPT = `
# asb:worker-dependency-probe
import importlib.metadata
import importlib.util
import sys
required = ["accelerate", "docx", "fastapi", "hf_xet", "huggingface_hub", "markdownify", "peft", "pyarrow", "pypdf", "safetensors", "transformers", "uvicorn"]
decoder_supported = (3, 10) <= sys.version_info[:2] < (3, 14)
if decoder_supported:
  required.extend(["jsonschema", "outlines", "outlines_core", "llguidance"])
missing = [name for name in required if importlib.util.find_spec(name) is None]
if missing:
  raise ModuleNotFoundError(f"No module named '{missing[0]}'")
core_expected_versions = {"accelerate": "1.14.0", "peft": "0.15.2", "pyarrow": "25.0.0"}
core_mismatched = [name for name, expected in core_expected_versions.items() if importlib.metadata.version(name) != expected]
if core_mismatched:
  raise RuntimeError("Core dependency version mismatch")
if decoder_supported:
  expected_versions = {"jsonschema": "4.26.0", "outlines": "1.3.2", "outlines-core": "0.2.14", "llguidance": "1.9.1"}
  mismatched = [name for name, expected in expected_versions.items() if importlib.metadata.version(name) != expected]
  if mismatched:
    raise RuntimeError("Decoder dependency version mismatch")
`.trim();

const MODEL_TRAINING_DEPENDENCY_PROBE_SCRIPT = `
# asb:model-training-dependency-probe
import importlib.metadata
import importlib.util
required = ["datasets", "peft"]
missing = [name for name in required if importlib.util.find_spec(name) is None]
if missing:
  raise ModuleNotFoundError(f"No module named '{missing[0]}'")
expected_versions = {"datasets": "5.0.1", "peft": "0.15.2"}
mismatched = [name for name, expected in expected_versions.items() if importlib.metadata.version(name) != expected]
if mismatched:
  raise RuntimeError("Model training dependency version mismatch")
`.trim();

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
  const output = [result.stdout, result.stderr, result.error?.message]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    .join("\n")
    .trim();
  return output.length > 0 ? output : "No output captured.";
}

function runCommand(
  spawnSyncImplementation: typeof spawnSync,
  command: string,
  args: readonly string[],
  options: Pick<
    EnsurePythonRuntimeWorkerDependenciesOptions,
    "cwd" | "env" | "installTimeoutMs"
  >,
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
  _command: string,
  _args: readonly string[],
  result: SpawnSyncReturns<string>,
): CommandExecutionRecord {
  const backendStage = /^(install-torch|verify-torch)-(cpu|cuda|rocm)(?:-attempt-\d+)?$/.exec(stage);
  const outcomeStage = backendStage?.[1] ?? stage;
  const exitCode = typeof result.status === "number" && Number.isSafeInteger(result.status) && result.status >= 0 ? result.status : null;
  const success = exitCode === 0 && !result.error;
  return {
    stage: OUTCOME_STAGES.includes(outcomeStage as OutcomeStage) ? outcomeStage as OutcomeStage : "other",
    backend: backendStage?.[2] as TorchInstallBackend | undefined,
    exitCode,
    success,
    attempts: 1,
    failedAttempts: success ? 0 : 1,
  };
}

function appendOutcome(diagnostics: TorchInstallDiagnostics, outcome: CommandExecutionRecord): void {
  const existing = diagnostics.executedCommands.find(record => record.stage === outcome.stage && record.backend === outcome.backend);
  if (!existing) {
    diagnostics.executedCommands.push(outcome);
    return;
  }
  existing.attempts = Math.min(Number.MAX_SAFE_INTEGER, existing.attempts + 1);
  existing.failedAttempts = Math.min(Number.MAX_SAFE_INTEGER, existing.failedAttempts + outcome.failedAttempts);
  existing.exitCode = outcome.exitCode;
  existing.success = outcome.success;
}

function parseJsonFromOutput<T>(label: string, output: string): T {
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new Error(
      `${label} returned invalid JSON output: ${output || "No output captured."}`,
    );
  }
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
  appendOutcome(diagnostics,
    buildRecord(
      "inspect-environment",
      options.command,
      ["-c", ENV_INSPECTION_SCRIPT],
      inspectionResult,
    ),
  );

  if (inspectionResult.status !== 0) {
    throw new Error(
      `Failed to inspect Python runtime environment. ${normalizeOutput(inspectionResult)}`,
    );
  }

  const parsed = parseJsonFromOutput<PythonRuntimeEnvironmentInspection>(
    "Python runtime environment inspection",
    typeof inspectionResult.stdout === "string"
      ? inspectionResult.stdout.trim()
      : "",
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
    throw new Error(
      `Unsupported host platform for Python runtime worker dependencies: ${hostPlatform}`,
    );
  }

  const environment = inspectPythonRuntimeEnvironment(
    spawnSyncImplementation,
    options,
    diagnostics,
  );

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
  appendOutcome(diagnostics,
    buildRecord(
      "probe-pip",
      options.command,
      ["-m", "pip", "--version"],
      pipVersionResult,
    ),
  );
  if (pipVersionResult.status !== 0) {
    throw new Error(
      `Python pip is unavailable for runtime dependency setup. ${normalizeOutput(pipVersionResult)}`,
    );
  }

  if (!options.cwd) {
    return environment;
  }

  const writeAccessProbe = runCommand(
    spawnSyncImplementation,
    options.command,
    [
      "-c",
      "import os; import sys; target=sys.argv[1]; print('1' if os.access(target, os.W_OK) else '0')",
      options.cwd,
    ],
    options,
  );
  appendOutcome(diagnostics,
    buildRecord(
      "probe-write-access",
      options.command,
      [
        "-c",
        "import os; import sys; target=sys.argv[1]; print('1' if os.access(target, os.W_OK) else '0')",
        options.cwd,
      ],
      writeAccessProbe,
    ),
  );
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
  appendOutcome(diagnostics,
    buildRecord(
      "detect-accelerator-nvidia",
      "nvidia-smi",
      ["--query-gpu=name", "--format=csv,noheader"],
      nvidiaResult,
    ),
  );
  if (
    nvidiaResult.status === 0 &&
    typeof nvidiaResult.stdout === "string" &&
    nvidiaResult.stdout.trim().length > 0
  ) {
    diagnostics.detectedAccelerator = "cuda";
    return "cuda";
  }

  const rocmResult = runCommand(
    spawnSyncImplementation,
    "rocminfo",
    [],
    options,
  );
  appendOutcome(diagnostics,
    buildRecord("detect-accelerator-rocm", "rocminfo", [], rocmResult),
  );
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
    reason:
      backend === "cpu"
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
  appendOutcome(diagnostics,
    buildRecord(
      "probe-torch",
      options.command,
      ["-c", TORCH_INSTALL_PROBE_SCRIPT],
      probeResult,
    ),
  );
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

function torchMatchesTarget(
  probe: TorchInstallationProbeResult,
  target: TorchInstallTarget,
): boolean {
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
  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : 80;
  const networkProbeScript = `# asb:torch-network-probe\nimport socket\nsocket.create_connection((${JSON.stringify(host)}, ${port}), timeout=4).close()\nprint("ok")`;
  const probeResult = runCommand(
    spawnSyncImplementation,
    options.command,
    ["-c", networkProbeScript],
    options,
  );
  appendOutcome(diagnostics,
    buildRecord(
      "probe-network",
      options.command,
      ["-c", networkProbeScript],
      probeResult,
    ),
  );

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
    appendOutcome(diagnostics,
      buildRecord(
        `install-torch-${target.backend}-attempt-${attempt}`,
        options.command,
        installArgs,
        installResult,
      ),
    );

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

  return (
    lastResult ?? {
      pid: 0,
      output: [],
      stdout: "",
      stderr: "No install attempt was executed.",
      status: 1,
      signal: null,
      error: undefined,
    }
  );
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
  appendOutcome(diagnostics,
    buildRecord(
      `verify-torch-${backend}`,
      options.command,
      ["-c", verificationScript],
      verificationResult,
    ),
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

function publishDiagnostics(
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
  diagnostics: TorchInstallDiagnostics,
): void {
    // Explicit projection: never serialize subprocess transcripts, command inputs,
    // environment inspection, index URLs, error messages or arbitrary payloads.
    const outcomes: PythonDependencyOutcomes = Object.freeze({
      schemaVersion: "python-dependency-outcomes-v1",
      operation: diagnostics.operation,
      platform: SUPPORTED_PLATFORMS.has(diagnostics.os as NodeJS.Platform) ? diagnostics.os : "other",
      success: diagnostics.success,
      detectedBackend: diagnostics.detectedAccelerator,
      selectedBackend: diagnostics.selectedBackend,
      verificationResult: diagnostics.verificationResult ? Object.freeze({
        success: diagnostics.verificationResult.success,
        backend: diagnostics.verificationResult.backend,
      }) : undefined,
      stages: Object.freeze(diagnostics.executedCommands.map(record => Object.freeze({
        stage: record.stage,
        backend: record.backend,
        exitCode: record.exitCode,
        success: record.success,
        attempts: record.attempts,
        failedAttempts: record.failedAttempts,
      }))),
    });
  sessionOutcomes.set(outcomes.operation, outcomes);
  try {
    void Promise.resolve(options.onDiagnosticOutcomes?.(outcomes)).catch(() => {});
  } catch {
    // A trusted observer cannot change setup success/failure; retain no observer exception.
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
  appendOutcome(diagnostics,
    buildRecord(
      "probe-worker-dependencies",
      options.command,
      ["-c", WORKER_DEPENDENCY_PROBE_SCRIPT],
      dependencyProbe,
    ),
  );
  if (dependencyProbe.status === 0) {
    return;
  }

  const probeOutput = normalizeOutput(dependencyProbe);
  if (dependencyProbe.error) {
    throw new Error(
      `Failed to probe Python runtime worker dependencies: ${probeOutput}`,
    );
  }

  const missingDependencyPattern =
    /(?:No module named ['"](?:accelerate|docx|fastapi|hf_xet|huggingface_hub|jsonschema|llguidance|markdownify|outlines|outlines_core|peft|pyarrow|pypdf|safetensors|transformers|uvicorn)['"]|Core dependency version mismatch|Decoder dependency version mismatch)/i;
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
  appendOutcome(diagnostics,
    buildRecord(
      "install-worker-dependencies",
      options.command,
      ["-m", "pip", "install", "-r", requirementsFile],
      installResult,
    ),
  );

  if (installResult.status === 0) {
    return;
  }

  throw new Error(
    `Failed to install Python runtime worker dependencies. ${normalizeOutput(installResult)}`,
  );
}

function installModelTrainingRequirementsIfNeeded(
  spawnSyncImplementation: typeof spawnSync,
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
  diagnostics: TorchInstallDiagnostics,
): void {
  const requirementsFile =
    options.trainingRequirementsFile ?? "requirements-training-text.txt";
  const probeArgs = ["-c", MODEL_TRAINING_DEPENDENCY_PROBE_SCRIPT] as const;
  const dependencyProbe = runCommand(
    spawnSyncImplementation,
    options.command,
    probeArgs,
    options,
  );
  appendOutcome(diagnostics,
    buildRecord(
      "probe-model-training-dependencies",
      options.command,
      probeArgs,
      dependencyProbe,
    ),
  );
  if (dependencyProbe.status === 0) return;

  const probeOutput = normalizeOutput(dependencyProbe);
  if (dependencyProbe.error) {
    throw new Error(
      `Failed to probe Python model-training dependencies: ${probeOutput}`,
    );
  }
  if (
    !/(?:No module named ['"](?:datasets|peft)['"]|Model training dependency version mismatch)/i.test(
      probeOutput,
    )
  ) {
    throw new Error(
      `Python model-training dependency probe failed for an unexpected reason; aborting training. ${probeOutput}`,
    );
  }

  const installArgs = ["-m", "pip", "install", "-r", requirementsFile] as const;
  const installResult = runCommand(
    spawnSyncImplementation,
    options.command,
    installArgs,
    options,
  );
  appendOutcome(diagnostics,
    buildRecord(
      "install-model-training-dependencies",
      options.command,
      installArgs,
      installResult,
    ),
  );
  if (installResult.status !== 0) {
    throw new Error(
      `Failed to install Python model-training dependencies. ${normalizeOutput(installResult)}`,
    );
  }

  const verification = runCommand(
    spawnSyncImplementation,
    options.command,
    probeArgs,
    options,
  );
  appendOutcome(diagnostics,
    buildRecord(
      "verify-model-training-dependencies",
      options.command,
      probeArgs,
      verification,
    ),
  );
  if (verification.status !== 0) {
    throw new Error(
      `Python model-training dependencies remained unavailable after installation. ${normalizeOutput(verification)}`,
    );
  }
}

function attemptTorchInstallFlow(
  spawnSyncImplementation: typeof spawnSync,
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
  initialTarget: TorchInstallTarget,
  diagnostics: TorchInstallDiagnostics,
): void {
  let target = initialTarget;

  for (let fallbackAttempt = 0; fallbackAttempt < 2; fallbackAttempt += 1) {
    diagnostics.selectedBackend = target.backend;
    ensureNetworkReachabilityForIndex(
      spawnSyncImplementation,
      options,
      target.indexUrl,
      diagnostics,
    );

    const installResult = executeInstallWithRetry(
      spawnSyncImplementation,
      options,
      target,
      diagnostics,
    );

    if (installResult.status !== 0) {
      const installOutput = normalizeOutput(installResult);
      if (target.fallbackBackend) {
        target = resolveInstallTarget(target.fallbackBackend, options);
        continue;
      }

      throw new Error(
        `Failed to install PyTorch (${target.backend}). ${installOutput}`,
      );
    }

    const verification = verifyTorchInstallation(
      spawnSyncImplementation,
      options,
      target.backend,
      diagnostics,
    );
    diagnostics.verificationResult = {
      success: verification.success,
      backend: target.backend,
    };
    if (verification.success) {
      return;
    }

    if (target.fallbackBackend) {
      target = resolveInstallTarget(target.fallbackBackend, options);
      continue;
    }

    throw new Error(
      `PyTorch verification failed for backend '${target.backend}'. ${verification.detail}`,
    );
  }

  throw new Error(
    "PyTorch installation flow exhausted fallback attempts without success.",
  );
}

export function ensurePythonRuntimeWorkerDependencies(
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
): void {
  const spawnSyncImplementation = options.spawnSyncImplementation ?? spawnSync;
  const diagnostics: TorchInstallDiagnostics = {
    operation: "worker",
    os: options.platform ?? runtimePlatform(),
    executedCommands: [],
    success: false,
  };

  try {
    validatePrerequisites(spawnSyncImplementation, options, diagnostics);
    installWorkerRequirementsIfNeeded(
      spawnSyncImplementation,
      options,
      diagnostics,
    );

    const detectedBackend = detectComputeBackend(
      spawnSyncImplementation,
      options,
      diagnostics,
    );
    const target = resolveInstallTarget(detectedBackend, options);
    diagnostics.selectedBackend = target.backend;

    const currentTorch = probeTorchInstallation(
      spawnSyncImplementation,
      options,
      diagnostics,
    );
    if (torchMatchesTarget(currentTorch, target)) {
      const verification = verifyTorchInstallation(
        spawnSyncImplementation,
        options,
        target.backend,
        diagnostics,
      );
      diagnostics.verificationResult = {
        success: verification.success,
        backend: target.backend,
      };
      if (verification.success) {
        diagnostics.success = true;
        return;
      }
    }

    attemptTorchInstallFlow(
      spawnSyncImplementation,
      options,
      target,
      diagnostics,
    );
    diagnostics.success = true;
  } finally {
    publishDiagnostics(options, diagnostics);
  }
}

export function ensurePythonRuntimeModelTrainingDependencies(
  options: EnsurePythonRuntimeWorkerDependenciesOptions,
): void {
  const spawnSyncImplementation = options.spawnSyncImplementation ?? spawnSync;
  const diagnostics: TorchInstallDiagnostics = {
    operation: "model-training",
    os: options.platform ?? runtimePlatform(),
    executedCommands: [],
    success: false,
  };
  try {
    validatePrerequisites(spawnSyncImplementation, options, diagnostics);
    installModelTrainingRequirementsIfNeeded(
      spawnSyncImplementation,
      options,
      diagnostics,
    );
    diagnostics.success = true;
  } finally {
    publishDiagnostics(options, diagnostics);
  }
}
