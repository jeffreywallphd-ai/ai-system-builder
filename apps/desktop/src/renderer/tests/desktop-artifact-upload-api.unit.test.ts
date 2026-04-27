import { afterEach, describe, expect, it, vi } from "vitest";

import { getDesktopApi } from "../lib/desktopApi";

describe("desktopApi bridge access", () => {
  afterEach(() => {
    delete window.desktopApi;
  });

  it("returns the preload-exposed desktop API when present", async () => {
    const uploadArtifact = vi.fn().mockRejectedValue(new Error("not implemented"));
    window.desktopApi = {
      uploadArtifact,
      browseArtifacts: async () => ({ ok: true, value: { items: [] } }),
      readArtifactDetail: async () => ({ ok: true, value: { artifact: { locator: { storageKey: "uploads/a.png" }, artifactFamily: "image" } } }),
      readArtifactContentDescriptor: async () => ({ ok: true, value: { content: { locator: { storageKey: "uploads/a.png" }, availability: "available", retrieval: "deferred" } } }),
      readArtifactViewerMedia: async () => ({ ok: true, value: { storageKey: "uploads/a.png", bytes: new Uint8Array([1]) } }),
      publishArtifactToRepo: async () => ({ ok: true, value: { target: { provider: "huggingface", repository: "openai/demo", path: "images/a.png", locator: "openai/demo/images/a.png" }, verification: { exists: true } } }),
      verifyPublishedArtifactBacking: async () => ({ ok: true, value: { target: { provider: "huggingface", repository: "openai/demo", path: "images/a.png", locator: "openai/demo/images/a.png" }, verification: { exists: true } } }),
      registerArtifactFromRepo: async () => ({ ok: true, value: { artifactId: "imports/huggingface/openai/demo/main/images/a.png", backing: { role: "imported-source", target: { provider: "huggingface", repository: "openai/demo", path: "images/a.png", revision: "main", locator: "openai/demo/images/a.png" }, verification: { exists: true, verifiedAt: "2026-04-18T00:00:00.000Z" } } } }),
      localizeArtifactFromRepo: async () => ({ ok: true, value: { artifactId: "artifacts/20260418000000-local01", localObject: { key: "artifacts/20260418000000-local01", sizeBytes: 1 }, source: { provider: "huggingface", repository: "openai/demo", path: "images/a.png", locator: "openai/demo/images/a.png" }, localizedAt: "2026-04-18T00:00:00.000Z" } }),
    };

    const api = getDesktopApi();

    expect(api).toBe(window.desktopApi);
    await expect(
      api.uploadArtifact({
        fileName: "cat.png",
        mediaType: "image/png",
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow("not implemented");
    expect(uploadArtifact).toHaveBeenCalledTimes(1);
  });

  it("throws a clear error when preload has not exposed the desktop API", () => {
    expect(() => getDesktopApi()).toThrow("Desktop preload API is unavailable.");
  });
});
