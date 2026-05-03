import {
  mapComfyUiHistoryResponse,
  mapComfyUiPromptResponse,
  mapComfyUiQueueResponse,
  type ComfyUiHistoryResponse,
  type ComfyUiPromptResponse,
  type ComfyUiQueueResponse,
} from "./comfyUiHttpProtocol";

export interface CreateComfyUiHttpClientOptions {
  baseUrl: string;
  fetchImplementation?: typeof fetch;
}

export interface ComfyUiHttpClient {
  getSystemStats(): Promise<unknown>;
  getQueue(): Promise<ComfyUiQueueResponse>;
  getHistory(): Promise<ComfyUiHistoryResponse>;
  submitPrompt(promptPayload: unknown): Promise<ComfyUiPromptResponse>;
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
  if (payload === undefined) {
    throw new Error(`ComfyUI request failed for ${endpoint} with status ${response.status} and invalid JSON response body.`);
  }

  if (!response.ok) {
    throw new Error(`ComfyUI request failed for ${endpoint} with status ${response.status}.`);
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

  return {
    async getSystemStats() {
      const response = await fetcher(`${baseUrl}/system_stats`, { method: "GET" });
      const payload = await parseJsonResponseSafe(response);
      return mapPayload("/system_stats", response, payload, (value) => value);
    },

    async getQueue() {
      const response = await fetcher(`${baseUrl}/queue`, { method: "GET" });
      const payload = await parseJsonResponseSafe(response);
      return mapPayload("/queue", response, payload, mapComfyUiQueueResponse);
    },

    async getHistory() {
      const response = await fetcher(`${baseUrl}/history`, { method: "GET" });
      const payload = await parseJsonResponseSafe(response);
      return mapPayload("/history", response, payload, mapComfyUiHistoryResponse);
    },

    async submitPrompt(promptPayload: unknown) {
      const response = await fetcher(`${baseUrl}/prompt`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(promptPayload),
      });
      const payload = await parseJsonResponseSafe(response);
      return mapPayload("/prompt", response, payload, mapComfyUiPromptResponse);
    },
  };
}
