import type {
  PythonRuntimeCapabilitiesResult,
  PythonRuntimeHealthCheckResult,
  PythonRuntimeModelStatusResult,
  PythonRuntimeTaskRequest,
  PythonRuntimeTaskResult,
  PythonRuntimeUnloadModelsResult,
} from "../../../../contracts/runtime";

import {
  mapCapabilitiesResponseFromHttpPayload,
  mapHealthResponseFromHttpPayload,
  mapModelStatusResponseFromHttpPayload,
  mapTaskRequestToHttpPayload,
  mapTaskResponseFromHttpPayload,
  mapUnloadModelsResponseFromHttpPayload,
} from "../protocol/pythonRuntimeHttpProtocol";

export interface PythonRuntimeHttpClient {
  getHealthStatus(): Promise<PythonRuntimeHealthCheckResult>;
  getCapabilities(): Promise<PythonRuntimeCapabilitiesResult>;
  ensureModelDownloaded(request: { provider: "transformers"; modelId: string }): Promise<{
    provider: "transformers";
    modelId: string;
    downloaded: boolean;
    fromCache: boolean;
    localPath?: string;
  }>;
  getModelStatus(): Promise<PythonRuntimeModelStatusResult>;
  unloadModels(): Promise<PythonRuntimeUnloadModelsResult>;
  executeTask(request: PythonRuntimeTaskRequest): Promise<PythonRuntimeTaskResult>;
}

export interface CreatePythonRuntimeHttpClientOptions {
  baseUrl: string;
  fetchImplementation?: typeof fetch;
  defaultTaskTimeoutMs?: number;
}

async function parseJsonResponseSafe(
  response: Response,
): Promise<unknown | undefined> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function throwNonJsonResponseError(endpoint: string, status: number): never {
  throw new Error(
    `Python runtime request failed for ${endpoint} with status ${status} and invalid JSON response body.`,
  );
}

function mapRuntimeResponsePayload<T>(
  endpoint: string,
  response: Response,
  payload: unknown | undefined,
  mapper: (value: unknown) => T,
): T {
  if (payload === undefined) {
    return throwNonJsonResponseError(endpoint, response.status);
  }

  try {
    return mapper(payload);
  } catch {
    if (!response.ok) {
      throw new Error(
        `Python runtime request failed for ${endpoint} with status ${response.status} and invalid structured payload.`,
      );
    }

    throw new Error(`Python runtime request failed for ${endpoint} with invalid JSON response body.`);
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function mapModelDownloadResponse(endpoint: string, response: Response, payload: unknown | undefined) {
  const parsed = mapRuntimeResponsePayload(endpoint, response, payload, (value) => value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Python runtime request failed for ${endpoint} with invalid JSON response body.`);
  }

  const record = parsed as Record<string, unknown>;
  if (!response.ok) {
    const error = record.error;
    const message = error && typeof error === "object" && !Array.isArray(error)
      && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : `Python runtime request failed for ${endpoint} with status ${response.status}.`;
    throw new Error(`Python runtime model download failed: ${message}`);
  }

  if (record.provider !== "transformers" || typeof record.modelId !== "string") {
    throw new Error(`Python runtime request failed for ${endpoint} with invalid structured payload.`);
  }

  return {
    provider: "transformers" as const,
    modelId: record.modelId,
    downloaded: record.downloaded === true,
    fromCache: record.fromCache === true,
    localPath: typeof record.localPath === "string" && record.localPath.length > 0 ? record.localPath : undefined,
  };
}

export function createPythonRuntimeHttpClient(
  options: CreatePythonRuntimeHttpClientOptions,
): PythonRuntimeHttpClient {
  const fetcher = options.fetchImplementation ?? fetch;
  const baseUrl = trimTrailingSlash(options.baseUrl);
  const defaultTaskTimeoutMs = options.defaultTaskTimeoutMs ?? 120_000;

  return {
    async getHealthStatus() {
      const response = await fetcher(`${baseUrl}/health`, { method: "GET" });
      const payload = await parseJsonResponseSafe(response);
      return mapRuntimeResponsePayload("/health", response, payload, mapHealthResponseFromHttpPayload);
    },

    async getCapabilities() {
      const response = await fetcher(`${baseUrl}/capabilities`, { method: "GET" });
      const payload = await parseJsonResponseSafe(response);
      return mapRuntimeResponsePayload("/capabilities", response, payload, mapCapabilitiesResponseFromHttpPayload);
    },

    async ensureModelDownloaded(request) {
      const response = await fetcher(`${baseUrl}/models/ensure-downloaded`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
      });
      const payload = await parseJsonResponseSafe(response);
      return mapModelDownloadResponse("/models/ensure-downloaded", response, payload);
    },

    async getModelStatus() {
      const response = await fetcher(`${baseUrl}/models/status`, { method: "GET" });
      const payload = await parseJsonResponseSafe(response);
      return mapRuntimeResponsePayload("/models/status", response, payload, mapModelStatusResponseFromHttpPayload);
    },

    async unloadModels() {
      const response = await fetcher(`${baseUrl}/models/unload`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
      });
      const payload = await parseJsonResponseSafe(response);
      if (!response.ok && payload && typeof payload === "object" && "error" in payload) {
        const error = (payload as { error?: { message?: unknown } }).error;
        const message = typeof error?.message === "string"
          ? error.message
          : `Python runtime request failed for /models/unload with status ${response.status}.`;
        throw new Error(`Python runtime model unload failed: ${message}`);
      }

      return mapRuntimeResponsePayload("/models/unload", response, payload, mapUnloadModelsResponseFromHttpPayload);
    },

    async executeTask(request: PythonRuntimeTaskRequest) {
      const timeoutMs = request.timeoutMs ?? defaultTaskTimeoutMs;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error(`Python runtime task timed out after ${timeoutMs}ms.`)), timeoutMs);
      let response: Response;
      try {
        response = await fetcher(`${baseUrl}/tasks/execute`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(mapTaskRequestToHttpPayload({ ...request, timeoutMs })),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && (error.name === "AbortError" || error.message.includes("timed out"))) {
          throw new Error(`Python runtime task request timed out after ${timeoutMs}ms.`);
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }

      const payload = await parseJsonResponseSafe(response);
      return mapRuntimeResponsePayload("/tasks/execute", response, payload, mapTaskResponseFromHttpPayload);
    },
  };
}
