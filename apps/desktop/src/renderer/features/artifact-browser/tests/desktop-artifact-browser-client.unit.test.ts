import { afterEach, describe, expect, it, vi } from "vitest";

import { createDesktopArtifactBrowserClient } from "../api/desktopArtifactBrowserClient";

describe("desktop artifact browser client", () => {
  afterEach(() => {
    delete window.desktopApi;
    vi.restoreAllMocks();
  });

  it("uses descriptor operations plus separate media-view retrieval path", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          items: [{ artifactId: "uploads/cat.png", storageKey: "uploads/cat.png", artifactFamily: "image" }],
        },
      }),
      browseUnregisteredArtifacts: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [{ storageKey: "uploads/orphan.parquet", relativePath: "orphan.parquet", fileName: "orphan.parquet" }] },
      }),
      registerUnregisteredArtifact: vi.fn().mockResolvedValue({ ok: true, value: { storageKey: "uploads/orphan.parquet" } }),
      deleteUnregisteredArtifact: vi.fn().mockResolvedValue({ ok: true, value: { storageKey: "uploads/orphan.parquet" } }),
      readArtifactDetail: vi.fn().mockResolvedValue({
        ok: true,
        value: { artifact: { locator: { storageKey: "uploads/cat.png" }, artifactFamily: "image", metadata: { websiteCapture: { sourceUrl: "https://example.com", resolvedUrl: "https://example.com/", requestedMode: "automatic", acquisitionMechanismUsed: "simple-http", retrievedAt: "2026-04-18T00:00:00.000Z" } } } },
      }),
      readArtifactContentDescriptor: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          content: {
            locator: { storageKey: "uploads/cat.png" },
            availability: "available",
            retrieval: "deferred",
          },
        },
      }),
      readArtifactViewerMedia: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          storageKey: "uploads/cat.png",
          mediaType: "image/png",
          bytes: new Uint8Array([1, 2, 3]),
        },
      }),
      publishArtifactToRepo: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          target: { provider: "huggingface", repository: "openai/demo", path: "images/cat.png", revision: "main", locator: "openai/demo/images/cat.png" },
          verification: { exists: true, verifiedAt: "2026-04-17T00:00:00.000Z" },
        },
      }),
      verifyPublishedArtifactBacking: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          target: { provider: "huggingface", repository: "openai/demo", path: "images/cat.png", revision: "main", locator: "openai/demo/images/cat.png" },
          verification: { exists: true, verifiedAt: "2026-04-17T00:00:00.000Z" },
        },
      }),
      localizeArtifactFromRepo: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          artifactId: "artifacts/20260418000000-local01",
          localObject: { key: "artifacts/20260418000000-local01", sizeBytes: 3 },
          source: { provider: "huggingface", repository: "openai/demo", path: "images/cat.png", locator: "openai/demo/images/cat.png" },
          localizedAt: "2026-04-18T00:00:00.000Z",
        },
      }),
    };

    const client = createDesktopArtifactBrowserClient();

    const items = await client.browseArtifacts();
    const detail = await client.readArtifactDetail({ storageKey: "uploads/cat.png" });
    const content = await client.readArtifactContent({ storageKey: "uploads/cat.png" });
    const mediaBytes = await client.readArtifactMedia({ storageKey: "uploads/cat.png" });
    const mediaUrl = await client.createArtifactMediaViewUrl({ storageKey: "uploads/cat.png" });

    expect(items[0].storageKey).toBe("uploads/cat.png");
    expect(items[0].artifactId).toBe("uploads/cat.png");
    expect(detail.locator.storageKey).toBe("uploads/cat.png");
    expect(content.retrieval).toBe("deferred");
    expect(detail.metadata?.websiteCapture?.acquisitionMechanismUsed).toBe("simple-http");
    expect(Array.from(mediaBytes.bytes)).toEqual([1, 2, 3]);
    expect(window.desktopApi.readArtifactViewerMedia).toHaveBeenCalledWith({ storageKey: "uploads/cat.png" });
    expect(mediaUrl).toContain("data:image/png;base64,");
    expect(window.desktopApi.browseArtifacts).toHaveBeenCalledWith({ artifactFamily: undefined });
  });

  it("supports browsing/registering/deleting unregistered artifacts", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn(),
      browseArtifacts: vi.fn().mockResolvedValue({ ok: true, value: { items: [] } }),
      browseUnregisteredArtifacts: vi.fn().mockResolvedValue({
        ok: true,
        value: { items: [{ storageKey: "uploads/orphan.json", relativePath: "orphan.json", fileName: "orphan.json", mediaType: "application/json" }] },
      }),
      registerUnregisteredArtifact: vi.fn().mockResolvedValue({ ok: true, value: { storageKey: "uploads/orphan.json" } }),
      deleteUnregisteredArtifact: vi.fn().mockResolvedValue({ ok: true, value: { storageKey: "uploads/orphan.json" } }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockRejectedValue(new Error("unused")),
      publishArtifactToRepo: vi.fn().mockRejectedValue(new Error("unused")),
      verifyPublishedArtifactBacking: vi.fn().mockRejectedValue(new Error("unused")),
      localizeArtifactFromRepo: vi.fn().mockRejectedValue(new Error("unused")),
    };

    const client = createDesktopArtifactBrowserClient();
    const unregistered = await client.browseUnregisteredArtifacts?.();
    await client.registerUnregisteredArtifact?.({ storageKey: "uploads/orphan.json" });
    await client.deleteUnregisteredArtifact?.({ storageKey: "uploads/orphan.json" });

    expect(unregistered).toEqual([
      expect.objectContaining({ storageKey: "uploads/orphan.json" }),
    ]);
    expect(window.desktopApi.registerUnregisteredArtifact).toHaveBeenCalledWith({ storageKey: "uploads/orphan.json" });
    expect(window.desktopApi.deleteUnregisteredArtifact).toHaveBeenCalledWith({ storageKey: "uploads/orphan.json" });
  });

  it("maps registered artifact browse results from registeredItemsMap payloads", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn(),
      browseArtifacts: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          registeredItemsMap: {
            "artifacts/20260418000000-import001": {
              artifactId: "artifacts/20260418000000-import001",
              storageKey: "artifacts/20260418000000-import001",
              artifactFamily: "tabular",
            },
          },
        },
      }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockRejectedValue(new Error("unused")),
      publishArtifactToRepo: vi.fn().mockRejectedValue(new Error("unused")),
      verifyPublishedArtifactBacking: vi.fn().mockRejectedValue(new Error("unused")),
      localizeArtifactFromRepo: vi.fn().mockRejectedValue(new Error("unused")),
    };

    const client = createDesktopArtifactBrowserClient();
    const items = await client.browseArtifacts();

    expect(items).toEqual([
      {
        artifactId: "artifacts/20260418000000-import001",
        storageKey: "artifacts/20260418000000-import001",
        artifactFamily: "tabular",
      },
    ]);
  });

  it("creates media blob from the typed-array view, not the full backing buffer", async () => {
    const backingBytes = new Uint8Array([9, 1, 2, 3, 7]);
    const slicedView = backingBytes.subarray(1, 4);

    window.desktopApi = {
      uploadArtifact: vi.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: vi.fn().mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: vi.fn().mockResolvedValue({
        ok: true,
        value: { artifact: { locator: { storageKey: "uploads/cat.png" }, artifactFamily: "image", metadata: { websiteCapture: { sourceUrl: "https://example.com", resolvedUrl: "https://example.com/", requestedMode: "automatic", acquisitionMechanismUsed: "simple-http", retrievedAt: "2026-04-18T00:00:00.000Z" } } } },
      }),
      readArtifactContentDescriptor: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          content: {
            locator: { storageKey: "uploads/cat.png" },
            availability: "available",
            retrieval: "deferred",
          },
        },
      }),
      readArtifactViewerMedia: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          storageKey: "uploads/cat.png",
          mediaType: "image/png",
          bytes: slicedView,
        },
      }),
      publishArtifactToRepo: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          target: { provider: "huggingface", repository: "openai/demo", path: "images/cat.png", revision: "main", locator: "openai/demo/images/cat.png" },
          verification: { exists: true, verifiedAt: "2026-04-17T00:00:00.000Z" },
        },
      }),
      verifyPublishedArtifactBacking: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          target: { provider: "huggingface", repository: "openai/demo", path: "images/cat.png", revision: "main", locator: "openai/demo/images/cat.png" },
          verification: { exists: true, verifiedAt: "2026-04-17T00:00:00.000Z" },
        },
      }),
      localizeArtifactFromRepo: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          artifactId: "artifacts/20260418000000-local01",
          localObject: { key: "artifacts/20260418000000-local01", sizeBytes: 3 },
          source: { provider: "huggingface", repository: "openai/demo", path: "images/cat.png", locator: "openai/demo/images/cat.png" },
          localizedAt: "2026-04-18T00:00:00.000Z",
        },
      }),
    };

    const client = createDesktopArtifactBrowserClient();

    const mediaUrl = await client.createArtifactMediaViewUrl({ storageKey: "uploads/cat.png" });
    expect(mediaUrl).toContain("data:image/png;base64,");
  });

  it("publishes artifact backing through preload publish bridge", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: vi.fn().mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockRejectedValue(new Error("unused")),
      publishArtifactToRepo: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          target: { provider: "huggingface", repository: "openai/demo", path: "images/cat.png", revision: "main", locator: "openai/demo/images/cat.png" },
          verification: { exists: true, verifiedAt: "2026-04-17T00:00:00.000Z" },
        },
      }),
      verifyPublishedArtifactBacking: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          target: { provider: "huggingface", repository: "openai/demo", path: "images/cat.png", revision: "main", locator: "openai/demo/images/cat.png" },
          verification: { exists: true, verifiedAt: "2026-04-17T00:00:00.000Z" },
        },
      }),
      localizeArtifactFromRepo: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          artifactId: "artifacts/20260418000000-local01",
          localObject: { key: "artifacts/20260418000000-local01", sizeBytes: 3 },
          source: { provider: "huggingface", repository: "openai/demo", path: "images/cat.png", locator: "openai/demo/images/cat.png" },
          localizedAt: "2026-04-18T00:00:00.000Z",
        },
      }),
    };

    const client = createDesktopArtifactBrowserClient();
    const result = await client.publishArtifactToHuggingFace({
      artifactId: "uploads/cat.png",
      repository: "openai/demo",
      path: "images/cat.png",
      revision: "main",
    });

    expect(window.desktopApi.publishArtifactToRepo).toHaveBeenCalledWith({
      artifactId: "uploads/cat.png",
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
        revision: "main",
      },
      mediaType: undefined,
    });
    expect(result.verification.exists).toBe(true);
  });

  it("re-checks published artifact backing through preload verify bridge", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: vi.fn().mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockRejectedValue(new Error("unused")),
      publishArtifactToRepo: vi.fn().mockRejectedValue(new Error("unused")),
      verifyPublishedArtifactBacking: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          target: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "images/cat.png",
            revision: "main",
            locator: "openai/demo/images/cat.png",
          },
          verification: {
            exists: false,
            verifiedAt: "2026-04-18T00:00:00.000Z",
          },
        },
      }),
      localizeArtifactFromRepo: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          artifactId: "artifacts/20260418000000-local01",
          localObject: { key: "artifacts/20260418000000-local01", sizeBytes: 3 },
          source: { provider: "huggingface", repository: "openai/demo", path: "images/cat.png", locator: "openai/demo/images/cat.png" },
          localizedAt: "2026-04-18T00:00:00.000Z",
        },
      }),
    };

    const client = createDesktopArtifactBrowserClient();
    const result = await client.verifyPublishedArtifactBacking({
      artifactId: "uploads/cat.png",
    });

    expect(window.desktopApi.verifyPublishedArtifactBacking).toHaveBeenCalledWith({
      artifactId: "uploads/cat.png",
    });
    expect(result.verification.exists).toBe(false);
  });

  it("registers repo artifacts without forcing image artifactFamily in the generic path", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: vi.fn().mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockRejectedValue(new Error("unused")),
      publishArtifactToRepo: vi.fn().mockRejectedValue(new Error("unused")),
      verifyPublishedArtifactBacking: vi.fn().mockRejectedValue(new Error("unused")),
      registerArtifactFromRepo: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          artifactId: "artifacts/20260418000000-import001",
          backing: {
            role: "imported-source",
            target: {
              provider: "huggingface",
              repository: "openai/demo",
              path: "data/train.parquet",
              revision: "main",
              locator: "openai/demo/data/train.parquet",
            },
            verification: { exists: true, verifiedAt: "2026-04-18T00:00:00.000Z" },
          },
        },
      }),
      localizeArtifactFromRepo: vi.fn().mockRejectedValue(new Error("unused")),
    };

    const client = createDesktopArtifactBrowserClient();
    await client.registerArtifactFromRepo({
      repository: "openai/demo",
      path: "data/train.parquet",
      revision: "main",
      mediaType: "application/x-parquet",
    });

    expect(window.desktopApi.registerArtifactFromRepo).toHaveBeenCalledWith({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "data/train.parquet",
        revision: "main",
      },
      mediaType: "application/x-parquet",
    });
  });

  it("localizes imported artifact bytes through preload localize bridge", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: vi.fn().mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockRejectedValue(new Error("unused")),
      publishArtifactToRepo: vi.fn().mockRejectedValue(new Error("unused")),
      verifyPublishedArtifactBacking: vi.fn().mockRejectedValue(new Error("unused")),
      localizeArtifactFromRepo: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          artifactId: "artifacts/20260418000000-local01",
          localObject: {
            key: "artifacts/20260418000000-local01",
            mediaType: "image/png",
            sizeBytes: 3,
          },
          source: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "images/cat.png",
            locator: "openai/demo/images/cat.png",
          },
          localizedAt: "2026-04-18T00:00:00.000Z",
        },
      }),
    };

    const client = createDesktopArtifactBrowserClient();
    const result = await client.localizeArtifactFromRepo({
      artifactId: "artifacts/20260418000000-local01",
    });

    expect(window.desktopApi.localizeArtifactFromRepo).toHaveBeenCalledWith({
      artifactId: "artifacts/20260418000000-local01",
    });
    expect(result.localObject.key).toBe("artifacts/20260418000000-local01");
  });

  it("re-checks imported source backing through preload source-verify bridge", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: vi.fn().mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockRejectedValue(new Error("unused")),
      publishArtifactToRepo: vi.fn().mockRejectedValue(new Error("unused")),
      verifyPublishedArtifactBacking: vi.fn().mockRejectedValue(new Error("unused")),
      verifyImportedArtifactSourceBacking: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          target: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "images/cat.png",
            revision: "main",
            locator: "openai/demo/images/cat.png",
          },
          verification: {
            exists: true,
            verifiedAt: "2026-04-18T00:00:00.000Z",
          },
        },
      }),
      localizeArtifactFromRepo: vi.fn().mockRejectedValue(new Error("unused")),
    };

    const client = createDesktopArtifactBrowserClient();
    const result = await client.verifyImportedSourceBacking({
      artifactId: "artifacts/20260418000000-local01",
    });

    expect(window.desktopApi.verifyImportedArtifactSourceBacking).toHaveBeenCalledWith({
      artifactId: "artifacts/20260418000000-local01",
    });
    expect(result.verification.exists).toBe(true);
  });

  it("normalizes object-like byte payloads before building media data urls", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: vi.fn().mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          storageKey: "uploads/cat.png",
          mediaType: "image/png",
          bytes: { 0: 4, 1: 5, 2: 6 },
        },
      }),
      publishArtifactToRepo: vi.fn().mockRejectedValue(new Error("unused")),
      verifyPublishedArtifactBacking: vi.fn().mockRejectedValue(new Error("unused")),
      localizeArtifactFromRepo: vi.fn().mockRejectedValue(new Error("unused")),
    };

    const client = createDesktopArtifactBrowserClient();
    const media = await client.readArtifactMedia({ storageKey: "uploads/cat.png" });
    const mediaUrl = await client.createArtifactMediaViewUrl({ storageKey: "uploads/cat.png" });

    expect(Array.from(media.bytes)).toEqual([4, 5, 6]);
    expect(mediaUrl).toContain("data:image/png;base64,");
  });
});
