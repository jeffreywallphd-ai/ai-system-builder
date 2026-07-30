import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiArtifactBrowserClient } from "../api/apiArtifactBrowserClient";
import { resolveArtifactFamily } from "../../../../../../modules/application/shared/artifact-family-classifier";

describe("api artifact browser client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls browse/detail/content/delete/publish/verify/localize endpoints and maps responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            configured: false,
          },
        }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            configured: true,
            maskedToken: "••••1234",
          },
        }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            configured: false,
          },
        }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            items: [{ storageKey: "uploads/a.png", artifactFamily: "image", mediaType: "image/png" }],
          },
        }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            artifact: {
              locator: { storageKey: "uploads/a.png" },
              artifactFamily: "image",
              mediaType: "image/png",
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            content: {
              locator: { storageKey: "uploads/a.png" },
              availability: "available",
              retrieval: "deferred",
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            storageKey: "uploads/a.png",
          },
        }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            target: {
              provider: "huggingface",
              repository: "openai/demo",
              path: "images/a.png",
              revision: "main",
              locator: "openai/demo/images/a.png",
            },
            verification: {
              exists: true,
              verifiedAt: "2026-04-18T00:00:00.000Z",
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            target: {
              provider: "huggingface",
              repository: "openai/demo",
              path: "images/a.png",
              revision: "main",
              locator: "openai/demo/images/a.png",
            },
            verification: {
              exists: true,
              verifiedAt: "2026-04-17T00:00:00.000Z",
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
          ok: true,
          value: {
            target: {
              provider: "huggingface",
              repository: "openai/demo",
              path: "images/a.png",
              revision: "main",
              locator: "openai/demo/images/a.png",
            },
            verification: {
              exists: false,
              verifiedAt: "2026-04-18T00:00:00.000Z",
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({
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
              path: "images/a.png",
              revision: "main",
              locator: "openai/demo/images/a.png",
            },
            localizedAt: "2026-04-18T00:00:00.000Z",
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiArtifactBrowserClient({ apiBaseUrl: "/api" });

    const tokenStatus = await client.getHuggingFaceTokenStatus();
    const tokenSaved = await client.setHuggingFaceToken({ token: "hf_1234" });
    const tokenCleared = await client.clearHuggingFaceToken();
    const browse = await client.browseArtifacts();
    const detail = await client.readArtifactDetail({ storageKey: "uploads/a.png" });
    const content = await client.readArtifactContent({ storageKey: "uploads/a.png" });
    const deleted = await client.deleteRegisteredArtifact({ storageKey: "uploads/a.png" }, { workspaceId: "workspace-a" });
    const imageViewUrl = client.createArtifactMediaViewUrl({ storageKey: "uploads/a.png" });
    const publish = await client.publishArtifactToHuggingFace({
      artifactId: "uploads/a.png",
      repository: "openai/demo",
      path: "images/a.png",
      repositoryCreation: { approved: true, visibility: "public" },
    });
    const verified = await client.verifyPublishedArtifactBacking({
      artifactId: "uploads/a.png",
    });
    const sourceVerified = await client.verifyImportedSourceBacking({
      artifactId: "uploads/a.png",
    });
    const localized = await client.localizeArtifactFromRepo({
      artifactId: "artifacts/20260418000000-local01",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/api/config/huggingface-token",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/config/huggingface-token",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/config/huggingface-token",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "/api/artifact/browse",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ artifactFamily: undefined, source: "thin-client.artifact-browser" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      "/api/artifact/read",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      "/api/artifact/content/read",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      7,
      "/api/artifact/delete",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ locator: { storageKey: "uploads/a.png" }, workspaceId: "workspace-a", source: "thin-client.artifact-browser" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      8,
      "/api/artifact/publish",
      expect.objectContaining({ method: "POST" }),
    );
    expect(JSON.parse((fetchMock.mock.calls[7]?.[1] as RequestInit).body as string)).toMatchObject({
      repositoryCreation: { approved: true, visibility: "public" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      9,
      "/api/artifact/publish/verify",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      10,
      "/api/artifact/source/verify",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      11,
      "/api/artifact/localize-from-repo",
      expect.objectContaining({ method: "POST" }),
    );

    expect(tokenStatus.configured).toBe(false);
    expect(tokenSaved.maskedToken).toBe("••••1234");
    expect(tokenCleared.configured).toBe(false);
    expect(browse[0].storageKey).toBe("uploads/a.png");
    expect(detail.locator.storageKey).toBe("uploads/a.png");
    expect(content.retrieval).toBe("deferred");
    expect(deleted.storageKey).toBe("uploads/a.png");
    expect((content as unknown as { bytes?: unknown }).bytes).toBeUndefined();
    expect(imageViewUrl).toBe("/api/artifact/media/view?storageKey=uploads%2Fa.png");
    expect(client.createArtifactMediaViewUrl({ storageKey: "uploads/a.png" }, { workspaceId: "workspace-a" })).toBe("/api/artifact/media/view?storageKey=uploads%2Fa.png&workspaceId=workspace-a");
    expect(publish.verification.exists).toBe(true);
    expect(verified.verification.exists).toBe(true);
    expect(sourceVerified.verification.exists).toBe(false);
    expect(localized.localObject.key).toBe("artifacts/20260418000000-local01");
  });

  it("registers repo artifacts with canonical artifactFamily resolver output", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
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
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiArtifactBrowserClient({ apiBaseUrl: "/api" });
    const scenarios = [
      {
        path: "data/train.parquet",
        mediaType: "application/x-parquet",
      },
      {
        path: "images/cat.png",
        mediaType: "image/png",
      },
      {
        path: "unknown/file.bin",
        mediaType: undefined,
      },
    ] as const;

    for (const scenario of scenarios) {
      await client.registerArtifactFromRepo({
        repository: "openai/demo",
        path: scenario.path,
        revision: "main",
        mediaType: scenario.mediaType,
      });
    }

    for (const [index, scenario] of scenarios.entries()) {
      const call = fetchMock.mock.calls[index];
      expect(call?.[0]).toBe("/api/artifact/register-from-repo");
      expect(call?.[1]).toMatchObject({
        method: "POST",
      });
      const body = JSON.parse((call?.[1] as { body?: string })?.body ?? "{}") as {
        artifactFamily?: string;
        target?: { path?: string };
        mediaType?: string;
      };
      expect(body.target?.path).toBe(scenario.path);
      expect(body.mediaType).toBe(scenario.mediaType);
      expect(body.artifactFamily).toBe(
        resolveArtifactFamily({
          mediaType: scenario.mediaType,
          fileName: scenario.path,
        }),
      );
    }
  });

  it("imports Hugging Face files through the batch import endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          repositories: [{
            repository: "openai/demo",
            revision: "main",
            status: "succeeded",
            files: [{
              repository: "openai/demo",
              revision: "main",
              path: "data/train.parquet",
              status: "registered",
              artifactId: "artifacts/20260418000000-import001",
            }],
          }],
          summary: { attempted: 1, succeeded: 1, failed: 0 },
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createApiArtifactBrowserClient({ apiBaseUrl: "/api" });
    const result = await client.importHuggingFaceFiles?.({
      files: [{ repository: "openai/demo", path: "data/train.parquet", revision: "main" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/huggingface/files/import",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          repositories: undefined,
          files: [{ repository: "openai/demo", path: "data/train.parquet", revision: "main" }],
          source: "thin-client.artifact-browser",
        }),
      }),
    );
    expect(result?.summary.succeeded).toBe(1);
    expect(result?.repositories[0]?.files[0]?.artifactId).toBe("artifacts/20260418000000-import001");
  });
});

