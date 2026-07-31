import { describe, expect, it } from "../../../../testing/node-test";
import { resolveServerSecurityConfig } from "../resolveServerSecurityConfig";

describe("resolveServerSecurityConfig", () => {
  it("resolves disabled-dev defaults", () => {
    const cfg = resolveServerSecurityConfig({}, "/tmp/storage");
    expect(cfg.mode).toBe("disabled-dev");
    expect(cfg.authRequired).toBe(false);
    expect(cfg.httpsRequired).toBe(false);
    expect(cfg.httpsEnabled).toBe(false);
    expect(cfg.devSecurityToggleEnabled).toBe(false);
  });

  it("supports HTTPS listener in disabled-dev when explicitly enabled", () => {
    const cfg = resolveServerSecurityConfig({ AI_SYSTEM_BUILDER_SECURITY_MODE: "disabled-dev", AI_SYSTEM_BUILDER_HTTPS_ENABLED: "true", AI_SYSTEM_BUILDER_TLS_CERT_PATH: "/tmp/cert.pem", AI_SYSTEM_BUILDER_TLS_KEY_PATH: "/tmp/key.pem" }, "/tmp/storage");
    expect(cfg.mode).toBe("disabled-dev");
    expect(cfg.httpsEnabled).toBe(true);
    expect(cfg.httpsRequired).toBe(false);
  });

  it("requires cert and key for lan-https-token", () => {
    expect(() => resolveServerSecurityConfig({ AI_SYSTEM_BUILDER_SECURITY_MODE: "lan-https-token" }, "/tmp/storage")).toThrow(/AI_SYSTEM_BUILDER_TLS_CERT_PATH|SERVER_TOKEN_HASH_SECRET|TLS/);
  });

  it("supports OIDC bearer only with HTTPS", () => {
    const cfg = resolveServerSecurityConfig({
      AI_SYSTEM_BUILDER_SECURITY_MODE: "oidc-bearer",
      AI_SYSTEM_BUILDER_TLS_CERT_MODE: "auto-self-signed",
    }, "/tmp/storage");
    expect(cfg.mode).toBe("oidc-bearer");
    expect(cfg.authRequired).toBe(true);
    expect(cfg.httpsEnabled).toBe(true);
    expect(cfg.httpsRequired).toBe(true);
    expect(cfg.pairingEnabled).toBe(false);
  });

  it("rejects declared but unimplemented server security modes", () => {
    expect(() => resolveServerSecurityConfig({
      AI_SYSTEM_BUILDER_SECURITY_MODE: "api-key",
    }, "/tmp/storage")).toThrow(/must be one of/);
  });

  it("enables dev toggle only in disabled-dev", () => {
    expect(resolveServerSecurityConfig({ AI_SYSTEM_BUILDER_DEV_SECURITY_TOGGLE_ENABLED: "true" }, "/tmp/storage").devSecurityToggleEnabled).toBe(true);
    const cfg = resolveServerSecurityConfig({ AI_SYSTEM_BUILDER_SECURITY_MODE: "lan-https-token", AI_SYSTEM_BUILDER_DEV_SECURITY_TOGGLE_ENABLED: "true", AI_SYSTEM_BUILDER_TLS_CERT_PATH: "/tmp/cert.pem", AI_SYSTEM_BUILDER_TLS_KEY_PATH: "/tmp/key.pem" }, "/tmp/storage");
    expect(cfg.devSecurityToggleEnabled).toBe(false);
  });
});


it("accepts auto-local-ca mode", () => {
  const cfg = resolveServerSecurityConfig({ AI_SYSTEM_BUILDER_SECURITY_MODE: "disabled-dev", AI_SYSTEM_BUILDER_HTTPS_ENABLED: "true", AI_SYSTEM_BUILDER_TLS_CERT_MODE: "auto-local-ca" }, "/tmp/storage");
  expect(cfg.tls.certMode).toBe("auto-local-ca");
  expect(cfg.tls.hosts).toEqual(["localhost", "127.0.0.1", "::1"]);
});
