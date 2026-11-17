import { SECURITY_ERROR_CODES, SECURITY_MODES, type SecurityErrorCode, type SecurityMode } from "../../../../modules/contracts/security";
import { parseApiEnvelope } from "./apiErrorEnvelope";
import { secureFetch } from "./secureFetch";
import { normalizeSecurityError, STATUS_FAILURE, type ThinClientSecurityError } from "./securityErrors";

export interface SecurityStatusResult {
  mode: SecurityMode;
  httpsEnabled: boolean;
  httpsRequired: boolean;
  authRequired: boolean;
  pairingEnabled: boolean;
  pairedDeviceCount?: number;
  currentPrincipal?: { displayName?: string; deviceName?: string; deviceId?: string; principalId?: string; kind?: "anonymous" | "device" | "user" | "service" };
  devSecurityToggleEnabled?: boolean;
  devSecurityEnforcementMode?: "disabled-dev" | "lan-token-enforced";
  requiresRestartToChangeTransportSecurity?: boolean;
  tls?: {
    mode?: "manual" | "auto-self-signed" | "auto-local-ca";
    source?: "manual" | "generated" | "reused" | "not-required";
    hosts?: readonly string[];
    expiresAt?: string;
    localCa?: { available: boolean; source?: "generated" | "reused"; downloadUrl?: string; expiresAt?: string; trustInstalled?: false; trustInstallationRequired?: boolean };
  };
}
export interface CompletePairingRequest { pairingCode: string; deviceName?: string; requestedScopes?: string[] }
export interface CompletePairingResult { bearerToken: string; deviceId?: string; deviceName?: string; grantedScopes?: string[] }
export interface DevSecurityModeResult { mode: "disabled-dev" | "lan-token-enforced" }
const apiUrl = (base: string, suffix: string) => (base.trim().replace(/\/+$/, "") || "/api") + suffix;
const object = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid response");
  return value as Record<string, unknown>;
};
function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error("invalid text");
  return value;
}
function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error("invalid flag");
  return value;
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error("invalid option");
  return value as T;
}
function strings(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error("invalid list");
  return value.map(item => item as string);
}

// This view model copies known fields. It does not authenticate a principal.
function readStatus(value: unknown): SecurityStatusResult {
  const raw = object(value);
  const mode = choice(raw.mode, SECURITY_MODES);
  if (!mode) throw new Error("missing mode");
  for (const key of ["httpsEnabled", "httpsRequired", "authRequired", "pairingEnabled"]) {
    if (typeof raw[key] !== "boolean") throw new Error("missing flag");
  }
  const result: SecurityStatusResult = {
    mode, httpsEnabled: raw.httpsEnabled as boolean, httpsRequired: raw.httpsRequired as boolean,
    authRequired: raw.authRequired as boolean, pairingEnabled: raw.pairingEnabled as boolean,
  };
  if (raw.pairedDeviceCount !== undefined) {
    if (!Number.isSafeInteger(raw.pairedDeviceCount) || (raw.pairedDeviceCount as number) < 0) throw new Error("invalid count");
    result.pairedDeviceCount = raw.pairedDeviceCount as number;
  }
  if (raw.currentPrincipal !== undefined) {
    const principal = object(raw.currentPrincipal);
    const deviceId = optionalText(principal.deviceId), principalId = optionalText(principal.principalId);
    const kind = choice(principal.kind, ["anonymous", "device", "user", "service"] as const);
    if (!deviceId && !principalId) throw new Error("missing principal identity");
    result.currentPrincipal = {
      ...(deviceId === undefined ? {} : { deviceId }), ...(principalId === undefined ? {} : { principalId }),
      ...(kind === undefined ? {} : { kind }),
      ...(principal.displayName === undefined ? {} : { displayName: optionalText(principal.displayName) }),
      ...(principal.deviceName === undefined ? {} : { deviceName: optionalText(principal.deviceName) }),
    };
  }
  for (const key of ["devSecurityToggleEnabled", "requiresRestartToChangeTransportSecurity"] as const) {
    if (raw[key] !== undefined) result[key] = optionalBoolean(raw[key]);
  }
  if (raw.devSecurityEnforcementMode !== undefined) result.devSecurityEnforcementMode = choice(raw.devSecurityEnforcementMode, ["disabled-dev", "lan-token-enforced"] as const);
  if (raw.tls !== undefined) {
    const tls = object(raw.tls);
    result.tls = {
      ...(tls.mode === undefined ? {} : { mode: choice(tls.mode, ["manual", "auto-self-signed", "auto-local-ca"] as const) }),
      ...(tls.source === undefined ? {} : { source: choice(tls.source, ["manual", "generated", "reused", "not-required"] as const) }),
      ...(tls.hosts === undefined ? {} : { hosts: strings(tls.hosts) }),
      ...(tls.expiresAt === undefined ? {} : { expiresAt: optionalText(tls.expiresAt) }),
    };
    if (tls.localCa !== undefined) {
      const ca = object(tls.localCa);
      if (typeof ca.available !== "boolean" || ca.trustInstalled !== undefined && ca.trustInstalled !== false) throw new Error("invalid CA");
      if (ca.downloadUrl !== undefined && ca.downloadUrl !== "/api/security/tls/local-ca.pem") throw new Error("invalid CA link");
      result.tls.localCa = {
        available: ca.available,
        ...(ca.source === undefined ? {} : { source: choice(ca.source, ["generated", "reused"] as const) }),
        ...(ca.downloadUrl === undefined ? {} : { downloadUrl: "/api/security/tls/local-ca.pem" }),
        ...(ca.expiresAt === undefined ? {} : { expiresAt: optionalText(ca.expiresAt) }),
        ...(ca.trustInstalled === undefined ? {} : { trustInstalled: false }),
        ...(ca.trustInstallationRequired === undefined ? {} : { trustInstallationRequired: optionalBoolean(ca.trustInstallationRequired) }),
      };
    }
  }
  return result;
}
function failure(status: number | undefined, envelope: unknown, message: string): ThinClientSecurityError {
  let code: unknown;
  try {
    const error = object(object(envelope).error);
    code = typeof error.operation === "string" && SECURITY_ERROR_CODES.includes(error.operation as SecurityErrorCode)
      ? error.operation : error.code;
  } catch { /* No diagnostic payload is copied. */ }
  return normalizeSecurityError({ status, code }, message);
}
async function send(baseUrl: string, path: string, init: RequestInit, secure: boolean, message: string): Promise<unknown> {
  let status: number | undefined;
  try {
    const response = await (secure ? secureFetch : fetch)(apiUrl(baseUrl, path), init);
    status = response.status;
    if (!Number.isInteger(status) || status < 200 || status > 599) throw failure(status, undefined, message);
    const envelope = parseApiEnvelope(await response.json());
    if (status < 200 || status >= 300 || !envelope.ok) throw failure(status, envelope, message);
    return envelope.value;
  } catch (error) {
    const safe = normalizeSecurityError(error, message);
    throw { ...safe, ...(safe.status === undefined && status !== undefined && status >= 400 && status <= 599 ? { status } : {}) };
  }
}

export function createSecurityApiClient(options: { apiBaseUrl?: string } = {}) {
  const apiBaseUrl = options.apiBaseUrl ?? "/api";
  return {
    async getSecurityStatus(opts: { includeAuth?: boolean } = {}): Promise<SecurityStatusResult> {
      try { return readStatus(await send(apiBaseUrl, "/security/status", { method: "GET" }, opts.includeAuth === true, STATUS_FAILURE)); }
      catch (error) { throw normalizeSecurityError(error, STATUS_FAILURE); }
    },
    async getDevSecurityMode(): Promise<DevSecurityModeResult> {
      const message = "Could not read security mode. Try again.";
      try {
        const value = object(await send(apiBaseUrl, "/security/dev-mode", { method: "GET" }, false, message));
        const mode = choice(value.mode, ["disabled-dev", "lan-token-enforced"] as const);
        if (!mode) throw new Error("missing mode");
        return { mode };
      } catch (error) { throw normalizeSecurityError(error, message); }
    },
    async setDevSecurityMode(mode: "disabled-dev" | "lan-token-enforced"): Promise<DevSecurityModeResult> {
      const message = "Could not update security mode. Try again.";
      try {
        if (mode !== "disabled-dev" && mode !== "lan-token-enforced") throw new Error("invalid mode");
        const value = object(await send(apiBaseUrl, "/security/dev-mode", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }),
        }, true, message));
        const returned = choice(value.mode, ["disabled-dev", "lan-token-enforced"] as const);
        if (!returned) throw new Error("missing mode");
        return { mode: returned };
      } catch (error) { throw normalizeSecurityError(error, message); }
    },
    async completePairing(request: CompletePairingRequest): Promise<CompletePairingResult> {
      const message = "Could not pair this device. Try again.";
      try {
        const value = object(await send(apiBaseUrl, "/security/pairing/complete", {
          method: "POST", headers: { "content-type": "application/json", "x-client-source": "thin-client.security" },
          body: JSON.stringify({ pairingCode: request.pairingCode, deviceName: request.deviceName, requestedScopes: request.requestedScopes }),
        }, false, message));
        if (typeof value.bearerToken !== "string" || !value.bearerToken || /\s/.test(value.bearerToken)) throw new Error("invalid pairing");
        new Headers({ Authorization: "Bearer " + value.bearerToken });
        return {
          bearerToken: value.bearerToken,
          ...(value.deviceId === undefined ? {} : { deviceId: optionalText(value.deviceId) }),
          ...(value.deviceName === undefined ? {} : { deviceName: optionalText(value.deviceName) }),
          ...(value.grantedScopes === undefined ? {} : { grantedScopes: strings(value.grantedScopes) }),
        };
      } catch (error) { throw normalizeSecurityError(error, message); }
    },
  };
}
