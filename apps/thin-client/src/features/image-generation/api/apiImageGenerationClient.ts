import { secureFetch } from "../../../security/secureFetch";
import type { ImageGenerationRequest } from "../../../../../../modules/contracts/image-generation";
import type { RuntimeTaskRecord } from "../../../../../../modules/contracts/runtime";

import { parseApiEnvelope, toThinClientApiError } from "../../../security/apiErrorEnvelope";

interface ApiResponseEnvelope {
  ok: boolean;
  value?: unknown;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
}

export interface FinalizedImageAsset {
  assetId: string;
  artifactId: string;
  storageKey: string;
  mediaType: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface FinalizeImageGenerationResult {
  finalized: boolean;
  reason?: string;
  assets?: FinalizedImageAsset[];
}

export interface CancelImageGenerationResult {
  cancelled: boolean;
  message?: string;
  status?: string;
}

export interface UnloadImageGenerationModelResult {
  unloaded: boolean;
  message?: string;
}

export interface ImageGenerationApiClient {
  startImageGeneration: (input: ImageGenerationRequest & { workspaceId?: string }, context?: { source?: string }) => Promise<{ requestId: string }>;
  readImageGeneration: (input: { requestId: string; workspaceId?: string }, context?: { source?: string }) => Promise<RuntimeTaskRecord>;
  cancelImageGeneration: (input: { requestId: string; workspaceId?: string }, context?: { source?: string }) => Promise<CancelImageGenerationResult>;
  finalizeImageGenerationIfCompleted: (input: { requestId: string; workspaceId?: string }, context?: { source?: string }) => Promise<FinalizeImageGenerationResult>;
  unloadModel: (context?: { source?: string }) => Promise<UnloadImageGenerationModelResult>;
  readRuntimeResources: (context?: { source?: string }) => Promise<{ memoryUsagePercent: number; cpuUsagePercent: number; gpuUsagePercent: number }>;
  createArtifactMediaViewUrl: (storageKey: string, context?: { workspaceId?: string }) => string;
}

const createApiUrl = (baseUrl: string, suffix: string): string => `${baseUrl.trim().replace(/\/+$/, "") || "/api"}${suffix}`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function ensureEnvelope(value: unknown): ApiResponseEnvelope {
  return parseApiEnvelope(value) as ApiResponseEnvelope;
}

function createApiError(response: ApiResponseEnvelope, status: number, endpoint: string): Error {
  const apiError = toThinClientApiError(status, endpoint, response as any);
  const error = new Error(apiError.message) as Error & { code?: string; details?: Record<string, unknown>; status?: number; endpoint?: string };
  error.code = apiError.code;
  error.details = apiError.details as Record<string, unknown> | undefined;
  error.status = apiError.status;
  error.endpoint = apiError.endpoint;
  return error;
}

function ensureSuccess<T>(response: ApiResponseEnvelope, status: number, endpoint: string, pick: (value: unknown) => T): T {
  if (!response.ok) throw createApiError(response, status, endpoint);
  return pick(response.value);
}

async function postJson(baseUrl: string, path: string, body: Record<string, unknown>, source: string): Promise<{ envelope: ApiResponseEnvelope; status: number; endpoint: string }> {
  const endpoint = createApiUrl(baseUrl, path);
  const response = await secureFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "x-client-source": source },
    body: JSON.stringify(body),
  });

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new Error(`Image generation API returned non-JSON response (HTTP ${response.status}).`);
  }

  return { envelope: ensureEnvelope(parsed), status: response.status, endpoint };
}

function expectRequestId(value: unknown): { requestId: string } {
  if (!isRecord(value) || typeof value.requestId !== "string" || value.requestId.trim().length === 0) {
    throw new Error("Image generation start response missing requestId.");
  }
  return { requestId: value.requestId };
}

function expectTaskRecord(value: unknown): RuntimeTaskRecord {
  if (!isRecord(value) || typeof value.requestId !== "string" || typeof value.status !== "string") {
    throw new Error("Image generation read response is malformed.");
  }
  return value as unknown as RuntimeTaskRecord;
}

function expectCancelResult(value: unknown): CancelImageGenerationResult {
  if (!isRecord(value) || typeof value.cancelled !== "boolean") throw new Error("Image generation cancel response is malformed.");
  return value as unknown as CancelImageGenerationResult;
}

function expectUnloadModelResult(value: unknown): UnloadImageGenerationModelResult {
  if (!isRecord(value) || typeof value.unloaded !== "boolean") throw new Error("Image generation unload response is malformed.");
  return value as unknown as UnloadImageGenerationModelResult;
}

function expectFinalizeResult(value: unknown): FinalizeImageGenerationResult {
  if (!isRecord(value) || typeof value.finalized !== "boolean") throw new Error("Image generation finalize response is malformed.");
  return value as unknown as FinalizeImageGenerationResult;
}
function expectRuntimeResources(value: unknown): { memoryUsagePercent: number; cpuUsagePercent: number; gpuUsagePercent: number } {
  if (!isRecord(value)) throw new Error("Image generation runtime resources response is malformed.");
  const toPercent = (input: unknown) => {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    memoryUsagePercent: toPercent(value.memoryUsagePercent),
    cpuUsagePercent: toPercent(value.cpuUsagePercent),
    gpuUsagePercent: toPercent(value.gpuUsagePercent),
  };
}

export function createApiImageGenerationClient(options: { apiBaseUrl?: string; source?: string } = {}): ImageGenerationApiClient {
  const apiBaseUrl = options.apiBaseUrl ?? "/api";
  const source = options.source ?? "thin-client.image-generation";

  return {
    async startImageGeneration(input, context) {
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/image-generation/start", { ...input }, context?.source ?? source);
      return ensureSuccess(envelope, status, endpoint, expectRequestId);
    },
    async readImageGeneration(input, context) {
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/image-generation/read", { ...input }, context?.source ?? source);
      return ensureSuccess(envelope, status, endpoint, expectTaskRecord);
    },
    async cancelImageGeneration(input, context) {
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/image-generation/cancel", { ...input }, context?.source ?? source);
      return ensureSuccess(envelope, status, endpoint, expectCancelResult);
    },
    async finalizeImageGenerationIfCompleted(input, context) {
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/image-generation/finalize", { ...input }, context?.source ?? source);
      return ensureSuccess(envelope, status, endpoint, expectFinalizeResult);
    },
    async unloadModel(context) {
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/image-generation/unload-model", {}, context?.source ?? source);
      return ensureSuccess(envelope, status, endpoint, expectUnloadModelResult);
    },
    async readRuntimeResources(context) {
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/image-generation/runtime-resources", {}, context?.source ?? source);
      return ensureSuccess(envelope, status, endpoint, expectRuntimeResources);
    },
    createArtifactMediaViewUrl(storageKey, context) {
      const query = new URLSearchParams({ storageKey });
      if (context?.workspaceId) {
        query.set("workspaceId", context.workspaceId);
      }
      return createApiUrl(apiBaseUrl, `/artifact/media/view?${query.toString()}`);
    },
  };
}
