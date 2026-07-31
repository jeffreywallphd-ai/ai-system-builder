import { describe, expect, it } from "../../../testing/node-test";
import {
  authorizeByScopes,
  createAnonymousAuthContext,
  createDevicePrincipal,
  isDeviceCredentialActive,
  isPairingSessionUsable,
} from "../index";

describe("security domain", () => {
  const now = new Date("2026-05-01T00:00:00.000Z");
  const record = {
    deviceId: "d1",
    deviceName: "Phone",
    tokenHash: "hash",
    tokenHashAlgorithm: "sha256" as const,
    scopes: ["artifact:read"],
    createdAt: "2026-04-01T00:00:00.000Z",
    expiresAt: "2026-06-01T00:00:00.000Z",
  };

  it("active credential is active", () => expect(isDeviceCredentialActive(record, now)).toBe(true));
  it("revoked credential is inactive", () => expect(isDeviceCredentialActive({ ...record, revokedAt: now.toISOString() }, now)).toBe(false));
  it("expired credential is inactive", () => expect(isDeviceCredentialActive({ ...record, expiresAt: "2026-04-01T00:00:00.000Z" }, now)).toBe(false));
  it("creates device principal from credential", () => {
    const principal = createDevicePrincipal(record);
    expect(principal.principalId).toBe("d1");
    expect(principal.displayName).toBe("Phone");
    expect(principal.scopes).toEqual(["artifact:read"]);
  });

  it("valid pairing session usable", () => expect(isPairingSessionUsable({ pairingCode: "123", expiresAt: "2026-05-10T00:00:00.000Z" }, now)).toBe(true));
  it("expired pairing session rejected", () => expect(isPairingSessionUsable({ pairingCode: "123", expiresAt: "2026-04-10T00:00:00.000Z" }, now)).toBe(false));
  it("consumed pairing session rejected", () => expect(isPairingSessionUsable({ pairingCode: "123", expiresAt: "2026-05-10T00:00:00.000Z", consumedAt: now.toISOString() }, now)).toBe(false));

  it("authorization allows when scopes present", () => {
    const auth = { ...createAnonymousAuthContext(), authenticated: true, principal: { ...createAnonymousAuthContext().principal, kind: "device" as const, principalId: "d1", scopes: ["artifact:read"] } };
    expect(authorizeByScopes(auth, ["artifact:read"]).allowed).toBe(true);
  });
  it("authorization denies missing scopes", () => {
    const auth = { ...createAnonymousAuthContext(), authenticated: true, principal: { ...createAnonymousAuthContext().principal, kind: "device" as const, principalId: "d1", scopes: ["artifact:read"] } };
    const decision = authorizeByScopes(auth, ["runtime:admin"]);
    expect(decision.allowed).toBe(false);
    expect(decision.missingScopes).toEqual(["runtime:admin"]);
  });
  it("authorization denies unauthenticated when scopes required", () => {
    const decision = authorizeByScopes(createAnonymousAuthContext(), ["artifact:read"]);
    expect(decision.allowed).toBe(false);
  });
});
