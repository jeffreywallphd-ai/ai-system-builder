import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "../../../modules/testing/node-test";
import { isThinClientViteHttpsEnabled, resolveThinClientViteHttpsConfig } from "../viteDevHttpsConfig";

describe("thin-client Vite HTTPS config", () => {
  it("returns false when thin-client HTTPS is disabled", async () => {
    expect(await resolveThinClientViteHttpsConfig({})).toBe(false);
    expect(await resolveThinClientViteHttpsConfig({ AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "false" })).toBe(false);
    expect(isThinClientViteHttpsEnabled({ AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "false" })).toBe(false);
  });

  it("throws clear error when HTTPS is enabled without key path", async () => {
    await expect(
      resolveThinClientViteHttpsConfig({
        AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "true",
        AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_CERT_PATH: "/tmp/cert.pem",
      }),
    ).rejects.toThrow(/AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_KEY_PATH is required/);
  });

  it("throws clear error when HTTPS is enabled and key path is unreadable without exposing full key path", async () => {
    const directory = mkdtempSync(join(tmpdir(), "thin-client-vite-https-"));
    const certPath = join(directory, "cert.pem");
    const keyPath = join(directory, "secret/private-key.pem");
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----");

    let error: unknown;
    try {
      await resolveThinClientViteHttpsConfig({
        AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "true",
        AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_CERT_PATH: certPath,
        AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_KEY_PATH: keyPath,
      });
    } catch (caughtError) {
      error = caughtError;
    }

    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_KEY_PATH could not be read");
    expect(message).not.toContain(keyPath);
    expect(message).not.toContain("private-key.pem");
    rmSync(directory, { recursive: true, force: true });
  });

  it("fails clearly when cert PEM shape is invalid", async () => {
    const directory = mkdtempSync(join(tmpdir(), "thin-client-vite-https-"));
    const certPath = join(directory, "cert.pem");
    const keyPath = join(directory, "key.pem");
    writeFileSync(certPath, "not-a-certificate");
    writeFileSync(keyPath, "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");

    await expect(
      resolveThinClientViteHttpsConfig({
        AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "true",
        AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_CERT_PATH: certPath,
        AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_KEY_PATH: keyPath,
      }),
    ).rejects.toThrow(/AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_CERT_PATH must point to a PEM certificate file/);

    rmSync(directory, { recursive: true, force: true });
  });

  it("fails clearly when key PEM shape is invalid without leaking key contents", async () => {
    const directory = mkdtempSync(join(tmpdir(), "thin-client-vite-https-"));
    const certPath = join(directory, "cert.pem");
    const keyPath = join(directory, "key.pem");
    const invalidKey = "super-secret-key-material";
    writeFileSync(certPath, "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----");
    writeFileSync(keyPath, invalidKey);

    let error: unknown;
    try {
      await resolveThinClientViteHttpsConfig({
        AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "true",
        AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_CERT_PATH: certPath,
        AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_KEY_PATH: keyPath,
      });
    } catch (caughtError) {
      error = caughtError;
    }

    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_KEY_PATH must point to a PEM private key file");
    expect(message).not.toContain(invalidKey);
    rmSync(directory, { recursive: true, force: true });
  });

  it("returns cert and key buffers when HTTPS is enabled and PEM shapes are valid", async () => {
    const directory = mkdtempSync(join(tmpdir(), "thin-client-vite-https-"));
    const certPath = join(directory, "cert.pem");
    const keyPath = join(directory, "key.pem");
    const certContents = "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----";
    const keyContents = "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----";
    writeFileSync(certPath, certContents);
    writeFileSync(keyPath, keyContents);

    const config = await resolveThinClientViteHttpsConfig({
      AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "true",
      AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_CERT_PATH: certPath,
      AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_KEY_PATH: keyPath,
    });

    expect(config).not.toBe(false);
    expect(Buffer.isBuffer(config && config.cert)).toBe(true);
    expect(Buffer.isBuffer(config && config.key)).toBe(true);
    expect(config && config.cert.toString("utf8")).toBe(certContents);
    expect(config && config.key.toString("utf8")).toBe(keyContents);

    rmSync(directory, { recursive: true, force: true });
  });

  it("generates thin-client HTTPS material when shared TLS mode is auto-self-signed", async () => {
    const directory = mkdtempSync(join(tmpdir(), "thin-client-vite-auto-https-"));

    const config = await resolveThinClientViteHttpsConfig({
      AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "true",
      AI_SYSTEM_BUILDER_TLS_CERT_MODE: "auto-self-signed",
      AI_SYSTEM_BUILDER_THIN_CLIENT_TLS_CERT_DIRECTORY: directory,
    });

    expect(config).not.toBe(false);
    expect(Buffer.isBuffer(config && config.cert)).toBe(true);
    expect(Buffer.isBuffer(config && config.key)).toBe(true);
    expect(config && config.cert.toString("utf8")).toContain("-----BEGIN CERTIFICATE-----");
    expect(config && config.key.toString("utf8")).toContain("-----BEGIN");

    rmSync(directory, { recursive: true, force: true });
  });
});
