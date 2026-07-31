import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "../../../modules/testing/node-test";
import { createThinClientViteConfig } from "../vite.config";

describe("thin-client Vite config", () => {
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
