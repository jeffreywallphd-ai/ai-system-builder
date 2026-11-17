import { describe, expect, it } from "vitest";
import { deriveSecurityUiState } from "../useThinClientSecurity";

const secureStatus = { mode: "lan-https-token" as const, httpsEnabled: true, httpsRequired: true, authRequired: true, pairingEnabled: true };

describe("deriveSecurityUiState", () => {
  it("returns unpaired with no token", () => {
    expect(deriveSecurityUiState({ pairingBusy: false, hasToken: false, status: secureStatus })).toBe("unpaired");
  });
  it("returns paired when principal confirmed", () => {
    expect(deriveSecurityUiState({ pairingBusy: false, hasToken: true, status: { ...secureStatus, currentPrincipal: { deviceId: "x" } } })).toBe("paired");
  });
  it("returns token-invalid on canonical invalid token errors", () => {
    expect(deriveSecurityUiState({ pairingBusy: false, hasToken: true, status: secureStatus, error: { status: 401, code: "security.invalid-token", message: "bad", endpoint: "/api/security/status" } })).toBe("token-invalid");
  });
  it("returns unauthorized on forbidden", () => {
    expect(deriveSecurityUiState({ pairingBusy: false, hasToken: true, status: secureStatus, error: { status: 403, code: "security.forbidden", message: "forbidden", endpoint: "/api" } })).toBe("unauthorized");
  });
  it("returns pairing-failed for generic failures", () => {
    expect(deriveSecurityUiState({ pairingBusy: false, hasToken: true, status: secureStatus, error: { status: 500, code: "security.internal", message: "nope", endpoint: "/api" } })).toBe("pairing-failed");
  });
  it("does not let a previous disabled-dev status hide a current denial", () => {
    expect(deriveSecurityUiState({ pairingBusy: false, hasToken: true, status: { ...secureStatus, mode: "disabled-dev" }, error: { status: 403, code: "security.forbidden", message: "Forbidden." } })).toBe("unauthorized");
  });
  it("does not call an anonymous principal paired", () => {
    expect(deriveSecurityUiState({ pairingBusy: false, hasToken: true, status: { ...secureStatus, currentPrincipal: { principalId: "synthetic-anonymous", kind: "anonymous" } } })).toBe("unpaired");
  });
  it("reports a pending pairing independently of the first read", () => {
    expect(deriveSecurityUiState({ pairingBusy: true, hasToken: false })).toBe("pairing");
  });
  it("distinguishes managed authenticated status without inventing a login UI", () => {
    const status = { ...secureStatus, mode: "oidc-bearer" as const };
    expect(deriveSecurityUiState({ status, pairingBusy: false, hasToken: false })).toBe("authentication-required");
    expect(deriveSecurityUiState({ status: { ...status, currentPrincipal: { principalId: "synthetic-principal", kind: "user" } }, pairingBusy: false, hasToken: true })).toBe("authenticated");
  });
});
