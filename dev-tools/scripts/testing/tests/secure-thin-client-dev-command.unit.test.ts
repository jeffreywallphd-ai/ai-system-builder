import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { createSecureThinClientDevEnvironment } from "../../thin-client/dev-secure-thin-client.mjs";

describe("secure thin-client dev command", () => {
  it("enables HTTPS thin-client, HTTPS server proxy mode, and self-signed TLS by default", () => {
    const env = createSecureThinClientDevEnvironment({});

    assert.equal(env.AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED, "true");
    assert.equal(env.AI_SYSTEM_BUILDER_HTTPS_ENABLED, "true");
    assert.equal(env.AI_SYSTEM_BUILDER_TLS_CERT_MODE, "auto-self-signed");
  });

  it("preserves explicit caller overrides", () => {
    const env = createSecureThinClientDevEnvironment({
      AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED: "false",
      AI_SYSTEM_BUILDER_HTTPS_ENABLED: "false",
      AI_SYSTEM_BUILDER_TLS_CERT_MODE: "auto-local-ca",
    });

    assert.equal(env.AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED, "false");
    assert.equal(env.AI_SYSTEM_BUILDER_HTTPS_ENABLED, "false");
    assert.equal(env.AI_SYSTEM_BUILDER_TLS_CERT_MODE, "auto-local-ca");
  });

  it("removes duplicate Windows environment keys that can break child process startup", () => {
    const env = createSecureThinClientDevEnvironment({
      PATH: "upper",
      Path: "mixed",
    });

    const pathLikeKeys = Object.keys(env).filter((key) => key.toLowerCase() === "path");
    assert.equal(pathLikeKeys.length, process.platform === "win32" ? 1 : 2);
  });
});
