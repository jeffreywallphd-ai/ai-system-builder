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
  return typeof value === "object" && value !== null && "ok" in value;
}

function toStatusSnapshot(value: unknown): DesktopPythonRuntimeStatusSnapshot {
  if (typeof value !== "object" || value === null) {
    throw new Error("Python runtime status response payload is invalid.");
  }

  const payload = value as Partial<DesktopPythonRuntimeStatusSnapshot>;
  return {
    supervisorStatus: payload.supervisorStatus ?? "failed",
    healthy: payload.healthy === true,
    runtimeStatus: typeof payload.runtimeStatus === "string" ? payload.runtimeStatus : "unknown",
    capabilities: Array.isArray(payload.capabilities) ? payload.capabilities.filter((value): value is string => typeof value === "string") : [],
    loadedModels: Array.isArray(payload.loadedModels)
      ? payload.loadedModels.filter((entry): entry is DesktopPythonRuntimeStatusSnapshot["loadedModels"][number] =>
        typeof entry?.modelId === "string"
        && entry?.provider === "transformers"
        && (entry?.inferenceMode === "text2text" || entry?.inferenceMode === "causal" || entry?.inferenceMode === "chat"))
      : [],
    activeTaskCount: typeof payload.activeTaskCount === "number" ? payload.activeTaskCount : 0,
    logs: Array.isArray(payload.logs)
      ? payload.logs.filter((entry): entry is DesktopPythonRuntimeStatusSnapshot["logs"][number] =>
        typeof entry?.timestamp === "string"
        && (entry?.level === "info" || entry?.level === "warn" || entry?.level === "error")
        && typeof entry?.message === "string")
      : [],
  };
}

function unwrap(response: unknown, fallbackMessage: string): unknown {
  if (!isPreloadResponseEnvelope(response)) {
    throw new Error(fallbackMessage);
  }

  if (!response.ok) {
    throw new Error(response.error?.message ?? fallbackMessage);
  }

  return response.value;
}

export interface DesktopPythonRuntimeClient {
  readStatus: () => Promise<DesktopPythonRuntimeStatusSnapshot>;
  controlRuntime: (action: "start" | "stop" | "restart" | "unload-model") => Promise<DesktopPythonRuntimeStatusSnapshot>;
}

export function createDesktopPythonRuntimeClient(): DesktopPythonRuntimeClient {
  const desktopApi = getDesktopApi();

  return {
    async readStatus() {
      if (!desktopApi.readPythonRuntimeStatus) {
        throw new Error("Python runtime status API is unavailable.");
      }

      return toStatusSnapshot(
        unwrap(
          await desktopApi.readPythonRuntimeStatus(),
          "Failed to read Python runtime status.",
        ),
      );
    },
    async controlRuntime(action) {
      if (!desktopApi.controlPythonRuntime) {
        throw new Error("Python runtime control API is unavailable.");
      }

      return toStatusSnapshot(
        unwrap(
          await desktopApi.controlPythonRuntime({ action }),
          "Failed to control Python runtime.",
        ),
      );
    },
  };
}
