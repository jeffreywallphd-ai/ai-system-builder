import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import {
  createHasArtifactInRepoRequest,
  createRetrieveArtifactFromRepoRequest,
  createStoreArtifactInRepoRequest,
} from "../../../../contracts/storage";
import {
  createHuggingFaceArtifactRepoStorageAdapter,
  type HuggingFaceFetchImplementation,
} from "../createHuggingFaceArtifactRepoStorageAdapter";

function createHubClientDouble() {
  return {
    fileExists: testDouble.fn(async () => true),
    uploadFile: testDouble.fn(async () => undefined),
    downloadFile: testDouble.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        "content-type": "image/png",
      },
    })),
  };
}

describe("createHuggingFaceArtifactRepoStorageAdapter", () => {
  it("requires official hub client availability when no hub client is provided", async () => {
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      officialHubClientLoader: testDouble.fn(async () => {
        throw new Error("module not found");
      }),
    });

    const result = await adapter.hasArtifactInRepo(
      createHasArtifactInRepoRequest({
        provider: "huggingface",
        repository: "openai/demo",
        path: "a.txt",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unavailable failure.");
    }

    expect(result.error.code).toBe("unavailable");
    expect(result.error.message).toContain("@huggingface/hub");
  });

  it("validates provider = huggingface", async () => {
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient: createHubClientDouble(),
    });

    const result = await adapter.hasArtifactInRepo(
      createHasArtifactInRepoRequest({
        provider: "github",
        repository: "openai/demo",
        path: "a.txt",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected validation failure.");
    }

    expect(result.error.code).toBe("validation");
    expect(String(result.error.details?.reason)).toContain("requires provider");
  });

  it("validates repository-relative path semantics", async () => {
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient: createHubClientDouble(),
    });

    const result = await adapter.retrieveArtifactFromRepo(
      createRetrieveArtifactFromRepoRequest({
        provider: "huggingface",
        repository: "openai/demo",
        path: "../secret.txt",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected validation failure.");
    }

    expect(result.error.code).toBe("validation");
  });

  it("uses official hub-client methods for has/store/retrieve", async () => {
    const hubClient = createHubClientDouble();
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient,
      accessToken: "token-123",
    });

    const hasResult = await adapter.hasArtifactInRepo(
      createHasArtifactInRepoRequest({
        provider: "huggingface",
        repository: "datasets/openai/demo",
        revision: "main",
        path: "image.png",
      }),
    );
    const storeResult = await adapter.storeArtifactInRepo(
      createStoreArtifactInRepoRequest(new Uint8Array([1, 2, 3]), {
        target: {
          provider: "huggingface",
          repository: "datasets/openai/demo",
          revision: "main",
          path: "artifacts/a.bin",
        },
      }),
    );
    const retrieveResult = await adapter.retrieveArtifactFromRepo(
      createRetrieveArtifactFromRepoRequest({
        provider: "huggingface",
        repository: "datasets/openai/demo",
        revision: "main",
        path: "artifacts/a.bin",
      }),
    );

    expect(hasResult.ok).toBe(true);
    expect(storeResult.ok).toBe(true);
    expect(retrieveResult.ok).toBe(true);
    expect(hubClient.fileExists).toHaveBeenCalledWith({
      repo: { type: "dataset", name: "openai/demo" },
      path: "image.png",
      revision: "main",
      accessToken: "token-123",
    });
    const uploadCall = hubClient.uploadFile.mock.calls[0]?.[0] as {
      repo: { type: string; name: string };
      branch: string;
      accessToken: string;
      file: { content: Blob | Uint8Array };
    };
    expect(uploadCall.repo).toEqual({ type: "dataset", name: "openai/demo" });
    expect(uploadCall.branch).toBe("main");
    expect(uploadCall.accessToken).toBe("token-123");
    if (typeof Blob !== "undefined") {
      expect(uploadCall.file.content instanceof Blob).toBe(true);
    } else {
      expect(uploadCall.file.content instanceof Uint8Array).toBe(true);
    }
    expect(hubClient.downloadFile).toHaveBeenCalledWith({
      repo: { type: "dataset", name: "openai/demo" },
      path: "artifacts/a.bin",
      revision: "main",
      accessToken: "token-123",
    });
  });

  it("requires token for store and returns explicit unavailable auth-required error", async () => {
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient: createHubClientDouble(),
    });

    const missingTokenResult = await adapter.storeArtifactInRepo(
      createStoreArtifactInRepoRequest(new Uint8Array([1]), {
        target: {
          provider: "huggingface",
          repository: "openai/demo",
          revision: "main",
          path: "artifacts/a.bin",
        },
      }),
    );

    expect(missingTokenResult.ok).toBe(false);
    if (missingTokenResult.ok) {
      throw new Error("Expected missing token failure.");
    }
    expect(missingTokenResult.error.code).toBe("unavailable");
    expect(missingTokenResult.error.message).toContain("requires authentication");
  });

  it("maps provider status errors to explicit contract codes", async () => {
    const hubClient = createHubClientDouble();
    let callCount = 0;
    hubClient.downloadFile = testDouble.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        throw {
          statusCode: 404,
          message: "Missing file",
        };
      }

      throw {
        statusCode: 503,
        message: "Provider down",
      };
    });

    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient,
      accessToken: "token",
    });

    const notFound = await adapter.retrieveArtifactFromRepo(
      createRetrieveArtifactFromRepoRequest({
        provider: "huggingface",
        repository: "openai/demo",
        path: "missing.bin",
      }),
    );
    const unavailable = await adapter.retrieveArtifactFromRepo(
      createRetrieveArtifactFromRepoRequest({
        provider: "huggingface",
        repository: "openai/demo",
        path: "down.bin",
      }),
    );

    expect(notFound.ok).toBe(false);
    expect(unavailable.ok).toBe(false);
    if (notFound.ok || unavailable.ok) {
      throw new Error("Expected failures.");
    }

    expect(notFound.error.code).toBe("not-found");
    expect(unavailable.error.code).toBe("unavailable");
  });

  it("includes publication diagnostics when storeArtifactInRepo fails unexpectedly", async () => {
    const hubClient = createHubClientDouble();
    hubClient.uploadFile = testDouble.fn(async () => {
      throw new Error("socket timeout");
    });

    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient,
      accessToken: "token",
    });

    const result = await adapter.storeArtifactInRepo(
      createStoreArtifactInRepoRequest(new Uint8Array([1, 2, 3]), {
        target: {
          provider: "huggingface",
          repository: "OpenFinAL/AISysBuilderTest",
          revision: "main",
          path: "dataset.parquet",
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected failure.");
    }
    expect(result.error.details?.repository).toBe("OpenFinAL/AISysBuilderTest");
    expect(result.error.details?.pathInRepo).toBe("dataset.parquet");
    expect(result.error.details?.hasAccessToken).toBe(true);
    expect(result.error.details?.contentSizeBytes).toBe(3);
  });

  it("creates dataset repository and retries upload when store fails with provider 404", async () => {
    const hubClient = createHubClientDouble();
    let uploadAttempt = 0;
    hubClient.uploadFile = testDouble.fn(async () => {
      uploadAttempt += 1;
      if (uploadAttempt === 1) {
        throw {
          statusCode: 404,
          message: "Repository not found",
        };
      }
    });
    const fetchImplementation = testDouble.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as HuggingFaceFetchImplementation;
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient,
      fetchImplementation,
      accessToken: "hf_test",
    });

    const result = await adapter.storeArtifactInRepo(
      createStoreArtifactInRepoRequest(new Uint8Array([1, 2, 3]), {
        target: {
          provider: "huggingface",
          repository: "OpenFinAL/ai-system-builder-test-2",
          revision: "main",
          path: "dataset/train.parquet",
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(hubClient.uploadFile).toHaveBeenCalledTimes(2);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://huggingface.co/api/repos/create",
      {
        method: "POST",
        headers: {
          authorization: "Bearer hf_test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "ai-system-builder-test-2",
          organization: "OpenFinAL",
          type: "dataset",
        }),
      },
    );
  });

  it("continues store retry flow when repository create returns already-exists 409", async () => {
    const hubClient = createHubClientDouble();
    let uploadAttempt = 0;
    hubClient.uploadFile = testDouble.fn(async () => {
      uploadAttempt += 1;
      if (uploadAttempt === 1) {
        throw {
          statusCode: 404,
          message: "Repository not found",
        };
      }
    });
    const fetchImplementation = testDouble.fn(async () => new Response(null, { status: 409 })) as unknown as HuggingFaceFetchImplementation;
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient,
      fetchImplementation,
      accessToken: "hf_test",
    });

    const result = await adapter.storeArtifactInRepo(
      createStoreArtifactInRepoRequest(new Uint8Array([5]), {
        target: {
          provider: "huggingface",
          repository: "OpenFinAL/ai-system-builder-test-2",
          revision: "main",
          path: "dataset/eval.parquet",
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(hubClient.uploadFile).toHaveBeenCalledTimes(2);
  });

  it("maps provider 401 without token to clear auth-required unavailable failure", async () => {
    const hubClient = createHubClientDouble();
    hubClient.fileExists = testDouble.fn(async () => {
      throw {
        statusCode: 401,
        message: "Unauthorized",
      };
    });

    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient,
    });

    const result = await adapter.hasArtifactInRepo(
      createHasArtifactInRepoRequest({
        provider: "huggingface",
        repository: "openai/private-demo",
        path: "a.bin",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unavailable auth-required failure.");
    }
    expect(result.error.code).toBe("unavailable");
    expect(result.error.message).toContain("No token is configured");
    expect(result.error.code).not.toBe("not-found");
  });

  it("maps provider 403 with token to invalid-token-or-access-denied unavailable failure", async () => {
    const hubClient = createHubClientDouble();
    hubClient.downloadFile = testDouble.fn(async () => {
      throw {
        statusCode: 403,
        message: "Forbidden",
      };
    });

    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient,
      accessToken: "hf_xxx",
    });

    const result = await adapter.retrieveArtifactFromRepo(
      createRetrieveArtifactFromRepoRequest({
        provider: "huggingface",
        repository: "openai/private-demo",
        path: "a.bin",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unavailable access-denied failure.");
    }
    expect(result.error.code).toBe("unavailable");
    expect(result.error.message).toContain("invalid/insufficient");
    expect(result.error.code).not.toBe("not-found");
  });

  it("maps non-ok download response statuses (401/403 family) without reporting not-found", async () => {
    const hubClient = createHubClientDouble();
    hubClient.downloadFile = testDouble.fn(async () => new Response(null, {
      status: 401,
      statusText: "Unauthorized",
    }));

    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient,
    });

    const result = await adapter.retrieveArtifactFromRepo(
      createRetrieveArtifactFromRepoRequest({
        provider: "huggingface",
        repository: "openai/private-demo",
        path: "a.bin",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unavailable auth-required failure.");
    }
    expect(result.error.code).toBe("unavailable");
    expect(result.error.message).toContain("access token");
  });

  it("lists namespace datasets through Hugging Face datasets API", async () => {
    const fetchImplementation = testDouble.fn(async () => new Response(JSON.stringify([
      { id: "OpenFinAL/financial-news" },
      { id: "OpenFinAL/other-dataset" },
      { id: "OtherOrg/not-included" },
    ]), { status: 200 })) as unknown as HuggingFaceFetchImplementation;
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient: createHubClientDouble(),
      fetchImplementation,
      accessToken: "hf_token",
    });

    const result = await adapter.listNamespaceDatasets("OpenFinAL");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected namespace dataset browse success.");
    }

    expect(result.value.datasets).toEqual([
      { namespace: "OpenFinAL", repository: "OpenFinAL/financial-news" },
      { namespace: "OpenFinAL", repository: "OpenFinAL/other-dataset" },
    ]);
    expect(fetchImplementation).toHaveBeenCalled();
  });

  it("lists dataset repository files", async () => {
    const fetchImplementation = testDouble.fn(async () => new Response(JSON.stringify([
      { path: "data/train-00000.parquet", type: "file", size: 1234 },
      { path: "data/README.md", type: "file", size: 45 },
      { path: "data/sub/test-00000.parquet", type: "file", size: 321 },
    ]), { status: 200 })) as unknown as HuggingFaceFetchImplementation;
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient: createHubClientDouble(),
      fetchImplementation,
    });

    const result = await adapter.listDatasetParquetFiles({
      repository: "OpenFinAL/financial-news",
      revision: "main",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected dataset file browse success.");
    }

    expect(result.value.files).toEqual([
      {
        repository: "OpenFinAL/financial-news",
        path: "data/train-00000.parquet",
        revision: "main",
        sizeBytes: 1234,
      },
      {
        repository: "OpenFinAL/financial-news",
        path: "data/README.md",
        revision: "main",
        sizeBytes: 45,
      },
      {
        repository: "OpenFinAL/financial-news",
        path: "data/sub/test-00000.parquet",
        revision: "main",
        sizeBytes: 321,
      },
    ]);
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://huggingface.co/api/datasets/OpenFinAL/financial-news/tree/main?recursive=1",
      { headers: {} },
    );
  });

  it("maps non-browser contract error codes to internal for repo-browser responses", async () => {
    const fetchImplementation = testDouble.fn(async () => {
      throw {
        code: "unauthorized",
        message: "Provider rejected token",
      };
    }) as unknown as HuggingFaceFetchImplementation;
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient: createHubClientDouble(),
      fetchImplementation,
    });

    const result = await adapter.listNamespaceDatasets("OpenFinAL");
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected namespace dataset browse failure.");
    }

    expect(result.error.code).toBe("internal");
    expect(result.error.message).toContain("Provider rejected token");
  });
});
