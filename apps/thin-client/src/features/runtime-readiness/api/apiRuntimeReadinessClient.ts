import type {
  RuntimeCapabilityId,
  RuntimeCapabilityStatus,
  RuntimeReadinessSnapshot,
} from "../../../../../../modules/contracts/runtime";
import { parseApiEnvelope, toThinClientApiError } from "../../../security/apiErrorEnvelope";
import { secureFetch } from "../../../security/secureFetch";

interface ApiResponseEnvelope {
  ok: boolean;
  value?: unknown;
  error?: { code?: string; message?: string; details?: unknown; endpoint?: string };
}

export interface RuntimeReadinessApiClient {
  readRuntimeReadiness: () => Promise<RuntimeReadinessSnapshot>;
  readRuntimeCapabilityStatus: (capabilityId: RuntimeCapabilityId) => Promise<RuntimeCapabilityStatus>;
}

export interface CreateApiRuntimeReadinessClientOptions {
  apiBaseUrl?: string;
}

export class RuntimeReadinessApiError extends Error {
  public constructor(
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
    public readonly status?: number,
    public readonly endpoint?: string,
  ) {
    super(message);
  }
}

function createApiUrl(apiBaseUrl: string, suffix: string): string {
  return `${apiBaseUrl.trim().replace(/\/+$/, "") || "/api"}${suffix}`;
}

async function readJson(response: Response): Promise<ApiResponseEnvelope> {
  return parseApiEnvelope(await response.json()) as ApiResponseEnvelope;
}

function ensureSuccess<T>(response: ApiResponseEnvelope, status: number, endpoint: string): T {
  if (!response.ok) {
    const error = toThinClientApiError(status, endpoint, response);
    throw new RuntimeReadinessApiError(error.message, error.code, error.details, status, endpoint);
  }
  return response.value as T;
}

export function createApiRuntimeReadinessClient(
  options: CreateApiRuntimeReadinessClientOptions = {},
): RuntimeReadinessApiClient {
  const apiBaseUrl = options.apiBaseUrl ?? "/api";

  return {
    async readRuntimeReadiness() {
      const endpoint = createApiUrl(apiBaseUrl, "/runtime/readiness");
      const response = await secureFetch(endpoint);
      return ensureSuccess<RuntimeReadinessSnapshot>(await readJson(response), response.status, endpoint);
    },

    async readRuntimeCapabilityStatus(capabilityId) {
      const endpoint = createApiUrl(apiBaseUrl, `/runtime/capabilities/${encodeURIComponent(capabilityId)}`);
      const response = await secureFetch(endpoint);
      return ensureSuccess<RuntimeCapabilityStatus>(await readJson(response), response.status, endpoint);
    },
  };
}
