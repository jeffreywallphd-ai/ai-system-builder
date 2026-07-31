import {
  mapComfyUiHistoryResponse,
  mapComfyUiFreeMemoryResponse,
  mapComfyUiPromptResponse,
  mapComfyUiQueueResponse,
  type ComfyUiFreeMemoryResponse,
  type ComfyUiHistoryResponse,
  type ComfyUiPromptResponse,
  type ComfyUiQueueResponse,
} from "./comfyUiHttpProtocol";

export interface CreateComfyUiHttpClientOptions {
  baseUrl: string;
  fetchImplementation?: typeof fetch;
  requestTimeoutMs?: number;
}

export interface ComfyUiHttpClient {
  getSystemStats(): Promise<unknown>;
  getQueue(): Promise<ComfyUiQueueResponse>;
  getHistory(): Promise<ComfyUiHistoryResponse>;
  submitPrompt(promptPayload: unknown): Promise<ComfyUiPromptResponse>;
  cancelPrompt(promptId: string): Promise<{ cancelled: boolean }>;
  unloadModels(): Promise<ComfyUiFreeMemoryResponse>;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function parseJsonResponseSafe(response: Response): Promise<unknown | undefined> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function mapPayload<T>(endpoint: string, response: Response, payload: unknown | undefined, mapper: (payload: unknown) => T): T {
  if (!response.ok) {
    throw new Error(`ComfyUI request failed for ${endpoint} with status ${response.status}.`);
  }

  if (payload === undefined) {
    throw new Error(`ComfyUI request failed for ${endpoint} with status ${response.status} and invalid JSON response body.`);
  }

  try {
    return mapper(payload);
  } catch {
    throw new Error(`ComfyUI request failed for ${endpoint} with invalid structured payload.`);
  }
}

export function createComfyUiHttpClient(options: CreateComfyUiHttpClientOptions): ComfyUiHttpClient {
  const fetcher = options.fetchImplementation ?? fetch;
  const baseUrl = trimTrailingSlash(options.baseUrl);
  const requestTimeoutMs = Math.min(
    Math.max(options.requestTimeoutMs ?? 30_000, 1_000),
    120_000,
  );
  const boundedFetch = async (
    endpoint: string,
    init: RequestInit,
  ): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      return await fetcher(`${baseUrl}${endpoint}`, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`ComfyUI request timed out for ${endpoint}.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    async getSystemStats() {
      const response = await boundedFetch("/system_stats", { method: "GET" });
      const payload = await parseJsonResponseSafe(response);
      return mapPayload("/system_stats", response, payload, (value) => value);
    },

    async getQueue() {
      const response = await boundedFetch("/queue", { method: "GET" });
      const payload = await parseJsonResponseSafe(response);
      return mapPayload("/queue", response, payload, mapComfyUiQueueResponse);
    },

    async getHistory() {
      const response = await boundedFetch("/history", { method: "GET" });
      const payload = await parseJsonResponseSafe(response);
      return mapPayload("/history", response, payload, mapComfyUiHistoryResponse);
    },

    async submitPrompt(promptPayload: unknown) {
      const response = await boundedFetch("/prompt", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(promptPayload),
      });
      const payload = await parseJsonResponseSafe(response);
      return mapPayload("/prompt", response, payload, mapComfyUiPromptResponse);
    },

    async cancelPrompt(promptId) {
      if (!promptId.trim() || promptId.length > 256) {
        throw new Error("ComfyUI cancellation requires a valid prompt identifier.");
      }
      const response = await boundedFetch("/queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ delete: [promptId] }),
      });
      if (!response.ok) {
        throw new Error(
          `ComfyUI request failed for /queue with status ${response.status}.`,
        );
      }
      return { cancelled: true };
    },

    async unloadModels() {
      const response = await boundedFetch("/free", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ unload_models: true, free_memory: true }),
      });
      const payload = await parseJsonResponseSafe(response);
      if (response.ok && payload === undefined) {
        return { unloadedModels: true, freedMemory: true };
      }
      return mapPayload("/free", response, payload, mapComfyUiFreeMemoryResponse);
    },
  };
}
