import { useCallback, useEffect, useMemo, useState } from "react";
import { pairedDeviceTokenStore } from "../../../security/pairedDeviceTokenStore";
import { createSecurityApiClient, type SecurityStatusResult } from "../../../security/securityApiClient";
import { FORBIDDEN_GUIDANCE, toSecurityGuidance, type ThinClientSecurityError } from "../../../security/securityErrors";

type SecurityUiState = "loading" | "disabled-dev" | "unpaired" | "paired" | "token-invalid" | "pairing" | "pairing-failed" | "unauthorized" | "error";
const TOKEN_INVALID_CODES = new Set(["security.invalid-token", "security.expired-token", "security.revoked-token"]);

export function deriveSecurityUiState(input: { status?: SecurityStatusResult; error?: ThinClientSecurityError; pairingBusy: boolean; hasToken: boolean; }) : SecurityUiState {
  const { status, error, pairingBusy, hasToken } = input;
  if (!status && !error) return "loading";
  if (pairingBusy) return "pairing";
  if (status?.mode === "disabled-dev") return "disabled-dev";
  const guidance = toSecurityGuidance(error);
  if (guidance === FORBIDDEN_GUIDANCE) return "unauthorized";
  if (status?.mode === "lan-https-token" && error?.status === 401 && TOKEN_INVALID_CODES.has(error.code ?? "")) return "token-invalid";
  if (status?.mode === "lan-https-token" && !hasToken) return "unpaired";
  if (status?.mode === "lan-https-token" && hasToken && status.currentPrincipal) return "paired";
  if (status?.mode === "lan-https-token" && hasToken && guidance) return "unpaired";
  if (error && status?.mode === "lan-https-token") return "pairing-failed";
  return error ? "error" : "loading";
}

export function useThinClientSecurity() {
  const api = useMemo(() => createSecurityApiClient(), []);
  const [status, setStatus] = useState<SecurityStatusResult>();
  const [error, setError] = useState<ThinClientSecurityError>();
  const [pairingBusy, setPairingBusy] = useState(false);
  const [devSecurityModeUpdateError, setDevSecurityModeUpdateError] = useState<string>();
  const [devSecurityModeUpdateSuccess, setDevSecurityModeUpdateSuccess] = useState<string>();

  const loadStatus = useCallback(async () => {
    try {
      const publicStatus = await api.getSecurityStatus();
      if (publicStatus.mode === "lan-https-token" && pairedDeviceTokenStore.hasToken()) {
        try { setStatus(await api.getSecurityStatus({ includeAuth: true })); setError(undefined); return; }
        catch (e) {
          const securityError = e as ThinClientSecurityError;
          if (securityError.status === 401 && TOKEN_INVALID_CODES.has(securityError.code ?? "")) pairedDeviceTokenStore.clearToken();
          setStatus(publicStatus); setError(securityError); return;
        }
      }
      setStatus(publicStatus); setError(undefined);
    } catch (e) { setError(e as ThinClientSecurityError); }
  }, [api]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const completePairing = useCallback(async (pairingCode: string, deviceName?: string) => {
    setPairingBusy(true);
    try {
      const result = await api.completePairing({ pairingCode, deviceName });
      pairedDeviceTokenStore.setToken(result.bearerToken);
      await loadStatus();
      return true;
    } catch (e) { setError(e as ThinClientSecurityError); return false; }
    finally { setPairingBusy(false); }
  }, [api, loadStatus]);

  const setDevSecurityEnforcementMode = useCallback(async (mode: "disabled-dev" | "lan-token-enforced") => {
    setDevSecurityModeUpdateError(undefined);
    setDevSecurityModeUpdateSuccess(undefined);
    try {
      await api.setDevSecurityMode(mode);
      await loadStatus();
      setDevSecurityModeUpdateSuccess("Dev security enforcement updated.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update dev security enforcement.";
      setDevSecurityModeUpdateError(message);
    }
  }, [api, loadStatus]);

  const clearLocalPairing = useCallback(() => { pairedDeviceTokenStore.clearToken(); setError(undefined); }, []);
  const guidance = toSecurityGuidance(error);
  const hasToken = pairedDeviceTokenStore.hasToken();
  const uiState = useMemo(() => deriveSecurityUiState({ status, error, pairingBusy, hasToken }), [status, error, pairingBusy, hasToken]);

  return { uiState, status, error, guidance, completePairing, clearLocalPairing, hasToken, setDevSecurityEnforcementMode, devSecurityModeUpdateError, devSecurityModeUpdateSuccess };
}
