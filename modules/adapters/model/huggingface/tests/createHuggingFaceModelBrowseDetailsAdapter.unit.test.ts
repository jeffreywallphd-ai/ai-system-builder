import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import {
  createHuggingFaceModelBrowseDetailsAdapter,
  type CreateHuggingFaceModelBrowseDetailsAdapterOptions,
} from "../createHuggingFaceModelBrowseDetailsAdapter";

function createHubClientDouble(overrides: Partial<NonNullable<CreateHuggingFaceModelBrowseDetailsAdapterOptions["hubClient"]>> = {}) {
  return {
    listModels: testDouble.fn(async function* () {
      yield {
        id: "69e864fd6b68f7e6cfc63ca3",
        name: "openai/demo-model",
        author: "openai",
        task: "text-generation",
        tags: ["text-generation", "chat"],
        downloads: 123,
        likes: 45,
        private: false,
        gated: false,
        lastModified: "2026-04-20T00:00:00.000Z",
        cardData: { license: "apache-2.0", summary: "A demo model" },
      };
    }),
    modelInfo: testDouble.fn(async () => ({
      id: "69e864fd6b68f7e6cfc63ca3",
      name: "openai/demo-model",
      author: "openai",
      task: "text-generation",
      tags: ["text-generation", "chat"],
      cardData: { content: "# Demo model", license: "apache-2.0" },
      license: "apache-2.0",
      description: "Demo",
      siblings: [
        { rfilename: "model.safetensors", size: 1024, blobId: "blob-1", lfs: { sha256: "abc" } },
        { rfilename: "tokenizer.json", size: 512 },
        { rfilename: "adapter_config.json", size: 12 },
      ],
      config: { architectures: ["DemoModel"] },
      sha: "sha123",
    })),
    ...overrides,
  };
}

describe("createHuggingFaceModelBrowseDetailsAdapter", () => {
  it("maps browse response to model browse contracts", async () => {
    const hubClient = createHubClientDouble();
    const adapter = createHuggingFaceModelBrowseDetailsAdapter({ hubClient });

    const result = await adapter.browseModels({ provider: "huggingface", query: "demo", limit: 25 });

    expect(result.models.length).toBe(1);
    expect(result.models[0]).toMatchObject({
      provider: "huggingface",
      modelId: "openai/demo-model",
      displayName: "demo-model",
      authorOrOrg: "openai",
      taskTags: ["text-generation", "chat"],
      downloads: 123,
      likes: 45,
      license: "apache-2.0",
      inferenceMode: "causal",
    });
  });

  it("passes current Hugging Face search and expansion parameters for every browse request", async () => {
    const hubClient = createHubClientDouble();
    const adapter = createHuggingFaceModelBrowseDetailsAdapter({ hubClient });

    await adapter.browseModels({ provider: "huggingface", query: "qwen", taskTags: ["text-generation"], authorOrOrg: "Qwen", limit: 25 });
    await adapter.browseModels({ provider: "huggingface", query: "mistral", taskTags: ["chat"], limit: 10 });

    expect(hubClient.listModels.mock.calls.length).toBe(2);
    expect(hubClient.listModels.mock.calls[0]?.[0]).toMatchObject({
      search: { query: "qwen", owner: "Qwen", task: "text-generation" },
      limit: 25,
    });
    expect(hubClient.listModels.mock.calls[1]?.[0]).toMatchObject({
      search: { query: "mistral", task: "chat" },
      limit: 10,
    });
    const firstAdditionalFields = hubClient.listModels.mock.calls[0]?.[0]?.additionalFields;
    expect(firstAdditionalFields).toContain("author");
    expect(firstAdditionalFields).toContain("cardData");
    expect(firstAdditionalFields).toContain("tags");
  });

  it("passes a custom task tag without widening persisted model task tags", async () => {
    const hubClient = createHubClientDouble();
    const adapter = createHuggingFaceModelBrowseDetailsAdapter({ hubClient });

    await adapter.browseModels({
      provider: "huggingface",
      customTaskTag: "image-classification",
      limit: 10,
    });

    expect(hubClient.listModels.mock.calls[0]?.[0]).toMatchObject({
      search: { task: "image-classification" },
      limit: 10,
    });
  });

  it("uses and returns only the bounded Hugging Face cursor value", async () => {
    const previousFetch = globalThis.fetch;
    const fetchDouble = testDouble.fn(async (input: URL | RequestInfo) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      expect(url.searchParams.get("cursor")).toBe("page-2");
      return new Response("[]", {
        status: 200,
        headers: {
          Link: '<https://huggingface.co/api/models?cursor=page-3>; rel="next"',
        },
      });
    });
    globalThis.fetch = fetchDouble as typeof fetch;
    try {
      const hubClient = createHubClientDouble({
        listModels: testDouble.fn(async function* (params) {
          await params.fetch?.("https://huggingface.co/api/models?limit=10");
          yield {
            name: "openai/demo-model",
            downloads: 1,
            likes: 1,
            private: false,
            gated: false,
          };
        }),
      });
      const adapter = createHuggingFaceModelBrowseDetailsAdapter({ hubClient });

      const result = await adapter.browseModels({
        provider: "huggingface",
        cursor: "page-2",
        limit: 10,
      });

      expect(result.nextCursor).toBe("page-3");
      expect(JSON.stringify(result)).not.toContain("https://huggingface.co");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("prefers human-readable repository ids over opaque provider ids", async () => {
    const hubClient = createHubClientDouble({
      listModels: testDouble.fn(async function* () {
        yield {
          id: "69e864fd6b68f7e6cfc63ca3",
          modelId: "sentence-transformers/all-MiniLM-L6-v2",
          name: "sentence-transformers/all-MiniLM-L6-v2",
          downloads: 137784,
          likes: 3003,
        };
      }),
    });
    const adapter = createHuggingFaceModelBrowseDetailsAdapter({ hubClient });

    const result = await adapter.browseModels({ provider: "huggingface", limit: 25 });

    expect(result.models[0]?.modelId).toBe("sentence-transformers/all-MiniLM-L6-v2");
    expect(result.models[0]?.displayName).toBe("all-MiniLM-L6-v2");
    expect(result.models[0]?.authorOrOrg).toBe("sentence-transformers");
  });

  it("maps model details and infers file availability flags", async () => {
    const hubClient = createHubClientDouble();
    const adapter = createHuggingFaceModelBrowseDetailsAdapter({ hubClient });

    const result = await adapter.getModelDetails({ provider: "huggingface", modelId: "openai/demo-model" });

    expect(result.model.files).toEqual([
      { path: "model.safetensors", sizeBytes: 1024, blobId: "blob-1", lfs: true },
      { path: "tokenizer.json", sizeBytes: 512, blobId: undefined, lfs: false },
      { path: "adapter_config.json", sizeBytes: 12, blobId: undefined, lfs: false },
    ]);
    expect(result.model.safetensorsAvailable).toBe(true);
    expect(result.model.tokenizerAvailable).toBe(true);
    expect(result.model.adapterAvailable).toBe(true);
    expect(result.model.recommendedInferenceMode).toBe("causal");
  });

  it("handles missing optional metadata gracefully", async () => {
    const hubClient = createHubClientDouble({
      modelInfo: testDouble.fn(async () => ({
        id: "openai/minimal",
        siblings: [],
      })),
    });
    const adapter = createHuggingFaceModelBrowseDetailsAdapter({ hubClient });

    const result = await adapter.getModelDetails({ provider: "huggingface", modelId: "openai/minimal" });

    expect(result.model.modelId).toBe("openai/minimal");
    expect(result.model.tags).toBeUndefined();
    expect(result.model.tokenizerAvailable).toBeUndefined();
    expect(result.model.safetensorsAvailable).toBeUndefined();
  });

  it("passes access token when configured", async () => {
    const hubClient = createHubClientDouble();
    const adapter = createHuggingFaceModelBrowseDetailsAdapter({
      hubClient,
      accessTokenProvider: () => "token-xyz",
    });

    await adapter.browseModels({ provider: "huggingface", query: "demo", limit: 25 });

    const listModelsCall = hubClient.listModels.mock.calls[0]?.[0] as { accessToken?: string };
    expect(listModelsCall.accessToken).toBe("token-xyz");
  });

  it("maps not found and unauthorized errors to clear messages", async () => {
    const notFoundAdapter = createHuggingFaceModelBrowseDetailsAdapter({
      hubClient: createHubClientDouble({
        modelInfo: testDouble.fn(async () => {
          throw { statusCode: 404 };
        }),
      }),
    });

    await expect(notFoundAdapter.getModelDetails({ provider: "huggingface", modelId: "missing/model" }))
      .rejects
      .toThrow("model was not found");

    const unauthorizedAdapter = createHuggingFaceModelBrowseDetailsAdapter({
      hubClient: createHubClientDouble({
        listModels: testDouble.fn(async () => {
          throw { statusCode: 401 };
        }),
      }),
    });

    await expect(unauthorizedAdapter.browseModels({ provider: "huggingface", query: "demo", limit: 25 }))
      .rejects
      .toThrow("unauthorized or access denied");
  });

  it("maps provider fetch failures to unavailable and logs redacted cause diagnostics", async () => {
    const logger = { info: testDouble.fn(), warn: testDouble.fn() };
    const fetchCause = Object.assign(new Error("connect timed out"), { code: "ETIMEDOUT" });
    const fetchFailure = new TypeError("fetch failed");
    (fetchFailure as Error & { cause?: unknown }).cause = fetchCause;
    testDouble.spyOn(globalThis, "fetch").mockRejectedValue(fetchFailure);

    const hubClient = createHubClientDouble({
      listModels: testDouble.fn(async function* (params: { fetch?: typeof fetch }) {
        if (!params.fetch) {
          throw new Error("Expected diagnostic fetch to be provided.");
        }
        await params.fetch("https://huggingface.co/api/models?search=stable%20diffusion");
      }),
    });
    const adapter = createHuggingFaceModelBrowseDetailsAdapter({ hubClient, logger });

    try {
      await adapter.browseModels({ provider: "huggingface", query: "stable diffusion", limit: 25 });
      throw new Error("Expected browseModels to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "unavailable",
        details: {
          provider: "huggingface",
          operation: "browseModels",
          errorMessage: "fetch failed",
          causeCode: "ETIMEDOUT",
        },
      });
      expect(error instanceof Error ? error.message : String(error)).toContain("provider request could not be completed");
    }

    expect(logger.warn.mock.calls.some((call: unknown[]) =>
      call[0] === "hf.adapter.fetch.failure" &&
      (call[1] as Record<string, unknown>)?.operation === "browseModels" &&
      (call[1] as Record<string, unknown>)?.causeCode === "ETIMEDOUT"
    )).toBe(true);
    expect(logger.warn.mock.calls.some((call: unknown[]) =>
      call[0] === "hf.adapter.browse.failure" &&
      (call[1] as Record<string, unknown>)?.code === "unavailable"
    )).toBe(true);
  });

  it("preserves not-found provider status as a route-mappable error code", async () => {
    const adapter = createHuggingFaceModelBrowseDetailsAdapter({
      hubClient: createHubClientDouble({
        modelInfo: testDouble.fn(async () => {
          throw { statusCode: 404, message: "Not found" };
        }),
      }),
    });

    try {
      await adapter.getModelDetails({ provider: "huggingface", modelId: "missing/model" });
      throw new Error("Expected getModelDetails to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        code: "not-found",
        details: {
          provider: "huggingface",
          operation: "getModelDetails",
          status: 404,
        },
      });
    }
  });
});


it("maps text-to-image task tags to text-to-image inference mode", async () => {
  const hubClient = createHubClientDouble({
    listModels: testDouble.fn(async function* () {
      yield { id: "stabilityai/stable-diffusion-2-1", name: "stabilityai/stable-diffusion-2-1", task: "text-to-image", tags: ["text-to-image"] };
    }),
  });
  const adapter = createHuggingFaceModelBrowseDetailsAdapter({ hubClient });
  const result = await adapter.browseModels({ provider: "huggingface", query: "stable diffusion", limit: 25 });
  expect(result.models[0]?.inferenceMode).toBe("text-to-image");
  expect(result.models[0]?.taskTags).toEqual(["text-to-image"]);
});
