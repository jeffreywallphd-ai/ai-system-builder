import { existsSync } from "node:fs";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { isAbsolute, join, resolve } from "node:path";

import type {
  DesktopPythonRuntimeLogEntry,
  DesktopPythonRuntimeStatusPayload,
} from "../../../contracts/ipc";
import { resolvePythonRuntimeLoopbackEndpoint } from "../../../adapters/runtime/python";
import type { DatasetPreparationGenerationCapacitySnapshot } from "../../../contracts/runtime";

const PYTHON_RUNTIME_MANAGED_BASE_PORT = 43111;
const PYTHON_RUNTIME_MANAGED_PORT_SPAN = 10_000;
const PYTHON_RUNTIME_WORKER_RELATIVE_PATH =
  "modules/adapters/runtime/python/worker";
const PYTHON_RUNTIME_PACKAGED_RESOURCE_DIRECTORY = "worker";
const PYTHON_RUNTIME_MIN_MINOR = 10;
const PYTHON_RUNTIME_DECODER_MAX_MINOR = 13;
const PYTHON_RUNTIME_MAX_MINOR = 14;
const PYTHON_RUNTIME_VERSION_PROBE =
  'import json,sys; print(json.dumps({"major":sys.version_info[0],"minor":sys.version_info[1],"executable":sys.executable}))';

type PythonProbeResult = Pick<SpawnSyncReturns<string>, "status" | "stdout">;

export function desktopPythonProbeEnvironment(env: NodeJS.ProcessEnv, platform = process.platform): NodeJS.ProcessEnv {
  if (platform !== "win32") return env;
  const result = { ...env };
  for (const key of Object.keys(result)) {
    if (/^(?:PYLAUNCHER_(?:ALLOW|ALWAYS)_INSTALL|PYTHON_MANAGER_AUTOMATIC_INSTALL)$/iu.test(key)) delete result[key];
    if (/^PATH$/iu.test(key)) {
      result[key] = result[key]?.split(";").filter(entry => !/[/\\]Microsoft[/\\]WindowsApps[/\\]?$/iu.test(entry.trim().replaceAll('"', ""))).join(";");
    }
  }
  result.PYTHON_MANAGER_AUTOMATIC_INSTALL = "false";
  return result;
}

function resolveSupportedPythonExecutable(
  result: PythonProbeResult,
  exists: (path: string) => boolean,
): { executable: string; minor: number } | undefined {
  if (result.status !== 0 || typeof result.stdout !== "string")
    return undefined;
  try {
    const value = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    const executable =
      typeof value.executable === "string" ? value.executable.trim() : "";
    if (
      value.major !== 3 ||
      typeof value.minor !== "number" ||
      !Number.isInteger(value.minor) ||
      value.minor < PYTHON_RUNTIME_MIN_MINOR ||
      value.minor > PYTHON_RUNTIME_MAX_MINOR ||
      !isAbsolute(executable) ||
      !exists(executable)
    ) {
      return undefined;
    }
    return { executable, minor: value.minor };
  } catch {
    return undefined;
  }
}

/**
 * Prefer an installed interpreter that supports the optional constrained
 * decoder, then one that can run the core worker. Explicit operator
 * configuration wins. Keep the platform default as the last resort so startup
 * can report its actual dependency failure.
 */
export function resolveDesktopPythonRuntimeCommand(
  input: {
    configuredCommand?: string;
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    exists?: (path: string) => boolean;
    spawnSyncImplementation?: typeof spawnSync;
  } = {},
): string {
  const configured = input.configuredCommand?.trim();
  if (configured) return configured;

  const platform = input.platform ?? process.platform;
  const defaultCommand = platform === "win32" ? "python" : "python3";
  const probe = input.spawnSyncImplementation ?? spawnSync;
  const exists = input.exists ?? existsSync;
  const env = desktopPythonProbeEnvironment(input.env ?? process.env, platform);
  const candidates: ReadonlyArray<{
    command: string;
    versionArgument?: string;
  }> = [
    { command: defaultCommand },
    ...(platform === "win32"
      ? (["-3.13", "-3.12", "-3.11", "-3.10", "-3.14"] as const).map(
          (versionArgument) => ({ command: "py", versionArgument }),
        )
      : (["python3.13", "python3.12", "python3.11", "python3.10", "python3.14"] as const).map(
          (command) => ({ command }),
        )),
  ];

  let coreWorkerExecutable: string | undefined;
  for (const candidate of candidates) {
    const result = probe(
      candidate.command,
      [
        ...(candidate.versionArgument ? [candidate.versionArgument] : []),
        "-I",
        "-B",
        "-c",
        PYTHON_RUNTIME_VERSION_PROBE,
      ],
      {
        encoding: "utf8",
        env,
        timeout: 5_000,
        windowsHide: true,
      },
    );
    const python = resolveSupportedPythonExecutable(result, exists);
    if (!python) continue;
    if (python.minor <= PYTHON_RUNTIME_DECODER_MAX_MINOR) return python.executable;
    if (shouldPreparePythonRuntimeWorkerDependencies(python.executable)) {
      coreWorkerExecutable ??= python.executable;
    }
  }

  return coreWorkerExecutable ?? defaultCommand;
}

export interface DesktopPythonRuntimeFeature {
  bindHostAdmission?: (assertAccepting: () => void) => void;
  readStartupDiagnostics?: () => import("../../../contracts/runtime").PythonRuntimeStartupDiagnostics;
  supervisor: {
    start: () => Promise<void>;
    startWithoutInstalling?: () => Promise<void>;
    stop: () => Promise<void>;
    restart: () => Promise<void>;
    getStatus: () => string;
  };
  runtimePort: any;
  prepareModelTrainingEnvironment?: () => void;
  prepareContextEnvironment?: (
    onProgress?: (progress: {
      readonly phase: "installing" | "installed";
      readonly message: string;
    }) => void,
  ) => Promise<void>;
}

export function classifyPythonRuntimeStdioLogLevel(
  stream: "stdout" | "stderr",
  message: string,
): "info" | "warn" | "error" {
  if (stream === "stdout") return "info";
  const normalizedMessage = message.trim();
  if (
    /^(ERROR|CRITICAL):/i.test(normalizedMessage) ||
    normalizedMessage.includes("Traceback (most recent call last)")
  )
    return "error";
  if (
    /^WARNING:/i.test(normalizedMessage) ||
    /\b(?:UserWarning|FutureWarning|RuntimeWarning|DeprecationWarning):/.test(
      normalizedMessage,
    )
  )
    return "warn";
  return "info";
}

export function resolveDefaultManagedPythonRuntimePort(
  processId: number = process.pid,
): string {
  const processPortOffset =
    Math.abs(processId) % PYTHON_RUNTIME_MANAGED_PORT_SPAN;
  return String(PYTHON_RUNTIME_MANAGED_BASE_PORT + processPortOffset);
}

export function resolvePythonRuntimeHostAndPort(
  env: NodeJS.ProcessEnv = process.env,
): { host: string; port: string } {
  const endpoint = resolvePythonRuntimeLoopbackEndpoint({
    env,
    defaultPort: resolveDefaultManagedPythonRuntimePort(),
  });
  return { host: endpoint.host, port: endpoint.port };
}

export function resolvePythonRuntimeBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolvePythonRuntimeLoopbackEndpoint({
    env,
    defaultPort: resolveDefaultManagedPythonRuntimePort(),
  }).baseUrl;
}

export function shouldPreparePythonRuntimeWorkerDependencies(
  command: string,
): boolean {
  const executableName = command.trim().replaceAll("\\", "/").split("/").pop();
  return /^python(?:3(?:\.\d+)?)?(?:\.exe)?$/i.test(executableName ?? "");
}

export function resolveDesktopPythonRuntimeWorkerDirectory(
  input: {
    configuredWorkerDirectory?: string;
    resourcesPath?: string;
    cwd?: string;
    exists?: (path: string) => boolean;
  } = {},
): string {
  const configured = input.configuredWorkerDirectory?.trim();
  if (configured) {
    return isAbsolute(configured)
      ? configured
      : resolve(input.cwd ?? process.cwd(), configured);
  }

  const resourcesPath = input.resourcesPath?.trim();
  if (resourcesPath) {
    const packagedWorkerDirectory = join(
      resourcesPath,
      PYTHON_RUNTIME_PACKAGED_RESOURCE_DIRECTORY,
    );
    if ((input.exists ?? existsSync)(join(packagedWorkerDirectory, "main.py")))
      return packagedWorkerDirectory;
  }

  return PYTHON_RUNTIME_WORKER_RELATIVE_PATH;
}

export function createUnavailablePythonRuntimeStatus(input: {
  runtimeLogs: DesktopPythonRuntimeLogEntry[];
  memoryUsagePercent: number;
  cpuUsagePercent: number;
  generationCapacity: DatasetPreparationGenerationCapacitySnapshot;
}): DesktopPythonRuntimeStatusPayload {
  return {
    supervisorStatus: "stopped",
    healthy: false,
    runtimeStatus: "unavailable",
    capabilities: [],
    loadedModels: [],
    activeTaskCount: 0,
    systemResources: {
      memoryUsagePercent: input.memoryUsagePercent,
      cpuUsagePercent: input.cpuUsagePercent,
      gpuUsagePercent: 0,
    },
    generationCapacity: input.generationCapacity,
    logs: [...input.runtimeLogs],
  };
}
