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
});
