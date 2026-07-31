import type {
  ApplicationSettingDefinition,
  ApplicationSettingKey,
  ApplicationSettingPrimitiveValue,
  ApplicationSettingValue,
} from "../../../../../../modules/contracts/settings";
import { parseApiEnvelope } from "../../../security/apiErrorEnvelope";
import { secureFetch } from "../../../security/secureFetch";

interface ApiResponseEnvelope {
  ok: boolean;
  value?: unknown;
  error?: { code?: string; message?: string; details?: unknown };
}

export interface ApplicationSettingsApiClient {
  listDefinitions: (input?: { category?: string; keys?: ApplicationSettingKey[] }) => Promise<{ definitions: ApplicationSettingDefinition[] }>;
  readSettings: (input?: { category?: string; keys?: ApplicationSettingKey[] }) => Promise<{ values: ApplicationSettingValue[] }>;
  updateSetting: (input: { key: ApplicationSettingKey; value: ApplicationSettingPrimitiveValue }) => Promise<{ value: ApplicationSettingValue }>;
  clearSetting: (input: { key: ApplicationSettingKey }) => Promise<{ value: ApplicationSettingValue }>;
  restartServer: () => Promise<{ restartRequested: boolean }>;
}

const createApiUrl = (baseUrl: string, suffix: string): string => `${baseUrl.trim().replace(/\/+$/, "") || "/api"}${suffix}`;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function createApiError(response: ApiResponseEnvelope, status: number, endpoint: string): Error {
  const error = new Error(response.error?.message ?? `Request failed (HTTP ${status}).`) as Error & { code?: string; status?: number; endpoint?: string };
  error.code = response.error?.code;
  error.status = status;
  error.endpoint = endpoint;
  return error;
}

function ensureSuccess<T>(response: ApiResponseEnvelope, status: number, endpoint: string, pick: (value: unknown) => T): T {
  if (!response.ok) throw createApiError(response, status, endpoint);
  return pick(response.value);
}

async function postJson(baseUrl: string, path: string, body: Record<string, unknown>): Promise<{ envelope: ApiResponseEnvelope; status: number; endpoint: string }> {
  const endpoint = createApiUrl(baseUrl, path);
  const response = await secureFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = await response.json();
  return { envelope: parseApiEnvelope(parsed) as ApiResponseEnvelope, status: response.status, endpoint };
}

function expectDefinitions(value: unknown): { definitions: ApplicationSettingDefinition[] } {
  if (!isRecord(value) || !Array.isArray(value.definitions)) throw new Error("Application settings definitions response is malformed.");
  return value as unknown as { definitions: ApplicationSettingDefinition[] };
}

function expectValues(value: unknown): { values: ApplicationSettingValue[] } {
  if (!isRecord(value) || !Array.isArray(value.values)) throw new Error("Application settings read response is malformed.");
  return value as unknown as { values: ApplicationSettingValue[] };
}

function expectValue(value: unknown): { value: ApplicationSettingValue } {
  if (!isRecord(value) || !isRecord(value.value)) throw new Error("Application settings update response is malformed.");
  return value as unknown as { value: ApplicationSettingValue };
}

function expectRestart(value: unknown): { restartRequested: boolean } {
  if (!isRecord(value) || value.restartRequested !== true) throw new Error("Server restart response is malformed.");
  return value as { restartRequested: boolean };
}

export function createApiApplicationSettingsClient(options: { apiBaseUrl?: string } = {}): ApplicationSettingsApiClient {
  const apiBaseUrl = options.apiBaseUrl ?? "/api";
  return {
    async listDefinitions(input = {}) {
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/application-settings/list-definitions", input);
      return ensureSuccess(envelope, status, endpoint, expectDefinitions);
    },
    async readSettings(input = {}) {
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/application-settings/read", input);
      return ensureSuccess(envelope, status, endpoint, expectValues);
    },
    async updateSetting(input) {
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/application-settings/update", input);
      return ensureSuccess(envelope, status, endpoint, expectValue);
    },
    async clearSetting(input) {
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/application-settings/clear", input);
      return ensureSuccess(envelope, status, endpoint, expectValue);
    },
    async restartServer() {
      const { envelope, status, endpoint } = await postJson(apiBaseUrl, "/server/restart", {});
      return ensureSuccess(envelope, status, endpoint, expectRestart);
    },
  };
}
