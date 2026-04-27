import { describe, expect, it, vi } from "vitest";

import { createDesktopArtifactUploadClient } from "../api/desktopArtifactUploadClient";

describe("desktop artifact upload client", () => {
  it("delegates upload requests through preload and maps success into renderer result shape", async () => {
    const uploadArtifact = vi.fn().mockResolvedValue({
      operation: "artifact.upload",
      channel: "ipc.artifact.upload.response",
      ok: true,
      value: {
        descriptor: {
          storage: {
            key: "uploads/cat.png",
            mediaType: "image/png",
            sizeBytes: 3,
          },
        },
      },
    });

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

    const client = createDesktopArtifactUploadClient();
    const input = {
      fileName: "cat.png",
      mediaType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    };

    const response = await client.uploadArtifact(input);

    expect(uploadArtifact).toHaveBeenCalledWith(input);
    expect(response).toEqual({
      ok: true,
      value: {
        descriptor: {
          key: "uploads/cat.png",
          mediaType: "image/png",
          sizeBytes: 3,
        },
      },
    });
  });

  it("maps preload failures into renderer-facing error results", async () => {
    const uploadArtifact = vi.fn().mockResolvedValue({
      operation: "artifact.upload",
      channel: "ipc.artifact.upload.response",
      ok: false,
      error: {
        code: "validation",
        message: "Artifact type is not accepted: application/pdf.",
      },
    });

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

    const client = createDesktopArtifactUploadClient();
    const response = await client.uploadArtifact({
      fileName: "bad.pdf",
      mediaType: "application/pdf",
      bytes: new Uint8Array([1, 2]),
    });

    expect(response).toEqual({
      ok: false,
      error: {
        code: "validation",
        message: "Artifact type is not accepted: application/pdf.",
      },
    });
  });
});

it("maps website single-page ingestion via preload bridge", async () => {
  const ingestWebsitePage = vi.fn().mockResolvedValue({
    ok: true,
    value: {
      result: {
        target: { url: "https://example.com" },
        resolvedUrl: "https://example.com",
        acquisitionMechanismUsed: "simple-http",
      },
    },
  });

  window.desktopApi = {
    uploadArtifact: async () => ({ ok: true, value: { descriptor: { storage: { key: "uploads/a", mediaType: "text/plain", sizeBytes: 1 } } } }),
    getArtifactUploadPolicy: async () => ({ ok: true, value: { policy: { acceptedExtensions: [".txt"], acceptedMediaTypes: ["text/plain"] } } }),
    browseArtifacts: async () => ({ ok: true, value: { items: [] } }),
    readArtifactDetail: async () => ({ ok: true, value: { artifact: { locator: { storageKey: "uploads/a" }, artifactFamily: "document" } } }),
    readArtifactContentDescriptor: async () => ({ ok: true, value: { content: { locator: { storageKey: "uploads/a" }, availability: "available", retrieval: "deferred" } } }),
    readArtifactViewerMedia: async () => ({ ok: true, value: { storageKey: "uploads/a", bytes: new Uint8Array([1]) } }),
    publishArtifactToRepo: async () => ({ ok: false, error: { message: "n/a" } }),
    verifyPublishedArtifactBacking: async () => ({ ok: false, error: { message: "n/a" } }),
    registerArtifactFromRepo: async () => ({ ok: false, error: { message: "n/a" } }),
    localizeArtifactFromRepo: async () => ({ ok: false, error: { message: "n/a" } }),
    ingestWebsitePage,
    ingestWebsitePagesBatch: async () => ({ ok: false, error: { message: "n/a" } }),
  };

  const client = createDesktopArtifactUploadClient();
  const response = await client.ingestWebsitePage({ url: "https://example.com" });

  expect(ingestWebsitePage).toHaveBeenCalledWith({ url: "https://example.com" });
  expect(response.ok).toBe(true);
});

it("maps website batch ingestion via preload bridge", async () => {
  const ingestWebsitePagesBatch = vi.fn().mockResolvedValue({
    ok: true,
    value: {
      result: {
        items: [],
        summary: { attempted: 2, succeeded: 2, failed: 0 },
      },
    },
  });

  window.desktopApi = {
    uploadArtifact: async () => ({ ok: true, value: { descriptor: { storage: { key: "uploads/a", mediaType: "text/plain", sizeBytes: 1 } } } }),
    getArtifactUploadPolicy: async () => ({ ok: true, value: { policy: { acceptedExtensions: [".txt"], acceptedMediaTypes: ["text/plain"] } } }),
    browseArtifacts: async () => ({ ok: true, value: { items: [] } }),
    readArtifactDetail: async () => ({ ok: true, value: { artifact: { locator: { storageKey: "uploads/a" }, artifactFamily: "document" } } }),
    readArtifactContentDescriptor: async () => ({ ok: true, value: { content: { locator: { storageKey: "uploads/a" }, availability: "available", retrieval: "deferred" } } }),
    readArtifactViewerMedia: async () => ({ ok: true, value: { storageKey: "uploads/a", bytes: new Uint8Array([1]) } }),
    publishArtifactToRepo: async () => ({ ok: false, error: { message: "n/a" } }),
    verifyPublishedArtifactBacking: async () => ({ ok: false, error: { message: "n/a" } }),
    registerArtifactFromRepo: async () => ({ ok: false, error: { message: "n/a" } }),
    localizeArtifactFromRepo: async () => ({ ok: false, error: { message: "n/a" } }),
    ingestWebsitePage: async () => ({ ok: false, error: { message: "n/a" } }),
    ingestWebsitePagesBatch,
  };

  const client = createDesktopArtifactUploadClient();
  const response = await client.ingestWebsitePagesBatch({
    targets: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }],
  });

  expect(ingestWebsitePagesBatch).toHaveBeenCalled();
  expect(response.ok).toBe(true);
});
