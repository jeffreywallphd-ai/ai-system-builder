import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { pairedDeviceTokenStore } from "../../../security/pairedDeviceTokenStore";
import { createSecurityApiClient, type SecurityStatusResult } from "../../../security/securityApiClient";
import { FORBIDDEN_GUIDANCE, normalizeSecurityError, STATUS_FAILURE, toSecurityGuidance, type ThinClientSecurityError } from "../../../security/securityErrors";

type SecurityUiState = "loading" | "disabled-dev" | "unpaired" | "paired" | "token-invalid" | "pairing" | "pairing-failed" | "unauthorized" | "error" | "authenticated" | "authentication-required";
const TOKEN_INVALID_CODES = new Set(["security.invalid-token", "security.expired-token", "security.revoked-token"]);
const CONNECTION_CHANGED = "The saved connection changed. Refresh status to check the current connection.";

export function deriveSecurityUiState(input: { status?: SecurityStatusResult; error?: ThinClientSecurityError; pairingBusy: boolean; hasToken: boolean }): SecurityUiState {
  const { status, error, pairingBusy, hasToken } = input;
  if (pairingBusy) return "pairing";
  if (!status && !error) return "loading";
  if (toSecurityGuidance(error) === FORBIDDEN_GUIDANCE) return "unauthorized";
  if (error?.status === 401 && TOKEN_INVALID_CODES.has(error.code ?? "")) return "token-invalid";
  if (error) return status?.mode === "lan-https-token" ? "pairing-failed" : "error";
  if (status?.mode === "disabled-dev") return "disabled-dev";
  const authenticated = status?.currentPrincipal && status.currentPrincipal.kind !== "anonymous";
  if (status?.mode === "lan-https-token") return hasToken && authenticated ? "paired" : "unpaired";
  if (status?.mode === "oidc-bearer") return hasToken && authenticated ? "authenticated" : "authentication-required";
  return "error";
}
interface View {
  status?: SecurityStatusResult;
  error?: ThinClientSecurityError;
  loading: boolean;
  pairingBusy: boolean;
  actionBusy: boolean;
  devSecurityModeUpdateError?: string;
  devSecurityModeUpdateSuccess?: string;
}
interface Scope { lease?: object; readOwner?: object; actionOwner?: object }
const initialView = (): View => ({ loading: true, pairingBusy: false, actionBusy: false });

export function useThinClientSecurity() {
  const api = useMemo(() => createSecurityApiClient(), []);
  const scope = useMemo<Scope>(() => ({}), [api]);
  const [view, setView] = useState<View>(initialView);
  useLayoutEffect(() => {
    const lease = {};
    scope.lease = lease; scope.readOwner = scope.actionOwner = undefined;
    setView(initialView());
    return () => {
      if (scope.lease === lease) { scope.lease = scope.readOwner = scope.actionOwner = undefined; }
    };
  }, [scope]);

  const loadStatus = useCallback(async (actionOwner?: object): Promise<SecurityStatusResult | undefined> => {
    const lease = scope.lease;
    if (!lease || scope.readOwner || scope.actionOwner && scope.actionOwner !== actionOwner) return undefined;
    const owner = {};
    scope.readOwner = owner;
    const current = () => scope.lease === lease && scope.readOwner === owner;
    setView(previous => ({ ...previous, loading: true, status: undefined, error: undefined }));
    try {
      const publicStatus = await api.getSecurityStatus();
      if (!current()) return undefined;
      const token = pairedDeviceTokenStore.captureToken();
      if ((publicStatus.mode === "lan-https-token" || publicStatus.mode === "oidc-bearer") && token.hasToken) {
        try {
          const authenticated = await api.getSecurityStatus({ includeAuth: true });
          if (!current()) return undefined;
          if (!token.isCurrent()) {
            setView(previous => ({ ...previous, status: publicStatus, error: { message: CONNECTION_CHANGED } }));
            return undefined;
          }
          setView(previous => ({ ...previous, status: authenticated, error: undefined }));
          return authenticated;
        } catch (error) {
          if (!current()) return undefined;
          if (!token.isCurrent()) {
            setView(previous => ({ ...previous, status: publicStatus, error: { message: CONNECTION_CHANGED } }));
            return undefined;
          }
          const failure = normalizeSecurityError(error, STATUS_FAILURE);
          if (failure.status === 401 && TOKEN_INVALID_CODES.has(failure.code ?? "")) {
            try { token.clearIfCurrent(); } catch { /* Preserve denial; never claim storage cleanup. */ }
          }
          setView(previous => ({ ...previous, status: publicStatus, error: failure }));
          return undefined;
        }
      }
      setView(previous => ({ ...previous, status: publicStatus, error: undefined }));
      return publicStatus;
    } catch (error) {
      if (current()) setView(previous => ({ ...previous, error: normalizeSecurityError(error, STATUS_FAILURE) }));
      return undefined;
    } finally {
      if (current()) {
        scope.readOwner = undefined;
        setView(previous => ({ ...previous, loading: false }));
      }
    }
  }, [api, scope]);

  const refreshStatus = useCallback(async () => {
    if (!scope.actionOwner) return await loadStatus() !== undefined;
    return false;
  }, [scope, loadStatus]);
  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  const completePairing = useCallback(async (pairingCode: string, deviceName?: string) => {
    const lease = scope.lease;
    if (!lease || scope.actionOwner) return false;
    const owner = {}, token = pairedDeviceTokenStore.captureToken();
    if (!token.readable) {
      scope.readOwner = undefined;
      setView(previous => ({ ...previous, loading: false, error: { message: "Could not pair this device. Try again." } }));
      return false;
    }
    scope.actionOwner = owner; scope.readOwner = undefined;
    const current = () => scope.lease === lease && scope.actionOwner === owner;
    setView(previous => ({ ...previous, pairingBusy: true, actionBusy: true, loading: false, error: undefined }));
    try {
      const result = await api.completePairing({ pairingCode, deviceName });
      if (!current()) return false;
      if (!token.isCurrent()) throw new Error("connection changed");
      if (typeof result.bearerToken !== "string" || !result.bearerToken || /\s/.test(result.bearerToken)) throw new Error("invalid pairing");
      pairedDeviceTokenStore.setToken(result.bearerToken);
      const installed = pairedDeviceTokenStore.captureToken();
      const readback = await loadStatus(owner);
      if (!readback || !current()) return false;
      if (!installed.isCurrent()) {
        setView(previous => ({ ...previous, error: { message: CONNECTION_CHANGED } }));
        return false;
      }
      if (readback.mode !== "lan-https-token" || !readback.currentPrincipal || readback.currentPrincipal.kind === "anonymous") {
        setView(previous => ({ ...previous, error: { message: "Could not confirm pairing. Refresh status to try again." } }));
        return false;
      }
      return true;
    } catch (error) {
      if (current()) setView(previous => ({ ...previous, error: normalizeSecurityError(error, "Could not pair this device. Try again.") }));
      return false;
    } finally {
      if (current()) {
        scope.actionOwner = undefined;
        setView(previous => ({ ...previous, pairingBusy: false, actionBusy: false }));
      }
    }
  }, [api, scope, loadStatus]);

  const setDevSecurityEnforcementMode = useCallback(async (mode: "disabled-dev" | "lan-token-enforced") => {
    const lease = scope.lease;
    if (!lease || scope.actionOwner) return false;
    const owner = {}, token = pairedDeviceTokenStore.captureToken();
    scope.actionOwner = owner; scope.readOwner = undefined;
    const current = () => scope.lease === lease && scope.actionOwner === owner;
    setView(previous => ({ ...previous, actionBusy: true, loading: false, devSecurityModeUpdateError: undefined, devSecurityModeUpdateSuccess: undefined }));
    try {
      const result = await api.setDevSecurityMode(mode);
      if (!current()) return false;
      if (!token.isCurrent() || result.mode !== mode) throw new Error("connection changed");
      const readback = await loadStatus(owner);
      if (!readback || !current()) return false;
      if (!token.isCurrent() || readback.devSecurityEnforcementMode !== mode) throw new Error("unconfirmed readback");
      setView(previous => ({ ...previous, devSecurityModeUpdateSuccess: "Dev security enforcement updated." }));
      return true;
    } catch {
      if (current()) setView(previous => ({ ...previous, devSecurityModeUpdateError: "Could not update security mode. Try again." }));
      return false;
    } finally {
      if (current()) {
        scope.actionOwner = undefined;
        setView(previous => ({ ...previous, actionBusy: false }));
      }
    }
  }, [api, scope, loadStatus]);

  const clearLocalPairing = useCallback(() => {
    if (!scope.lease || scope.actionOwner) return false;
    scope.readOwner = undefined;
    try {
      pairedDeviceTokenStore.clearToken();
      setView(previous => ({ ...previous, status: previous.status ? { ...previous.status, currentPrincipal: undefined } : undefined,
        loading: false, error: undefined, devSecurityModeUpdateSuccess: undefined }));
      return true;
    } catch {
      setView(previous => ({ ...previous, loading: false, error: { message: "Could not clear the saved pairing. Try again." } }));
      return false;
    }
  }, [scope]);
  const hasToken = pairedDeviceTokenStore.hasToken();
  const guidance = toSecurityGuidance(view.error);
  const uiState = deriveSecurityUiState({ status: view.status, error: view.error, pairingBusy: view.pairingBusy, hasToken });
  return { ...view, uiState, guidance, completePairing, clearLocalPairing, hasToken, refreshStatus, setDevSecurityEnforcementMode };
}
