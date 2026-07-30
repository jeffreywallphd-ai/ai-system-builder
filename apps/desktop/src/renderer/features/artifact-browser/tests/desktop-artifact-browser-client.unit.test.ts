import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDesktopArtifactBrowserClient } from "../api/desktopArtifactBrowserClient";

async function readBlobBytes(blob: Blob): Promise<number[]> {
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () =>
      resolve(reader.result as ArrayBuffer),
    );
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsArrayBuffer(blob);
  });
  return Array.from(new Uint8Array(bytes));
}

describe("desktop artifact browser client", () => {
  const originalCreateObjectUrl = URL.createObjectURL;
  const createObjectUrl = vi.fn().mockReturnValue("blob:desktop-artifact");

  beforeEach(() => {
    createObjectUrl.mockReset().mockReturnValue("blob:desktop-artifact");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectUrl,
    });
  });

  afterEach(() => {
    delete window.desktopApi;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: originalCreateObjectUrl,
    });
    vi.restoreAllMocks();
  });

  it("uses descriptor operations plus separate media-view retrieval path", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          items: [
            {
              artifactId: "uploads/cat.png",
              storageKey: "uploads/cat.png",
              artifactFamily: "image",
            },
          ],
        },
      }),
      browseUnregisteredArtifacts: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          items: [
            {
              storageKey: "uploads/orphan.parquet",
              relativePath: "orphan.parquet",
              fileName: "orphan.parquet",
            },
          ],
        },
      }),
      registerUnregisteredArtifact: vi
        .fn()
        .mockResolvedValue({
          ok: true,
          value: { storageKey: "uploads/orphan.parquet" },
        }),
      deleteUnregisteredArtifact: vi
        .fn()
        .mockResolvedValue({
          ok: true,
          value: { storageKey: "uploads/orphan.parquet" },
        }),
      readArtifactDetail: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          artifact: {
            locator: { storageKey: "uploads/cat.png" },
            artifactFamily: "image",
            metadata: {
              websiteCapture: {
                sourceUrl: "https://example.com",
                resolvedUrl: "https://example.com/",
                requestedMode: "automatic",
                acquisitionMechanismUsed: "simple-http",
                retrievedAt: "2026-04-18T00:00:00.000Z",
              },
            },
          },
        },
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
          target: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "images/cat.png",
            revision: "main",
            locator: "openai/demo/images/cat.png",
          },
          verification: {
            exists: true,
            verifiedAt: "2026-04-17T00:00:00.000Z",
          },
        },
      }),
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
            exists: true,
            verifiedAt: "2026-04-17T00:00:00.000Z",
          },
        },
      }),
      localizeArtifactFromRepo: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          artifactId: "artifacts/20260418000000-local01",
          localObject: {
            key: "artifacts/20260418000000-local01",
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

    const items = await client.browseArtifacts();
    const detail = await client.readArtifactDetail({
      storageKey: "uploads/cat.png",
    });
    const content = await client.readArtifactContent({
      storageKey: "uploads/cat.png",
    });
    const mediaBytes = await client.readArtifactMedia({
      storageKey: "uploads/cat.png",
    });
    const mediaUrl = await client.createArtifactMediaViewUrl({
      storageKey: "uploads/cat.png",
    });

    expect(items[0].storageKey).toBe("uploads/cat.png");
    expect(items[0].artifactId).toBe("uploads/cat.png");
    expect(detail.locator.storageKey).toBe("uploads/cat.png");
    expect(content.retrieval).toBe("deferred");
    expect(detail.metadata?.websiteCapture?.acquisitionMechanismUsed).toBe(
      "simple-http",
    );
    expect(Array.from(mediaBytes.bytes)).toEqual([1, 2, 3]);
    expect(window.desktopApi.readArtifactViewerMedia).toHaveBeenCalledWith(
      { storageKey: "uploads/cat.png" },
      { workspaceId: undefined, maximumBytes: undefined },
    );
    expect(mediaUrl).toBe("blob:desktop-artifact");
    const mediaBlob = createObjectUrl.mock.calls[0]![0] as Blob;
    expect(mediaBlob.type).toBe("image/png");
    expect(await readBlobBytes(mediaBlob)).toEqual([1, 2, 3]);
    expect(window.desktopApi.browseArtifacts).toHaveBeenCalledWith(
      { artifactFamily: undefined, workspaceId: undefined },
      { workspaceId: undefined },
    );
  });

  it("supports browsing/registering/deleting unregistered artifacts", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn(),
      browseArtifacts: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { items: [] } }),
      browseUnregisteredArtifacts: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          items: [
            {
              storageKey: "uploads/orphan.json",
              relativePath: "orphan.json",
              fileName: "orphan.json",
              mediaType: "application/json",
            },
          ],
        },
      }),
      registerUnregisteredArtifact: vi
        .fn()
        .mockResolvedValue({
          ok: true,
          value: { storageKey: "uploads/orphan.json" },
        }),
      deleteUnregisteredArtifact: vi
        .fn()
        .mockResolvedValue({
          ok: true,
          value: { storageKey: "uploads/orphan.json" },
        }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi
        .fn()
        .mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockRejectedValue(new Error("unused")),
      publishArtifactToRepo: vi.fn().mockRejectedValue(new Error("unused")),
      verifyPublishedArtifactBacking: vi
        .fn()
        .mockRejectedValue(new Error("unused")),
      localizeArtifactFromRepo: vi.fn().mockRejectedValue(new Error("unused")),
    };

    const client = createDesktopArtifactBrowserClient();
    const unregistered = await client.browseUnregisteredArtifacts?.({
      workspaceId: "workspace-a",
    });
    await client.registerUnregisteredArtifact?.({
      storageKey: "uploads/orphan.json",
      workspaceId: "workspace-a",
    });
    await client.deleteUnregisteredArtifact?.({
      storageKey: "uploads/orphan.json",
      workspaceId: "workspace-a",
    });

    expect(unregistered).toEqual([
      expect.objectContaining({ storageKey: "uploads/orphan.json" }),
    ]);
    expect(window.desktopApi.browseUnregisteredArtifacts).toHaveBeenCalledWith(
      { workspaceId: "workspace-a" },
      { workspaceId: "workspace-a" },
    );
    expect(window.desktopApi.registerUnregisteredArtifact).toHaveBeenCalledWith(
      { storageKey: "uploads/orphan.json", workspaceId: "workspace-a" },
      { workspaceId: "workspace-a" },
    );
    expect(window.desktopApi.deleteUnregisteredArtifact).toHaveBeenCalledWith(
      { storageKey: "uploads/orphan.json", workspaceId: "workspace-a" },
      { workspaceId: "workspace-a" },
    );
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
      readArtifactContentDescriptor: vi
        .fn()
        .mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockRejectedValue(new Error("unused")),
      publishArtifactToRepo: vi.fn().mockRejectedValue(new Error("unused")),
      verifyPublishedArtifactBacking: vi
        .fn()
        .mockRejectedValue(new Error("unused")),
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
      browseArtifacts: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          artifact: {
            locator: { storageKey: "uploads/cat.png" },
            artifactFamily: "image",
            metadata: {
              websiteCapture: {
                sourceUrl: "https://example.com",
                resolvedUrl: "https://example.com/",
                requestedMode: "automatic",
                acquisitionMechanismUsed: "simple-http",
                retrievedAt: "2026-04-18T00:00:00.000Z",
              },
            },
          },
        },
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
          target: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "images/cat.png",
            revision: "main",
            locator: "openai/demo/images/cat.png",
          },
          verification: {
            exists: true,
            verifiedAt: "2026-04-17T00:00:00.000Z",
          },
        },
      }),
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
            exists: true,
            verifiedAt: "2026-04-17T00:00:00.000Z",
          },
        },
      }),
      localizeArtifactFromRepo: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          artifactId: "artifacts/20260418000000-local01",
          localObject: {
            key: "artifacts/20260418000000-local01",
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

    const mediaUrl = await client.createArtifactMediaViewUrl({
      storageKey: "uploads/cat.png",
    });
    expect(mediaUrl).toBe("blob:desktop-artifact");
    const mediaBlob = createObjectUrl.mock.calls[0]![0] as Blob;
    expect(await readBlobBytes(mediaBlob)).toEqual([1, 2, 3]);
  });

  it("publishes artifact backing through preload publish bridge", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi
        .fn()
        .mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockRejectedValue(new Error("unused")),
      publishArtifactToRepo: vi.fn().mockResolvedValue({
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
            verifiedAt: "2026-04-17T00:00:00.000Z",
          },
        },
      }),
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
            exists: true,
            verifiedAt: "2026-04-17T00:00:00.000Z",
          },
        },
      }),
      localizeArtifactFromRepo: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          artifactId: "artifacts/20260418000000-local01",
          localObject: {
            key: "artifacts/20260418000000-local01",
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
    const result = await client.publishArtifactToHuggingFace({
      workspaceId: "workspace-a",
      artifactId: "uploads/cat.png",
      repository: "openai/demo",
      path: "images/cat.png",
      revision: "main",
      repositoryCreation: { approved: true, visibility: "private" },
    });

    expect(window.desktopApi.publishArtifactToRepo).toHaveBeenCalledWith(
      {
        workspaceId: "workspace-a",
        artifactId: "uploads/cat.png",
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          path: "images/cat.png",
          revision: "main",
        },
        mediaType: undefined,
        repositoryCreation: { approved: true, visibility: "private" },
      },
      { workspaceId: "workspace-a" },
    );
    expect(result.verification.exists).toBe(true);
  });

  it("re-checks published artifact backing through preload verify bridge", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi
        .fn()
        .mockRejectedValue(new Error("unused")),
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
          localObject: {
            key: "artifacts/20260418000000-local01",
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
    const result = await client.verifyPublishedArtifactBacking({
      artifactId: "uploads/cat.png",
    });

    expect(
      window.desktopApi.verifyPublishedArtifactBacking,
    ).toHaveBeenCalledWith({
      artifactId: "uploads/cat.png",
    });
    expect(result.verification.exists).toBe(false);
  });

  it("registers repo artifacts without forcing image artifactFamily in the generic path", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi
        .fn()
        .mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockRejectedValue(new Error("unused")),
      publishArtifactToRepo: vi.fn().mockRejectedValue(new Error("unused")),
      verifyPublishedArtifactBacking: vi
        .fn()
        .mockRejectedValue(new Error("unused")),
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
            verification: {
              exists: true,
              verifiedAt: "2026-04-18T00:00:00.000Z",
            },
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
      browseArtifacts: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi
        .fn()
        .mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockRejectedValue(new Error("unused")),
      publishArtifactToRepo: vi.fn().mockRejectedValue(new Error("unused")),
      verifyPublishedArtifactBacking: vi
        .fn()
        .mockRejectedValue(new Error("unused")),
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
      workspaceId: "workspace-a",
      artifactId: "artifacts/20260418000000-local01",
    });

    expect(window.desktopApi.localizeArtifactFromRepo).toHaveBeenCalledWith({
      workspaceId: "workspace-a",
      artifactId: "artifacts/20260418000000-local01",
    });
    expect(result.localObject.key).toBe("artifacts/20260418000000-local01");
  });

  it("re-checks imported source backing through preload source-verify bridge", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi
        .fn()
        .mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockRejectedValue(new Error("unused")),
      publishArtifactToRepo: vi.fn().mockRejectedValue(new Error("unused")),
      verifyPublishedArtifactBacking: vi
        .fn()
        .mockRejectedValue(new Error("unused")),
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

    expect(
      window.desktopApi.verifyImportedArtifactSourceBacking,
    ).toHaveBeenCalledWith({
      artifactId: "artifacts/20260418000000-local01",
    });
    expect(result.verification.exists).toBe(true);
  });

  it("normalizes object-like byte payloads before building object urls", async () => {
    window.desktopApi = {
      uploadArtifact: vi.fn().mockRejectedValue(new Error("unused")),
      browseArtifacts: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { items: [] } }),
      readArtifactDetail: vi.fn().mockRejectedValue(new Error("unused")),
      readArtifactContentDescriptor: vi
        .fn()
        .mockRejectedValue(new Error("unused")),
      readArtifactViewerMedia: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          storageKey: "uploads/cat.png",
          mediaType: "image/png",
          bytes: { 0: 4, 1: 5, 2: 6 },
        },
      }),
      publishArtifactToRepo: vi.fn().mockRejectedValue(new Error("unused")),
      verifyPublishedArtifactBacking: vi
        .fn()
        .mockRejectedValue(new Error("unused")),
      localizeArtifactFromRepo: vi.fn().mockRejectedValue(new Error("unused")),
    };

    const client = createDesktopArtifactBrowserClient();
    const media = await client.readArtifactMedia({
      storageKey: "uploads/cat.png",
    });
    const mediaUrl = await client.createArtifactMediaViewUrl({
      storageKey: "uploads/cat.png",
    });

    expect(Array.from(media.bytes)).toEqual([4, 5, 6]);
    expect(mediaUrl).toBe("blob:desktop-artifact");
  });
});
