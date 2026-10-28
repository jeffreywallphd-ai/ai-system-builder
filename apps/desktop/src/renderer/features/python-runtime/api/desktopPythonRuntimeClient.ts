import {
  normalizeDatasetPreparationGenerationCapacitySnapshot,
} from "../../../../../../../modules/contracts/runtime";
import {
  getDesktopApi,
  type DesktopPythonRuntimeStatusSnapshot,
} from "../../../lib/desktopApi";

interface PreloadResponseEnvelope {
  ok: boolean;
  value?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
}

function isPreloadResponseEnvelope(value: unknown): value is PreloadResponseEnvelope {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && typeof (value as PreloadResponseEnvelope).ok === "boolean";
}

const percentage = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;

function toStatusSnapshot(value: unknown): DesktopPythonRuntimeStatusSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Python runtime status response payload is invalid.");
  }

  const payload = value as Partial<DesktopPythonRuntimeStatusSnapshot>;
  return {
    supervisorStatus: payload.supervisorStatus && ["stopped", "starting", "ready", "failed"].includes(payload.supervisorStatus) ? payload.supervisorStatus : "failed",
    healthy: payload.healthy === true,
    runtimeStatus: typeof payload.runtimeStatus === "string" ? payload.runtimeStatus : "unknown",
    capabilities: Array.isArray(payload.capabilities) ? payload.capabilities.filter((value): value is string => typeof value === "string") : [],
    loadedModels: Array.isArray(payload.loadedModels)
      ? payload.loadedModels.filter((entry): entry is DesktopPythonRuntimeStatusSnapshot["loadedModels"][number] =>
        typeof entry?.modelId === "string"
        && entry?.provider === "transformers"
        && (entry.memoryMode === undefined || entry.memoryMode === "standard" || entry.memoryMode === "offload-v1")
        && (entry?.inferenceMode === "text2text" || entry?.inferenceMode === "causal" || entry?.inferenceMode === "chat"))
        .map(entry => ({
          provider: entry.provider, modelId: entry.modelId, inferenceMode: entry.inferenceMode,
          ...(entry.memoryMode === "standard" || entry.memoryMode === "offload-v1" ? { memoryMode: entry.memoryMode } : {}),
          ...(entry.device === "cpu" || entry.device === "cuda" || entry.device === "auto" ? { device: entry.device } : {}),
          ...(entry.torchDtype === "auto" || entry.torchDtype === "float16" || entry.torchDtype === "bfloat16" || entry.torchDtype === "float32" ? { torchDtype: entry.torchDtype } : {}),
          ...(typeof entry.localPath === "string" ? { localPath: entry.localPath } : {}),
        }))
      : [],
    activeTaskCount: typeof payload.activeTaskCount === "number" && Number.isSafeInteger(payload.activeTaskCount) && payload.activeTaskCount >= 0 ? payload.activeTaskCount : 0,
    systemResources: {
      memoryUsagePercent: percentage(payload.systemResources?.memoryUsagePercent),
      cpuUsagePercent: percentage(payload.systemResources?.cpuUsagePercent),
      gpuUsagePercent: percentage(payload.systemResources?.gpuUsagePercent),
    },
    generationCapacity:
      normalizeDatasetPreparationGenerationCapacitySnapshot(
        payload.generationCapacity,
      ),
    logs: Array.isArray(payload.logs)
      ? payload.logs.filter((entry): entry is DesktopPythonRuntimeStatusSnapshot["logs"][number] =>
        typeof entry?.timestamp === "string"
        && (entry?.level === "info" || entry?.level === "warn" || entry?.level === "error")
        && typeof entry?.message === "string")
        .map(entry => ({ timestamp: entry.timestamp, level: entry.level, message: entry.message }))
      : [],
  };
}

function unwrap(response: unknown, fallbackMessage: string): unknown {
  if (!isPreloadResponseEnvelope(response)) {
    throw new Error(fallbackMessage);
  }

  if (!response.ok) {
    throw new Error(fallbackMessage);
  }

  return response.value;
}

export interface DesktopPythonRuntimeClient {
  readStatus: () => Promise<DesktopPythonRuntimeStatusSnapshot>;
  controlRuntime: (action: "start" | "stop" | "restart" | "unload-model" | "clear-logs") => Promise<DesktopPythonRuntimeStatusSnapshot>;
}

export function createDesktopPythonRuntimeClient(): DesktopPythonRuntimeClient {
  const desktopApi = getDesktopApi();

  return {
    async readStatus() {
      if (!desktopApi.readPythonRuntimeStatus) {
        throw new Error("Python runtime status API is unavailable.");
      }

      try {
        return toStatusSnapshot(unwrap(await desktopApi.readPythonRuntimeStatus(), "Failed to read Python runtime status."));
      } catch {
        throw new Error("Failed to read Python runtime status.");
      }
    },
    async controlRuntime(action) {
      if (!["start", "stop", "restart", "unload-model", "clear-logs"].includes(action)) {
        throw new Error("The runtime action is not supported.");
      }
      if (!desktopApi.controlPythonRuntime) {
        throw new Error("Python runtime control API is unavailable.");
      }

      try {
        return toStatusSnapshot(unwrap(await desktopApi.controlPythonRuntime({ action }), "Failed to control Python runtime."));
      } catch {
        throw new Error("Failed to control Python runtime.");
      }
    },
  };
}
