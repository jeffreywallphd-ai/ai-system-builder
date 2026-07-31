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
      secure: false,
    });
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
