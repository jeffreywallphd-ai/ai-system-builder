import type {
  CancelPythonRuntimeTaskResult,
  PythonRuntimeTaskStatusResult,
  PythonRuntimeCapabilitiesResult,
  PythonRuntimeHealthCheckResult,
  PythonRuntimeModelStatusResult,
  StartPythonRuntimeTaskRequest,
  StartPythonRuntimeTaskResult,
  PythonRuntimeUnloadModelsResult,
} from "../../../../contracts/runtime";
import type { CompletedModelDownload } from "../../../../application/ports/model";
import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import {
  mapCancelTaskResponse,
  mapCapabilitiesResponseFromHttpPayload,
  mapHealthResponseFromHttpPayload,
  mapModelStatusResponseFromHttpPayload,
  mapStartTaskRequest,
  mapStartTaskResponse,
  mapTaskStatusResponse,
  mapUnloadModelsResponseFromHttpPayload,
} from "../protocol/pythonRuntimeHttpProtocol";
import { normalizePythonRuntimeLoopbackBaseUrl } from "../config/pythonRuntimeEndpoint";
import { PYTHON_RUNTIME_TASK_TIMEOUTS } from "../pythonRuntimeTaskTimeoutPolicy";

export interface PythonRuntimeHttpClient {
  getHealthStatus(): Promise<PythonRuntimeHealthCheckResult>;
  getCapabilities(): Promise<PythonRuntimeCapabilitiesResult>;
  ensureModelDownloaded(request: {
    provider: "transformers";
    modelId: string;
    inferenceMode?: string;
    taskTags?: string[];
    artifactForm?: string;
  }): Promise<{
    provider: "transformers";
    modelId: string;
    downloaded: boolean;
    fromCache: boolean;
    localPath?: string;
  }>;
  resolveModelDownloadTaskResult(
    payload: unknown,
  ): Promise<CompletedModelDownload>;
  getModelStatus(): Promise<PythonRuntimeModelStatusResult>;
  unloadModels(): Promise<PythonRuntimeUnloadModelsResult>;
  startTask(
    request: StartPythonRuntimeTaskRequest,
  ): Promise<StartPythonRuntimeTaskResult>;
  readTaskStatus(requestId: string): Promise<PythonRuntimeTaskStatusResult>;
  cancelTask(requestId: string): Promise<CancelPythonRuntimeTaskResult>;
}

export interface CreatePythonRuntimeHttpClientOptions {
  baseUrl: string;
  authorizationToken?: string;
  authorizationTokenProvider?: () => string;
  fetchImplementation?: typeof fetch;
  defaultTaskTimeoutMs?: number;
  transportRequestTimeoutMs?: number;
  modelDownloadTimeoutMs?: number;
  modelDownloadPollIntervalMs?: number;
  environment?: NodeJS.ProcessEnv;
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

    throw new Error(
      `Python runtime request failed for ${endpoint} with invalid JSON response body.`,
    );
  }
}

function resolveConfiguredModelCacheRoot(
  environment: NodeJS.ProcessEnv,
): string {
  const configured =
    environment.HF_HUB_CACHE?.trim() || environment.TRANSFORMERS_CACHE?.trim();
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw new TypeError("Python runtime model cache root must be absolute.");
    }
    return path.resolve(configured);
  }
  const hfHome = environment.HF_HOME?.trim();
  if (hfHome) {
    if (!path.isAbsolute(hfHome)) {
      throw new TypeError("Python runtime Hugging Face home must be absolute.");
    }
    return path.resolve(hfHome, "hub");
  }
  return path.join(homedir(), ".cache", "huggingface", "hub");
}

async function resolveModelCacheHandle(
  cacheRoot: string,
  modelHandle: string,
): Promise<string> {
  if (
    modelHandle.length > 1_024 ||
    modelHandle.includes("\\") ||
    path.posix.isAbsolute(modelHandle)
  ) {
    throw new TypeError(
      "Python runtime returned an invalid model cache handle.",
    );
  }
  const segments = modelHandle.split("/");
  if (
    segments.length < 3 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9._-]+$/.test(segment),
    )
  ) {
    throw new TypeError(
      "Python runtime returned an invalid model cache handle.",
    );
  }
  const rootStats = await lstat(cacheRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new TypeError("Python runtime model cache root is invalid.");
  }
  const canonicalRoot = await realpath(cacheRoot);
  let candidate = canonicalRoot;
  for (const segment of segments) {
    candidate = path.join(candidate, segment);
    const stats = await lstat(candidate);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new TypeError("Python runtime model cache handle is invalid.");
    }
    candidate = await realpath(candidate);
    const relativeCandidate = path.relative(canonicalRoot, candidate);
    if (
      relativeCandidate.startsWith("..") ||
      path.isAbsolute(relativeCandidate)
    ) {
      throw new TypeError(
        "Python runtime model cache handle escaped its root.",
      );
    }
  }
  return candidate;
}

async function mapModelDownloadPayload(
  endpoint: string,
  payload: unknown,
  cacheRoot: string,
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(
      `Python runtime request failed for ${endpoint} with invalid structured payload.`,
    );
  }

  const record = payload as Record<string, unknown>;
  if (
    record.provider !== "transformers" ||
    typeof record.modelId !== "string" ||
    typeof record.modelHandle !== "string" ||
    "localPath" in record
  ) {
    throw new Error(
      `Python runtime request failed for ${endpoint} with invalid structured payload.`,
    );
  }

  const localPath = await resolveModelCacheHandle(
    cacheRoot,
    record.modelHandle,
  );
  return {
    provider: "transformers" as const,
    modelId: record.modelId,
    downloaded: record.downloaded === true,
    fromCache: record.fromCache === true,
    localPath,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const RUNTIME_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const HUGGING_FACE_MODEL_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

function assertRuntimeRequestId(requestId: string): void {
  if (!RUNTIME_REQUEST_ID_PATTERN.test(requestId)) {
    throw new TypeError("Python runtime task identifier is invalid.");
  }
}

function assertHuggingFaceModelId(modelId: string): void {
  if (modelId.length > 193 || !HUGGING_FACE_MODEL_ID_PATTERN.test(modelId)) {
    throw new TypeError(
      "Python runtime model identifier must use the canonical owner/model format.",
    );
  }
}

function summarizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.length > 0) {
    return code;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") {
    return undefined;
  }

  const causeCode = (cause as { code?: unknown }).code;
  return typeof causeCode === "string" && causeCode.length > 0
    ? causeCode
    : undefined;
}

function isRecoverableRuntimePollError(error: unknown): boolean {
  const message = summarizeError(error).toLowerCase();
  const code = readErrorCode(error);

  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("terminated") ||
    code?.startsWith("UND_ERR_") === true ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "EPIPE" ||
    code === "EAI_AGAIN"
  );
}

export function createPythonRuntimeHttpClient(
  options: CreatePythonRuntimeHttpClientOptions,
): PythonRuntimeHttpClient {
  const fetcher = options.fetchImplementation ?? fetch;
  const modelCacheRoot = resolveConfiguredModelCacheRoot(
    options.environment ?? process.env,
  );
  const baseUrl = normalizePythonRuntimeLoopbackBaseUrl(options.baseUrl);
  const defaultTaskTimeoutMs = Math.min(
    Math.max(options.defaultTaskTimeoutMs ?? 120_000, 1_000),
    24 * 60 * 60 * 1_000,
  );
  const transportRequestTimeoutMs = Math.min(
    Math.max(options.transportRequestTimeoutMs ?? 30_000, 100),
    120_000,
  );
  const modelDownloadTimeoutMs = Math.min(
    Math.max(
      options.modelDownloadTimeoutMs ??
        PYTHON_RUNTIME_TASK_TIMEOUTS.modelDownload,
      1_000,
    ),
    PYTHON_RUNTIME_TASK_TIMEOUTS.modelDownload,
  );
  const modelDownloadPollIntervalMs = Math.min(
    Math.max(options.modelDownloadPollIntervalMs ?? 2_000, 10),
    10_000,
  );
  const authenticatedFetch = async (
    endpoint: string,
    diagnosticEndpoint: string,
    init: RequestInit,
  ): Promise<Response> => {
    const authorizationToken = (
      options.authorizationTokenProvider?.() ?? options.authorizationToken
    )?.trim();
    if (!authorizationToken || authorizationToken.length < 32) {
      throw new Error("Python runtime launch authentication is unavailable.");
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      transportRequestTimeoutMs,
    );
    try {
      return await fetcher(`${baseUrl}${endpoint}`, {
        ...init,
        headers: {
          ...(init.headers as Readonly<Record<string, string>> | undefined),
          authorization: `Bearer ${authorizationToken}`,
        },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `Python runtime request timed out for ${diagnosticEndpoint}.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async getHealthStatus() {
      const response = await authenticatedFetch("/health", "/health", {
        method: "GET",
      });
      const payload = await parseJsonResponseSafe(response);
      return mapRuntimeResponsePayload(
        "/health",
        response,
        payload,
        mapHealthResponseFromHttpPayload,
      );
    },

    async getCapabilities() {
      const response = await authenticatedFetch(
        "/capabilities",
        "/capabilities",
        { method: "GET" },
      );
      const payload = await parseJsonResponseSafe(response);
      return mapRuntimeResponsePayload(
        "/capabilities",
        response,
        payload,
        mapCapabilitiesResponseFromHttpPayload,
      );
    },

    async ensureModelDownloaded(request) {
      assertHuggingFaceModelId(request.modelId);
      const requestId = `model-download-${randomUUID()}`;
      await this.startTask({
        requestId,
        taskType: "ensure-model-download",
        payload: request,
        timeoutMs: modelDownloadTimeoutMs,
      });

      const deadline = Date.now() + modelDownloadTimeoutMs;
      let recoverablePollFailureCount = 0;
      while (Date.now() <= deadline) {
        let status: PythonRuntimeTaskStatusResult;
        try {
          status = await this.readTaskStatus(requestId);
        } catch (error) {
          if (!isRecoverableRuntimePollError(error)) {
            throw error;
          }

          recoverablePollFailureCount += 1;
          await delay(modelDownloadPollIntervalMs);
          continue;
        }

        if (status.status === "succeeded") {
          return await mapModelDownloadPayload(
            "/tasks/:requestId",
            status.data,
            modelCacheRoot,
          );
        }
        if (status.status === "failed" || status.status === "cancelled") {
          const message =
            status.error?.message ??
            `Python runtime model download task ended with status ${status.status}.`;
          throw new Error(`Python runtime model download failed: ${message}`);
        }
        await delay(modelDownloadPollIntervalMs);
      }

      await this.cancelTask(requestId).catch(() => undefined);
      throw new Error(
        `Python runtime model download timed out after ${modelDownloadTimeoutMs}ms${
          recoverablePollFailureCount > 0
            ? ` following ${recoverablePollFailureCount} recoverable polling failure(s)`
            : ""
        }.`,
      );
    },

    async resolveModelDownloadTaskResult(payload) {
      return mapModelDownloadPayload(
        "/tasks/:requestId",
        payload,
        modelCacheRoot,
      );
    },

    async getModelStatus() {
      const response = await authenticatedFetch(
        "/models/status",
        "/models/status",
        { method: "GET" },
      );
      const payload = await parseJsonResponseSafe(response);
      return mapRuntimeResponsePayload(
        "/models/status",
        response,
        payload,
        mapModelStatusResponseFromHttpPayload,
      );
    },

    async unloadModels() {
      const response = await authenticatedFetch(
        "/models/unload",
        "/models/unload",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
        },
      );
      const payload = await parseJsonResponseSafe(response);
      if (
        !response.ok &&
        payload &&
        typeof payload === "object" &&
        "error" in payload
      ) {
        const error = (payload as { error?: { message?: unknown } }).error;
        const message =
          typeof error?.message === "string"
            ? error.message
            : `Python runtime request failed for /models/unload with status ${response.status}.`;
        throw new Error(`Python runtime model unload failed: ${message}`);
      }

      return mapRuntimeResponsePayload(
        "/models/unload",
        response,
        payload,
        mapUnloadModelsResponseFromHttpPayload,
      );
    },
    async startTask(request: StartPythonRuntimeTaskRequest) {
      assertRuntimeRequestId(request.requestId);
      const timeoutMs = Math.min(
        Math.max(request.timeoutMs ?? defaultTaskTimeoutMs, 1_000),
        24 * 60 * 60 * 1_000,
      );
      const response = await authenticatedFetch(
        "/tasks/start",
        "/tasks/start",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(mapStartTaskRequest({ ...request, timeoutMs })),
        },
      );
      const payload = await parseJsonResponseSafe(response);
      return mapRuntimeResponsePayload(
        "/tasks/start",
        response,
        payload,
        mapStartTaskResponse,
      );
    },
    async readTaskStatus(requestId: string) {
      assertRuntimeRequestId(requestId);
      const response = await authenticatedFetch(
        `/tasks/${encodeURIComponent(requestId)}`,
        "/tasks/:requestId",
        { method: "GET" },
      );
      const payload = await parseJsonResponseSafe(response);
      return mapRuntimeResponsePayload(
        "/tasks/:requestId",
        response,
        payload,
        mapTaskStatusResponse,
      );
    },
    async cancelTask(requestId: string) {
      assertRuntimeRequestId(requestId);
      const response = await authenticatedFetch(
        `/tasks/${encodeURIComponent(requestId)}/cancel`,
        "/tasks/:requestId/cancel",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
        },
      );
      const payload = await parseJsonResponseSafe(response);
      return mapRuntimeResponsePayload(
        "/tasks/:requestId/cancel",
        response,
        payload,
        mapCancelTaskResponse,
      );
    },
  };
}
