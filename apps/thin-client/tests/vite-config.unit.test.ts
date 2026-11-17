import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "../../../modules/testing/node-test";
import { createThinClientViteConfig } from "../vite.config";
import { resolveConfig } from "vite";

describe("thin-client Vite config", () => {
  it("defaults the effective server and preview to loopback, rejecting CLI host overrides", async () => {
    const config = await createThinClientViteConfig({});
    const resolved = await resolveConfig({ ...config, configFile: false, envFile: false }, "serve");
    expect(resolved.server.host).toBe("127.0.0.1");
    expect(resolved.preview.host).toBe("127.0.0.1");
    for (const host of [true, "", "0.0.0.0", "192.0.2.10", "localhost.example.test"]) {
      for (const key of ["server", "preview"] as const) {
        await expect(resolveConfig({ ...config, configFile: false, envFile: false,
          [key]: { ...config.server, host } }, "serve")).rejects.toThrow(/Nonloopback development/);
      }
    }
  });

  it("does not resolve unused development certificates or proxy targets during a production build", async () => {
    const config = await createThinClientViteConfig({ AI_SYSTEM_BUILDER_SECURITY_MODE: "lan-https-token",
      AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "false",
      AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET: "http://invalid.test" }, "build");
    expect(config.server.https).toBeUndefined();
    expect(config.server.proxy).toBeUndefined();
    await resolveConfig({ ...config, configFile: false, envFile: false }, "build");
    await expect(resolveConfig({ ...config, configFile: false, envFile: false }, "serve"))
      .rejects.toThrow(/frontend HTTPS/);
  });

  it("requires effective HTTPS for LAN UI and proxy after final server and preview overrides", async () => {
    const directory = mkdtempSync(join(tmpdir(), "thin-client-lan-config-"));
    const certPath = join(directory, "cert.pem");
    const keyPath = join(directory, "key.pem");
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----");
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----");
    try {
      const config = await createThinClientViteConfig({ AI_SYSTEM_BUILDER_SECURITY_MODE: "lan-https-token",
        AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_CERT_PATH: certPath, AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_KEY_PATH: keyPath });
      const resolved = await resolveConfig({ ...config, configFile: false, envFile: false }, "serve");
      expect(resolved.server.host).toBe("0.0.0.0");
      expect(Boolean(resolved.server.https)).toBe(true);
      expect(Boolean(resolved.preview.https)).toBe(true);
      for (const key of ["server", "preview"] as const) {
        for (const override of [{ https: false }, { proxy: { "/api": "http://127.0.0.1:3010" } },
          { proxy: { "/api": { target: "https://remote.example.test", secure: false } } }]) {
          await expect(resolveConfig({ ...config, configFile: false, envFile: false,
            [key]: { ...config.server, ...override } } as never, "serve")).rejects.toThrow(/HTTPS|certificate verification/);
        }
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("wires server.https from resolveThinClientViteHttpsConfig behavior", async () => {
    const disabledConfig = await createThinClientViteConfig({
      AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "false",
    } as NodeJS.ProcessEnv);
    expect(disabledConfig.server.https).toBeUndefined();

    const directory = mkdtempSync(join(tmpdir(), "thin-client-vite-config-"));
    const certPath = join(directory, "cert.pem");
    const keyPath = join(directory, "key.pem");
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----");
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----");

    const enabledConfig = await createThinClientViteConfig({
      AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "true",
      AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_CERT_PATH: certPath,
      AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_KEY_PATH: keyPath,
    } as NodeJS.ProcessEnv);

    expect(Boolean(enabledConfig.server.https)).toBe(true);
    rmSync(directory, { recursive: true, force: true });
  });

  it("ignores server artifact writes so uploads do not trigger a thin-client reload", async () => {
    const config = await createThinClientViteConfig({
      AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "false",
    } as NodeJS.ProcessEnv);

    expect(config.server.watch.ignored).toContain("**/server-artifacts/**");
  });
});
