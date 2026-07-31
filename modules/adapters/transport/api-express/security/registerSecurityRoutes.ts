import type { Express } from "express";
import { createApiError, createApiFailureResponse, createApiSuccessResponse } from "../../../../contracts/api";
import { SECURITY_SCOPES, SecurityApplicationError, type CompleteLanPairingRequest, type SecurityScope, type AuthContext } from "../../../../contracts/security";
import { createSecurityApiFailure, mapSecurityFailure } from "./createSecurityApiFailure";
import { getExpressAuthContext } from "./expressAuthContext";
import type { DevSecurityEnforcementMode } from "./devSecurityEnforcement";

interface RevokeRequest { deviceId: string }
const KNOWN_SCOPES = new Set<SecurityScope>(SECURITY_SCOPES);
const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "object" || value === null) throw new Error("Request body must be an object.");
  return value as Record<string, unknown>;
};

function normalizePairingRequest(value: unknown): CompleteLanPairingRequest {
  const body = asRecord(value);
  if (typeof body.pairingCode !== "string" || body.pairingCode.trim().length < 1) throw new Error("pairingCode is required.");
  const normalized: CompleteLanPairingRequest = { pairingCode: body.pairingCode.trim() };
  if (body.deviceName !== undefined) {
    if (typeof body.deviceName !== "string" || body.deviceName.trim().length < 1) throw new Error("deviceName must be a non-empty string.");
    normalized.deviceName = body.deviceName.trim();
  }
  if (body.requestedScopes !== undefined) {
    if (!Array.isArray(body.requestedScopes)) throw new Error("requestedScopes must be an array.");
    const requestedScopes = body.requestedScopes.map((scope) => {
      if (typeof scope !== "string" || !KNOWN_SCOPES.has(scope as SecurityScope)) throw new Error("requestedScopes contains unknown scope.");
      return scope as SecurityScope;
    });
    normalized.requestedScopes = requestedScopes;
  }
  return normalized;
}

export function registerSecurityRoutes(app: Express, deps: { getStatus: (authContext?: AuthContext) => Promise<unknown>; completePairing: (body: CompleteLanPairingRequest) => Promise<unknown>; revokeToken: (body: RevokeRequest) => Promise<unknown>; getDevMode?: () => DevSecurityEnforcementMode; setDevMode?: (mode: DevSecurityEnforcementMode) => void; getLocalCaPem?: () => Promise<string | undefined>; }) {
  app.get('/api/security/status', async (req, res) => {
    try {
      res.status(200).json(createApiSuccessResponse("security.status", await deps.getStatus(getExpressAuthContext(req))));
    } catch (error) {
      if (error instanceof SecurityApplicationError) {
        const mapped = mapSecurityFailure(error);
        res.status(mapped.status).json(createSecurityApiFailure(mapped));
        return;
      }
      const message = error instanceof Error ? error.message : "Security status failed.";
      res.status(500).json(createApiFailureResponse(createApiError("security.status", "internal", message)));
    }
  });

  app.post('/api/security/pairing/complete', async (req, res) => {
    try {
      res.status(200).json(createApiSuccessResponse("security.pairing.complete", await deps.completePairing(normalizePairingRequest(req.body))));
    } catch (error) {
      if (error instanceof SecurityApplicationError) {
        const mapped = mapSecurityFailure(error);
        res.status(mapped.status).json(createSecurityApiFailure(mapped));
        return;
      }
      res.status(400).json(createApiFailureResponse(createApiError("security.pairing.complete", "validation", error instanceof Error ? error.message : "Invalid pairing request.")));
    }
  });


  app.get('/api/security/dev-mode', async (_req, res) => {
    if (!deps.getDevMode) { res.status(404).json(createSecurityApiFailure({ status: 404, code: "security.route-policy-missing", message: "Not found." })); return; }
    res.status(200).json(createApiSuccessResponse("security.dev-mode", { mode: deps.getDevMode() }));
  });

  app.post('/api/security/dev-mode', async (req, res) => {
    if (!deps.setDevMode) { res.status(404).json(createSecurityApiFailure({ status: 404, code: "security.route-policy-missing", message: "Not found." })); return; }
    const body = asRecord(req.body);
    if (body.mode !== "disabled-dev" && body.mode !== "lan-token-enforced") {
      res.status(400).json(createApiFailureResponse(createApiError("security.dev-mode", "validation", "mode must be disabled-dev or lan-token-enforced.")));
      return;
    }
    deps.setDevMode(body.mode);
    res.status(200).json(createApiSuccessResponse("security.dev-mode", { mode: body.mode }));
  });


  app.get('/api/security/tls/local-ca.pem', async (_req, res) => {
    if (!deps.getLocalCaPem) { res.status(404).json(createSecurityApiFailure({ status: 404, code: "security.route-policy-missing", message: "Not found." })); return; }
    const pem = await deps.getLocalCaPem();
    if (!pem) { res.status(404).json(createSecurityApiFailure({ status: 404, code: "security.route-policy-missing", message: "Not found." })); return; }
    res.status(200).type('application/x-pem-file').send(pem);
  });

  app.post('/api/security/token/revoke', async (req, res) => {
    try {
      const body = asRecord(req.body);
      if (typeof body.deviceId !== "string" || body.deviceId.trim().length < 1) throw new Error("deviceId is required.");
      res.status(200).json(createApiSuccessResponse("security.token.revoke", await deps.revokeToken({ deviceId: body.deviceId.trim() })));
    } catch (error) {
      if (error instanceof SecurityApplicationError) {
        const mapped = mapSecurityFailure(error);
        res.status(mapped.status).json(createSecurityApiFailure(mapped));
        return;
      }
      res.status(400).json(createApiFailureResponse(createApiError("security.token.revoke", "validation", error instanceof Error ? error.message : "Invalid revoke request.")));
    }
  });
}
