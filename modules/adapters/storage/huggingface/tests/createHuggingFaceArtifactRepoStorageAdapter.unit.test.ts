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
import { SecureEgressBroker } from "../../../security/egress";

function createHubClientDouble() {
  return {
    fileExists: testDouble.fn(async () => true),
    uploadFile: testDouble.fn(async () => undefined),
    commit: testDouble.fn(async () => ({
      commit: { oid: "a".repeat(40), url: "https://huggingface.co/datasets/example/repo/commit/fixture" },
    })),
    downloadFile: testDouble.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        "content-type": "image/png",
      },
    })),
  };
}

function createEgressBrokerDouble(
  implementation: (url: string, options?: { headers?: Readonly<Record<string, string>> }) => Promise<{
    url: string;
    status: number;
    headers: Readonly<Record<string, string>>;
    bytes: Uint8Array;
  }> = async (url) => ({
    url,
    status: 200,
    headers: { "content-type": "image/png" },
    bytes: new Uint8Array([1, 2, 3]),
  }),
) {
  const fetch = testDouble.fn(implementation);
  const createSession = testDouble.fn(() => ({ fetch }));
  return { broker: { createSession } as never, createSession, fetch };
}

describe("createHuggingFaceArtifactRepoStorageAdapter", () => {
  it("publishes a dataset version as one bounded multi-file commit and returns its immutable revision", async () => {
    const hubClient = createHubClientDouble();
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient,
      accessToken: "hf_test",
    });
    const result = await adapter.publishDatasetVersion({
      provider: "hugging-face",
      repositoryId: "example/support-data",
      branch: "main",
      visibility: "private",
      repositoryCreationApproved: false,
      versionDigest: `sha256:${"b".repeat(64)}`,
      files: [
        { path: "README.md", content: new TextEncoder().encode("# Dataset"), mediaType: "text/markdown", digest: `sha256:${"c".repeat(64)}` },
        { path: "data/dataset.jsonl", content: new TextEncoder().encode("{}\n"), mediaType: "application/jsonl", digest: `sha256:${"d".repeat(64)}` },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        provider: "hugging-face",
        repositoryId: "example/support-data",
        revision: "a".repeat(40),
      },
    });
    expect(hubClient.commit).toHaveBeenCalledTimes(1);
    const request = hubClient.commit.mock.calls[0]?.[0] as any;
    expect(request.repo).toEqual({ type: "dataset", name: "example/support-data" });
    expect(request.branch).toBe("main");
    expect(request.operations.map((operation: any) => operation.path)).toEqual([
      "README.md",
      "data/dataset.jsonl",
    ]);
  });

  it("requires explicit creation approval and applies public visibility when a dataset repository is missing", async () => {
    const hubClient = createHubClientDouble();
    let attempts = 0;
    hubClient.commit = testDouble.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw { statusCode: 404, message: "missing" };
      return { commit: { oid: "e".repeat(40), url: "https://huggingface.co/commit/fixture" } };
    });
    const fetchImplementation = testDouble.fn(async () => new Response(null, { status: 200 })) as unknown as HuggingFaceFetchImplementation;
    const authorizeRepositoryCreate = testDouble.fn(async () => true);
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({ hubClient, accessToken: "hf_test", fetchImplementation, authorizeRepositoryCreate });
    const result = await adapter.publishDatasetVersion({
      provider: "hugging-face", repositoryId: "example/new-data", branch: "main", visibility: "public",
      repositoryCreationApproved: true, versionDigest: `sha256:${"f".repeat(64)}`,
      files: [{ path: "README.md", content: new Uint8Array([1]), mediaType: "text/markdown", digest: `sha256:${"1".repeat(64)}` }],
    });
    expect(result.ok).toBe(true);
    expect(authorizeRepositoryCreate).toHaveBeenCalledWith({ provider: "huggingface", repository: "example/new-data", visibility: "public" });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://huggingface.co/api/repos/create",
      expect.objectContaining({ body: JSON.stringify({ name: "new-data", organization: "example", type: "dataset", private: false }) }),
    );
    expect(hubClient.commit).toHaveBeenCalledTimes(2);
  });
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

  it("uses official hub-client methods for has/store and the bounded broker for retrieve", async () => {
    const hubClient = createHubClientDouble();
    const egress = createEgressBrokerDouble();
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient,
      accessToken: "token-123",
      egressBroker: egress.broker,
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
    const uploadCall = (hubClient.uploadFile.mock.calls as unknown as Array<[{
      repo: { type: string; name: string };
      branch: string;
      accessToken: string;
      file: { content: Blob | Uint8Array };
    }]>)[0]?.[0]!;
    expect(uploadCall.repo).toEqual({ type: "dataset", name: "openai/demo" });
    expect(uploadCall.branch).toBe("main");
    expect(uploadCall.accessToken).toBe("token-123");
    if (typeof Blob !== "undefined") {
      expect(uploadCall.file.content instanceof Blob).toBe(true);
    } else {
      expect(uploadCall.file.content instanceof Uint8Array).toBe(true);
    }
    expect(hubClient.downloadFile).not.toHaveBeenCalled();
    expect(egress.fetch).toHaveBeenCalledWith(
      "https://huggingface.co/datasets/openai/demo/resolve/main/artifacts/a.bin",
      { headers: { authorization: "Bearer token-123" } },
    );
    expect(egress.createSession).toHaveBeenCalledWith({
      allowedMediaTypes: expect.any(Array),
      maximumResponseBytes: 512 * 1024 * 1024,
      maximumTotalBytes: 512 * 1024 * 1024,
      timeoutMs: 60_000,
    });
  });

  it("rejects a streamed provider download that exceeds the localization byte limit", async () => {
    const broker = new SecureEgressBroker({
      resolveDns: async () => [{ address: "8.8.8.8", family: 4 }],
      requestImplementation: async () => ({
        status: 200,
        headers: { "content-type": "application/octet-stream" },
        body: (async function* () {
          yield new Uint8Array(3);
          yield new Uint8Array(3);
        })(),
      }),
    });
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient: createHubClientDouble(),
      egressBroker: broker,
      maximumDownloadBytes: 5,
    });

    const result = await adapter.retrieveArtifactFromRepo(
      createRetrieveArtifactFromRepoRequest({
        provider: "huggingface",
        repository: "openai/demo",
        path: "oversized.bin",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected bounded localization failure.");
    expect(result.error.message).toContain("byte limit");
  });

  it("rejects a provider download with a disallowed content type", async () => {
    const broker = new SecureEgressBroker({
      resolveDns: async () => [{ address: "8.8.8.8", family: 4 }],
      requestImplementation: async () => ({
        status: 200,
        headers: { "content-type": "application/x-msdownload" },
        body: (async function* () { yield new Uint8Array([1]); })(),
      }),
    });
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient: createHubClientDouble(),
      egressBroker: broker,
    });

    const result = await adapter.retrieveArtifactFromRepo(
      createRetrieveArtifactFromRepoRequest({
        provider: "huggingface",
        repository: "openai/demo",
        path: "unsafe.exe",
      }),
    );

    expect(result.ok).toBe(false);
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
    const egress = createEgressBrokerDouble(async (url) => {
      callCount += 1;
      return {
        url,
        status: callCount === 1 ? 404 : 503,
        headers: { "content-type": "application/octet-stream" },
        bytes: new Uint8Array(),
      };
    });

    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient,
      accessToken: "token",
      egressBroker: egress.broker,
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

  it("does not create a missing repository without explicit approval", async () => {
    const hubClient = createHubClientDouble();
    hubClient.uploadFile = testDouble.fn(async () => {
      throw { statusCode: 404, message: "Repository not found" };
    });
    const fetchImplementation = testDouble.fn(async () => new Response(null, { status: 200 })) as unknown as HuggingFaceFetchImplementation;
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient,
      fetchImplementation,
      accessToken: "hf_test",
    });

    const result = await adapter.storeArtifactInRepo(
      createStoreArtifactInRepoRequest(new Uint8Array([1]), {
        target: {
          provider: "huggingface",
          repository: "OpenFinAL/missing",
          path: "dataset/train.parquet",
        },
      }),
    );

    expect(result.ok).toBe(false);
    expect(fetchImplementation).toHaveBeenCalledTimes(0);
  });

  it("does not create a missing repository when managed authorization denies it", async () => {
    const hubClient = createHubClientDouble();
    hubClient.uploadFile = testDouble.fn(async () => {
      throw { statusCode: 404, message: "Repository not found" };
    });
    const fetchImplementation = testDouble.fn(async () => new Response(null, { status: 200 })) as unknown as HuggingFaceFetchImplementation;
    const authorizeRepositoryCreate = testDouble.fn(async () => false);
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient,
      fetchImplementation,
      accessToken: "hf_test",
      authorizeRepositoryCreate,
    });

    const result = await adapter.storeArtifactInRepo(
      createStoreArtifactInRepoRequest(new Uint8Array([1]), {
        target: {
          provider: "huggingface",
          repository: "OpenFinAL/denied",
          path: "dataset/train.parquet",
        },
        repositoryCreation: { approved: true, visibility: "private" },
      }),
    );

    expect(result.ok).toBe(false);
    expect(authorizeRepositoryCreate).toHaveBeenCalledWith({
      provider: "huggingface",
      repository: "OpenFinAL/denied",
      visibility: "private",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(0);
  });

  it("creates a private dataset repository and retries upload after explicit approval", async () => {
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
        repositoryCreation: { approved: true, visibility: "private" },
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
          private: true,
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
        repositoryCreation: { approved: true, visibility: "public" },
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
    const egress = createEgressBrokerDouble(async (url) => ({
      url,
      status: 403,
      headers: { "content-type": "application/octet-stream" },
      bytes: new Uint8Array(),
    }));

    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient,
      accessToken: "hf_xxx",
      egressBroker: egress.broker,
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
    const egress = createEgressBrokerDouble(async (url) => ({
      url,
      status: 401,
      headers: { "content-type": "application/octet-stream" },
      bytes: new Uint8Array(),
    }));

    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient,
      egressBroker: egress.broker,
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

  it("lists only bounded logical dataset parquet files", async () => {
    const fetchImplementation = testDouble.fn(async () => new Response(JSON.stringify({
      default: {
        train: ["https://huggingface.co/api/datasets/OpenFinAL/financial-news/parquet/default/train/0.parquet"],
        test: ["https://huggingface.co/api/datasets/OpenFinAL/financial-news/parquet/default/test/0.parquet"],
      },
    }), { status: 200 })) as unknown as HuggingFaceFetchImplementation;
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
        path: "default/train/0.parquet",
        revision: "refs/convert/parquet",
      },
      {
        repository: "OpenFinAL/financial-news",
        path: "default/test/0.parquet",
        revision: "refs/convert/parquet",
      },
    ]);
    expect(result.value.revision).toBe("refs/convert/parquet");
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://huggingface.co/api/datasets/OpenFinAL/financial-news/parquet",
      { headers: {} },
    );
  });

  it("retrieves a listed converted parquet file through its logical API URL", async () => {
    const egress = createEgressBrokerDouble();
    const adapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient: createHubClientDouble(),
      egressBroker: egress.broker,
    });

    const result = await adapter.retrieveArtifactFromRepo(
      createRetrieveArtifactFromRepoRequest({
        provider: "huggingface",
        repository: "OpenFinAL/financial-news",
        path: "default/train/0.parquet",
        revision: "refs/convert/parquet",
      }),
    );

    expect(result.ok).toBe(true);
    expect(egress.fetch.mock.calls[0]?.[0]).toBe(
      "https://huggingface.co/api/datasets/OpenFinAL/financial-news/parquet/default/train/0.parquet",
    );
  });

  it("rejects external logical file URLs and oversized parquet listings", async () => {
    const externalFetch = testDouble.fn(async () => new Response(JSON.stringify({
      default: { train: ["https://attacker.example/private.parquet"] },
    }), { status: 200 })) as unknown as HuggingFaceFetchImplementation;
    const externalAdapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient: createHubClientDouble(),
      fetchImplementation: externalFetch,
    });
    const external = await externalAdapter.listDatasetParquetFiles({
      repository: "OpenFinAL/financial-news",
    });
    expect(external.ok).toBe(false);
    if (external.ok) throw new Error("Expected external URL rejection.");
    expect(external.error.code).toBe("validation");

    const oversizedFetch = testDouble.fn(async () => new Response(JSON.stringify({
      default: {
        train: [
          "https://huggingface.co/api/datasets/OpenFinAL/financial-news/parquet/default/train/0.parquet",
          "https://huggingface.co/api/datasets/OpenFinAL/financial-news/parquet/default/train/1.parquet",
        ],
      },
    }), { status: 200 })) as unknown as HuggingFaceFetchImplementation;
    const oversizedAdapter = createHuggingFaceArtifactRepoStorageAdapter({
      hubClient: createHubClientDouble(),
      fetchImplementation: oversizedFetch,
      maximumDatasetParquetFiles: 1,
    });
    const oversized = await oversizedAdapter.listDatasetParquetFiles({
      repository: "OpenFinAL/financial-news",
    });
    expect(oversized.ok).toBe(false);
    if (oversized.ok) throw new Error("Expected bounded listing rejection.");
    expect(oversized.error.code).toBe("validation");
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
