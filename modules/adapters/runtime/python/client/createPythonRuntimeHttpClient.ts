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
import {normalizeModelDownloadRevision} from "../../../../contracts/model";
import {captureModelManifestPayload, captureManifestExpectation, readVerifiedManifestDigest, type RuntimeModelDownloadManifest} from "./modelDownloadManifest";
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
    revision?: string;
    sourceManifest?: RuntimeModelDownloadManifest;
    inferenceMode?: string;
    taskTags?: string[];
    artifactForm?: string;
  }): Promise<{
    provider: "transformers";
    modelId: string;
    revision?: string;
    verifiedManifestDigest?: string;
    downloaded: boolean;
    fromCache: boolean;
    localPath?: string;
  }>;
  resolveModelDownloadTaskResult(
    payload: unknown,
    expectedManifest?: RuntimeModelDownloadManifest,
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
  /** Private managed-foundation guard. Capture and recheck the same owned launch. */
  captureProcessOwnership?: () => (() => void);
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

export function resolveConfiguredModelCacheRoot(
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
  assertCurrent: () => void = () => {},
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
  assertCurrent();
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new TypeError("Python runtime model cache root is invalid.");
  }
  const canonicalRoot = await realpath(cacheRoot);
  assertCurrent();
  let candidate = canonicalRoot;
  for (const segment of segments) {
    candidate = path.join(candidate, segment);
    const stats = await lstat(candidate);
    assertCurrent();
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new TypeError("Python runtime model cache handle is invalid.");
    }
    candidate = await realpath(candidate);
    assertCurrent();
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
  assertCurrent: () => void = () => {},
  expectedManifest?: {readonly modelId: string; readonly revision: string; readonly manifestDigest: string},
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

  const revision = normalizeModelDownloadRevision(record.revision);
  const verifiedManifestDigest = readVerifiedManifestDigest(record.verifiedManifestDigest);
  if (expectedManifest && (record.modelId !== expectedManifest.modelId || revision !== expectedManifest.revision ||
      verifiedManifestDigest !== expectedManifest.manifestDigest ||
      record.modelHandle !== `models--${expectedManifest.modelId.replace("/", "--")}/snapshots/${expectedManifest.revision}`))
    throw new Error("The selected model files could not be verified.");
  const modelId = record.modelId, downloaded = record.downloaded === true, fromCache = record.fromCache === true;
  const localPath = await resolveModelCacheHandle(
    cacheRoot,
    record.modelHandle,
    assertCurrent,
  );
  assertCurrent();
  return {
    provider: "transformers" as const,
    modelId,
    ...(revision === undefined ? {} : {revision}),
    ...(verifiedManifestDigest === undefined ? {} : {verifiedManifestDigest}),
    downloaded,
    fromCache,
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
  const captureOwnership = options.captureProcessOwnership;
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
  ): Promise<{ response: Response; payload: unknown; assertOwnedProcess: () => void }> => {
    const assertOwnedProcess = captureOwnership?.() ?? (() => {});
    assertOwnedProcess();
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
      const response = await fetcher(`${baseUrl}${endpoint}`, {
        ...init,
        headers: {
          ...(init.headers as Readonly<Record<string, string>> | undefined),
          authorization: `Bearer ${authorizationToken}`,
        },
        signal: controller.signal,
      });
      assertOwnedProcess();
      const payload = await parseJsonResponseSafe(response);
      assertOwnedProcess();
      return { response, payload, assertOwnedProcess };
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
      const { response, payload, assertOwnedProcess } = await authenticatedFetch("/health", "/health", {
        method: "GET",
      });
      assertOwnedProcess();
      return mapRuntimeResponsePayload(
        "/health",
        response,
        payload,
        mapHealthResponseFromHttpPayload,
      );
    },

    async getCapabilities() {
      const { response, payload, assertOwnedProcess } = await authenticatedFetch(
        "/capabilities",
        "/capabilities",
        { method: "GET" },
      );
      assertOwnedProcess();
      return mapRuntimeResponsePayload(
        "/capabilities",
        response,
        payload,
        mapCapabilitiesResponseFromHttpPayload,
      );
    },

    async ensureModelDownloaded(request) {
      const assertCurrent = captureOwnership?.() ?? (() => {});
      assertCurrent();
      const selected = captureModelManifestPayload(request);
      const revision = normalizeModelDownloadRevision(selected.payload.revision);
      const captured = revision === undefined ? selected.payload : structuredClone({...selected.payload, revision});
      assertHuggingFaceModelId(captured.modelId);
      const requestId = `model-download-${randomUUID()}`;
      await this.startTask({
        requestId,
        taskType: "ensure-model-download",
        payload: captured,
        timeoutMs: modelDownloadTimeoutMs,
      });

      assertCurrent();
      const deadline = Date.now() + modelDownloadTimeoutMs;
      let recoverablePollFailureCount = 0;
      while (Date.now() <= deadline) {
        assertCurrent();
        let status: PythonRuntimeTaskStatusResult;
        try {
          status = await this.readTaskStatus(requestId);
          assertCurrent();
        } catch (error) {
          assertCurrent();
          if (!isRecoverableRuntimePollError(error)) {
            throw error;
          }

          recoverablePollFailureCount += 1;
          await delay(modelDownloadPollIntervalMs);
          assertCurrent();
          continue;
        }

        if (status.status === "succeeded") {
          const result = await mapModelDownloadPayload(
            "/tasks/:requestId",
            status.data,
            modelCacheRoot,
            assertCurrent,
            selected.manifest ? {modelId: selected.manifest.source.modelId, revision: selected.manifest.source.revision,
              manifestDigest: selected.manifest.manifestDigest} : undefined,
          );
          assertCurrent();
          if (revision !== undefined && (result.revision !== revision || result.modelId !== captured.modelId))
            throw new Error("Pinned model download revision could not be confirmed.");
          if (selected.manifest && result.verifiedManifestDigest !== selected.manifest.manifestDigest)
            throw new Error("The selected model files could not be verified.");
          return result;
        }
        if (status.status === "failed" || status.status === "cancelled") {
          const message =
            status.error?.message ??
            `Python runtime model download task ended with status ${status.status}.`;
          throw new Error(`Python runtime model download failed: ${message}`);
        }
        await delay(modelDownloadPollIntervalMs);
        assertCurrent();
      }

      assertCurrent();
      await this.cancelTask(requestId).catch(() => undefined);
      assertCurrent();
      throw new Error(
        `Python runtime model download timed out after ${modelDownloadTimeoutMs}ms${
          recoverablePollFailureCount > 0
            ? ` following ${recoverablePollFailureCount} recoverable polling failure(s)`
            : ""
        }.`,
      );
    },

    async resolveModelDownloadTaskResult(payload, expectedManifest) {
      const expected = expectedManifest === undefined ? undefined : captureManifestExpectation(expectedManifest);
      if (!expected && payload && typeof payload === "object" && "verifiedManifestDigest" in payload)
        throw new Error("The model completion requires its accepted source manifest.");
      return mapModelDownloadPayload(
        "/tasks/:requestId",
        payload,
        modelCacheRoot,
        captureOwnership?.() ?? (() => {}),
        expected ? {modelId: expected.source.modelId, revision: expected.source.revision, manifestDigest: expected.manifestDigest} : undefined,
      );
    },

    async getModelStatus() {
      const { response, payload, assertOwnedProcess } = await authenticatedFetch(
        "/models/status",
        "/models/status",
        { method: "GET" },
      );
      assertOwnedProcess();
      return mapRuntimeResponsePayload(
        "/models/status",
        response,
        payload,
        mapModelStatusResponseFromHttpPayload,
      );
    },

    async unloadModels() {
      const { response, payload, assertOwnedProcess } = await authenticatedFetch(
        "/models/unload",
        "/models/unload",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
        },
      );
      assertOwnedProcess();
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
      const selection = request.taskType === "ensure-model-download" ? captureModelManifestPayload(request.payload) : {payload: request.payload};
      if (selection.manifest) request = {...request, payload: selection.payload};
      const body = request.payload;
      const revision = request.taskType === "ensure-model-download" && body !== null && typeof body === "object" && !Array.isArray(body)
        ? normalizeModelDownloadRevision((body as {revision?: unknown}).revision) : undefined;
      if (revision !== undefined) {
        const assertCurrent = captureOwnership?.() ?? (() => {});
        assertCurrent();
        request = structuredClone(request);
        const capabilities = await this.getCapabilities();
        assertCurrent();
        if (!capabilities.capabilities.includes("ensure-model-download.exact-revision-v1"))
          throw new Error("Exact model version downloads are unavailable for this worker.");
        if (selection.manifest && !capabilities.capabilities.includes("ensure-model-download.source-manifest-v1"))
          throw new Error("Exact model file downloads are unavailable for this worker.");
      }
      const timeoutMs = Math.min(
        Math.max(request.timeoutMs ?? defaultTaskTimeoutMs, 1_000),
        24 * 60 * 60 * 1_000,
      );
      const { response, payload, assertOwnedProcess } = await authenticatedFetch(
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
      assertOwnedProcess();
      return mapRuntimeResponsePayload(
        "/tasks/start",
        response,
        payload,
        mapStartTaskResponse,
      );
    },
    async readTaskStatus(requestId: string) {
      assertRuntimeRequestId(requestId);
      const { response, payload, assertOwnedProcess } = await authenticatedFetch(
        `/tasks/${encodeURIComponent(requestId)}`,
        "/tasks/:requestId",
        { method: "GET" },
      );
      assertOwnedProcess();
      return mapRuntimeResponsePayload(
        "/tasks/:requestId",
        response,
        payload,
        mapTaskStatusResponse,
      );
    },
    async cancelTask(requestId: string) {
      assertRuntimeRequestId(requestId);
      const { response, payload, assertOwnedProcess } = await authenticatedFetch(
        `/tasks/${encodeURIComponent(requestId)}/cancel`,
        "/tasks/:requestId/cancel",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
        },
      );
      assertOwnedProcess();
      return mapRuntimeResponsePayload(
        "/tasks/:requestId/cancel",
        response,
        payload,
        mapCancelTaskResponse,
      );
    },
  };
}
