import { describe, expect, it } from "../../../../testing/node-test";
import { CompleteLanPairingService, GetSecurityStatusService, VerifyTransportAuthenticationService } from "..";
import { ANONYMOUS_AUTH_CONTEXT } from "../../../../contracts/security";

describe("security services", () => {
  it("complete pairing succeeds and stores hash only", async () => {
    const saved: any[] = [];
    const events: any[] = [];
    const service = new CompleteLanPairingService({
      pairingCodes: { consumePairingCode: async () => ({ status: "valid", defaultScopes: ["artifact:read"] as const }) },
      tokens: { issueDeviceToken: async () => ({ token: "plain", tokenHash: "hashed", tokenHashAlgorithm: "sha256" as const }) },
      credentials: {
        saveDeviceCredential: async (record) => saved.push(record),
        findActiveDeviceCredentialByTokenHash: async () => undefined,
        revokeDevice: async () => false,
        countActiveDevices: async () => 0,
      },
      audit: { recordSecurityEvent: async (event) => events.push(event) },
      now: () => new Date("2026-05-01T00:00:00.000Z"),
      idGenerator: { createDeviceId: () => "device-1", createSecurityEventId: () => "event-1" },
    });

    const result = await service.execute({ pairingCode: "1234" });
    expect(result.bearerToken).toBe("plain");
    expect(saved[0].tokenHash).toBe("hashed");
    expect((saved[0] as any).token).toBeUndefined();
    expect(JSON.stringify(events[0])).not.toContain("plain");
  });

  it("complete pairing rejects invalid and expired code", async () => {
    const mk = (status: "invalid" | "expired") => new CompleteLanPairingService({
      pairingCodes: { consumePairingCode: async () => ({ status }) },
      tokens: { issueDeviceToken: async () => { throw new Error("no"); } },
      credentials: { saveDeviceCredential: async () => {}, findActiveDeviceCredentialByTokenHash: async () => undefined, revokeDevice: async () => false, countActiveDevices: async () => 0 },
      idGenerator: { createDeviceId: () => "device-1", createSecurityEventId: () => "event-1" },
    });

    await expect(mk("invalid").execute({ pairingCode: "x" })).rejects.toThrow("Invalid pairing code");
    await expect(mk("expired").execute({ pairingCode: "x" })).rejects.toThrow("Pairing code expired");
  });

  it("verify auth anonymous when not required and no token; rejects when required", async () => {
    const verifier = { verifyToken: async () => ANONYMOUS_AUTH_CONTEXT };
    const service = new VerifyTransportAuthenticationService(verifier, { authRequired: false });
    const context = await service.execute({ now: new Date(), bearerToken: undefined });
    expect(context.authenticated).toBe(false);

    const required = new VerifyTransportAuthenticationService(verifier, { authRequired: true });
    let rejected: unknown;
    try {
      await required.execute({ now: new Date(), bearerToken: undefined });
    } catch (error) {
      rejected = error;
    }
    expect(rejected).toMatchObject({
      code: "security.unauthenticated",
      message: "Authentication required.",
    });
  });

  it("verify auth delegates token verification", async () => {
    let called = false;
    const service = new VerifyTransportAuthenticationService({ verifyToken: async () => { called = true; return { ...ANONYMOUS_AUTH_CONTEXT, authenticated: true }; } }, { authRequired: true });
    await service.execute({ now: new Date(), bearerToken: "abc" });
    expect(called).toBe(true);
  });

  it("get security status reports configured values", async () => {
    const service = new GetSecurityStatusService({
      saveDeviceCredential: async () => {},
      findActiveDeviceCredentialByTokenHash: async () => undefined,
      revokeDevice: async () => false,
      countActiveDevices: async () => 3,
    });
    const status = await service.execute({
      config: { mode: "lan-https-token", httpsRequired: true, authRequired: true, allowLocalhostWithoutAuth: false },
      httpsEnabled: true,
      pairingEnabled: true,
      currentAuthContext: ANONYMOUS_AUTH_CONTEXT,
      now: new Date(),
    });
    expect(status.mode).toBe("lan-https-token");
    expect(status.pairedDeviceCount).toBe(3);
  });
});
