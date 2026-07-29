import type {
  DesktopPythonRuntimeLogEntry,
  DesktopPythonRuntimeStatusPayload,
} from "../../../contracts/ipc";
import { resolvePythonRuntimeLoopbackEndpoint } from "../../../adapters/runtime/python";

const PYTHON_RUNTIME_MANAGED_BASE_PORT = 43111;
const PYTHON_RUNTIME_MANAGED_PORT_SPAN = 10_000;

export interface DesktopPythonRuntimeFeature {
  supervisor: {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    restart: () => Promise<void>;
    getStatus: () => string;
  };
  runtimePort: any;
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

export function createUnavailablePythonRuntimeStatus(input: {
  runtimeLogs: DesktopPythonRuntimeLogEntry[];
  memoryUsagePercent: number;
  cpuUsagePercent: number;
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
    logs: [...input.runtimeLogs],
  };
}
