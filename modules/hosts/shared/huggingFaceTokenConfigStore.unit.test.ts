import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "../../testing/node-test";

import { createHuggingFaceTokenConfigStore } from "./huggingFaceTokenConfigStore";

describe("huggingFaceTokenConfigStore", () => {
  it("saves and reports configured token status with masking", () => {
    const root = mkdtempSync(path.join(tmpdir(), "hf-token-store-"));
    const store = createHuggingFaceTokenConfigStore({ filePath: path.join(root, "token.json") });

    const status = store.setToken("hf_abcdefghijklmnopqrstuvwxyz1234");

    expect(status.configured).toBe(true);
    expect(status.maskedToken).toBe("••••1234");
    expect(store.getToken()).toBe("hf_abcdefghijklmnopqrstuvwxyz1234");
  });

  it("loads existing token from disk", () => {
    const root = mkdtempSync(path.join(tmpdir(), "hf-token-store-"));
    const filePath = path.join(root, "token.json");
    const first = createHuggingFaceTokenConfigStore({ filePath });
    first.setToken("hf_reloaded5678");

    const second = createHuggingFaceTokenConfigStore({ filePath });
    expect(second.getStatus()).toEqual({ configured: true, maskedToken: "••••5678" });
  });

  it("clears token state", () => {
    const root = mkdtempSync(path.join(tmpdir(), "hf-token-store-"));
    const store = createHuggingFaceTokenConfigStore({ filePath: path.join(root, "token.json") });
    store.setToken("hf_clear0000");

    const status = store.clearToken();

    expect(status).toEqual({ configured: false });
    expect(store.getToken()).toBeUndefined();
  });
});
