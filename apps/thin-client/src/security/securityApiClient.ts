import { parseApiEnvelope, toThinClientApiError } from "./apiErrorEnvelope";
import { secureFetch } from "./secureFetch";
import type { ThinClientSecurityError } from "./securityErrors";

export interface SecurityStatusResult { mode: "disabled-dev" | "lan-https-token"; httpsEnabled: boolean; httpsRequired: boolean; authRequired: boolean; pairingEnabled: boolean; pairedDeviceCount?: number; currentPrincipal?: { displayName?: string; deviceName?: string; deviceId?: string }; devSecurityToggleEnabled?: boolean; devSecurityEnforcementMode?: "disabled-dev" | "lan-token-enforced"; requiresRestartToChangeTransportSecurity?: boolean; tls?: { mode?: "manual" | "auto-self-signed" | "auto-local-ca"; source?: "manual" | "generated" | "reused" | "not-required"; hosts?: readonly string[]; expiresAt?: string; localCa?: { available: boolean; source?: "generated" | "reused"; downloadUrl?: string; expiresAt?: string; trustInstalled?: false; trustInstallationRequired?: boolean } } }
export interface CompletePairingRequest { pairingCode: string; deviceName?: string; requestedScopes?: string[] }
export interface CompletePairingResult { bearerToken: string; deviceId?: string; deviceName?: string; grantedScopes?: string[] }

const apiUrl = (base: string, suffix: string) => `${base.trim().replace(/\/+$/, "") || "/api"}${suffix}`;

const toSecurityError = (status: number, endpoint: string, envelope?: unknown): ThinClientSecurityError => {
  const apiError = toThinClientApiError(status, endpoint, envelope as never);
  return { status: apiError.status, endpoint: apiError.endpoint, code: apiError.code, message: apiError.message, details: apiError.details };
};

async function send(baseUrl: string, path: string, init: RequestInit, secure = false): Promise<unknown> {
  const endpoint = apiUrl(baseUrl, path);
  const response = await (secure ? secureFetch : fetch)(endpoint, init);
  const raw = await response.json();
  let envelope: ReturnType<typeof parseApiEnvelope> | undefined;
  try { envelope = parseApiEnvelope(raw); } catch { throw toSecurityError(response.status, endpoint); }
  if (!envelope.ok) throw toSecurityError(response.status, endpoint, envelope);
  return envelope.value;
}

export function createSecurityApiClient(options: { apiBaseUrl?: string } = {}) {
  const apiBaseUrl = options.apiBaseUrl ?? "/api";
  return {
    getSecurityStatus: async (opts: { includeAuth?: boolean } = {}): Promise<SecurityStatusResult> => {
      const value = await send(apiBaseUrl, "/security/status", { method: "GET" }, opts.includeAuth === true);
      return value as SecurityStatusResult;
    },

    getDevSecurityMode: async (): Promise<DevSecurityModeResult> => {
      const value = await send(apiBaseUrl, "/security/dev-mode", { method: "GET" }, false);
      return value as DevSecurityModeResult;
    },
    setDevSecurityMode: async (mode: "disabled-dev" | "lan-token-enforced"): Promise<DevSecurityModeResult> => {
      const value = await send(apiBaseUrl, "/security/dev-mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) }, false);
      return value as DevSecurityModeResult;
    },
    completePairing: async (request: CompletePairingRequest): Promise<CompletePairingResult> => {
      const value = await send(apiBaseUrl, "/security/pairing/complete", { method: "POST", headers: { "content-type": "application/json", "x-client-source": "thin-client.security" }, body: JSON.stringify({ pairingCode: request.pairingCode, deviceName: request.deviceName, requestedScopes: request.requestedScopes }) }, false);
      return value as CompletePairingResult;
    },
  };
}

export interface DevSecurityModeResult { mode: "disabled-dev" | "lan-token-enforced" }
