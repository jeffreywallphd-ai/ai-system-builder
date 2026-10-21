import { describe, expect, it } from "../../../modules/testing/node-test";

import {
  THIN_CLIENT_API_PROXY_TIMEOUT_MS,
  createThinClientApiProxyConfig,
  resolveThinClientApiProxyTarget,
  shouldVerifyThinClientApiProxyTls,
} from "../viteDevProxyConfig";

describe("thin-client Vite API proxy config", () => {
  it("targets the default HTTP server in disabled development mode", () => {
    const environment = {};

    expect(resolveThinClientApiProxyTarget(environment)).toBe("http://127.0.0.1:3010");
    expect(createThinClientApiProxyConfig(environment)).toMatchObject({
      target: "http://127.0.0.1:3010",
      changeOrigin: true,
      secure: true,
      timeout: THIN_CLIENT_API_PROXY_TIMEOUT_MS,
      proxyTimeout: THIN_CLIENT_API_PROXY_TIMEOUT_MS,
    });
  });

  it("targets HTTPS and disables proxy certificate verification for auto self-signed dev certificates", () => {
    const environment = {
      AI_SYSTEM_BUILDER_HTTPS_ENABLED: "true",
      AI_SYSTEM_BUILDER_TLS_CERT_MODE: "auto-self-signed",
    };

    expect(resolveThinClientApiProxyTarget(environment)).toBe("https://127.0.0.1:3010");
    expect(shouldVerifyThinClientApiProxyTls(environment)).toBe(false);
    expect(createThinClientApiProxyConfig(environment)).toMatchObject({
      target: "https://127.0.0.1:3010",
      changeOrigin: true,
      secure: false,
    });
  });

  it("uses HTTPS when LAN token security enables HTTPS implicitly", () => {
    const environment = {
      AI_SYSTEM_BUILDER_SECURITY_MODE: "lan-https-token",
      AI_SYSTEM_BUILDER_TLS_CERT_MODE: "auto-self-signed",
      SERVER_PORT: "4123",
    };

    expect(createThinClientApiProxyConfig(environment)).toMatchObject({
      target: "https://127.0.0.1:4123",
      secure: false,
    });
  });

  it("keeps certificate verification enabled for manual HTTPS certificates", () => {
    const environment = {
      AI_SYSTEM_BUILDER_HTTPS_ENABLED: "true",
      AI_SYSTEM_BUILDER_TLS_CERT_MODE: "manual",
    };

    expect(shouldVerifyThinClientApiProxyTls(environment)).toBe(true);
  });

  it("allows an explicit proxy target override", () => {
    const environment = {
      AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET: "https://example.test:9443",
      AI_SYSTEM_BUILDER_TLS_CERT_MODE: "auto-self-signed",
    };

    expect(createThinClientApiProxyConfig(environment)).toMatchObject({
      target: "https://example.test:9443",
      secure: true,
    });
  });

  it("never disables verification for remote targets that resemble loopback", () => {
    for (const host of ["localhost.example.test", "127.0.0.1.example.test", "192.0.2.10", "example.test"]) {
      expect(shouldVerifyThinClientApiProxyTls({ AI_SYSTEM_BUILDER_TLS_CERT_MODE: "auto-local-ca",
        AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET: `https://${host}` })).toBe(true);
    }
    for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
      expect(shouldVerifyThinClientApiProxyTls({ AI_SYSTEM_BUILDER_TLS_CERT_MODE: "auto-local-ca",
        AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET: `https://${host}` })).toBe(false);
    }
  });

  it("rejects LAN HTTP overrides and malformed or credential-bearing targets without echoing them", () => {
    for (const target of ["http://127.0.0.1:3010", "http://remote.test", "file:///private", "invalid", "https://user:private@remote.test"]) {
      let message = "";
      try {
        createThinClientApiProxyConfig({ AI_SYSTEM_BUILDER_SECURITY_MODE: "lan-https-token",
          AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET: target });
      } catch (error) { message = (error as Error).message; }
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(target);
      expect(message).not.toContain("private");
    }
  });

  it("does not change API proxy target when only thin-client HTTPS env vars are set", () => {
    const environment = {
      AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "true",
      AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_CERT_PATH: "/tmp/thin-client-cert.pem",
      AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_KEY_PATH: "/tmp/thin-client-key.pem",
    };

    expect(resolveThinClientApiProxyTarget(environment)).toBe("http://127.0.0.1:3010");
    expect(createThinClientApiProxyConfig(environment)).toMatchObject({
      target: "http://127.0.0.1:3010",
      secure: true,
    });
  });
});
