import { describe, expect, it, vi } from "../../../../testing/node-test";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { composeServerSecurity } from "../composeServerSecurity";

function tlsEnv() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "security-test-"));
  const cert = path.join(dir, "cert.pem");
  const key = path.join(dir, "key.pem");
  writeFileSync(cert, "cert");
  writeFileSync(key, "key");
  return { AI_SYSTEM_BUILDER_TLS_CERT_PATH: cert, AI_SYSTEM_BUILDER_TLS_KEY_PATH: key };
}

describe("composeServerSecurity", () => {
  it("uses insecure fallback only in disabled-dev", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await composeServerSecurity({ AI_SYSTEM_BUILDER_SECURITY_MODE: "disabled-dev" } as any, "/tmp/x");
    expect(warn).toHaveBeenCalled();
  });
  it("fails lan-https-token without token hash secret", async () => {
    await expect(composeServerSecurity({ AI_SYSTEM_BUILDER_SECURITY_MODE: "lan-https-token", ...tlsEnv() } as any, "/tmp/x")).rejects.toThrow(/SERVER_TOKEN_HASH_SECRET is required/);
  });
  it("accepts lan-https-token with token hash secret", async () => {
    await composeServerSecurity({ AI_SYSTEM_BUILDER_SECURITY_MODE: "lan-https-token", SERVER_TOKEN_HASH_SECRET: "abc123", ...tlsEnv() } as any, "/tmp/x");
  });
  it("requires complete OIDC configuration and no LAN token hash secret", async () => {
    await expect(composeServerSecurity({
      AI_SYSTEM_BUILDER_SECURITY_MODE: "oidc-bearer",
      AI_SYSTEM_BUILDER_TLS_CERT_MODE: "auto-self-signed",
    } as any, "/tmp/x")).rejects.toThrow(/OIDC bearer mode requires/);
    const security = await composeServerSecurity({
      AI_SYSTEM_BUILDER_SECURITY_MODE: "oidc-bearer",
      AI_SYSTEM_BUILDER_TLS_CERT_MODE: "auto-self-signed",
      AI_SYSTEM_BUILDER_OIDC_ISSUER: "https://identity.example.test/tenant",
      AI_SYSTEM_BUILDER_OIDC_AUDIENCE: "ai-system-builder",
      AI_SYSTEM_BUILDER_OIDC_JWKS_URI: "https://identity.example.test/tenant/keys",
      AI_SYSTEM_BUILDER_TENANT_PLACEMENT_MODE: "dedicated",
      AI_SYSTEM_BUILDER_DEDICATED_ORGANIZATION_ID: "org-premium",
    } as any, "/tmp/x");
    expect(security.config.tenantPlacement).toEqual({
      mode: "dedicated",
      organizationId: "org-premium",
    });
    expect(security.config.pairingEnabled).toBe(false);
  });
});
