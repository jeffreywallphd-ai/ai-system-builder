import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import {
  createHasArtifactInRepoRequest,
  createHasArtifactInRepoSuccessResult,
  createRetrieveArtifactFromRepoRequest,
  createRetrieveArtifactFromRepoSuccessResult,
  createStoreArtifactInRepoRequest,
  createStoreArtifactInRepoSuccessResult,
} from "../../../../contracts/storage";
import type { ArtifactRepoStoragePort } from "../../../../application/ports/storage";
import { createArtifactRepoStorageAdapter } from "../createArtifactRepoStorageAdapter";

describe("createArtifactRepoStorageAdapter", () => {
  it("routes calls to the configured provider adapter", async () => {
    const providerAdapter: ArtifactRepoStoragePort = {
      storeArtifactInRepo: testDouble.fn(async (request) =>
        createStoreArtifactInRepoSuccessResult({
          target: request.target,
          mediaType: request.mediaType,
          sizeBytes: request.content.byteLength,
        })),
      retrieveArtifactFromRepo: testDouble.fn(async (request) =>
        createRetrieveArtifactFromRepoSuccessResult({
          target: request.target,
          mediaType: "text/plain",
          sizeBytes: 1,
        }, new Uint8Array([1]))),
      hasArtifactInRepo: testDouble.fn(async (request) =>
        createHasArtifactInRepoSuccessResult(true, {
          descriptor: {
            target: request.target,
            mediaType: "text/plain",
            sizeBytes: 1,
          },
        })),
    };

    const adapter = createArtifactRepoStorageAdapter({
      providers: [{ provider: "huggingface", adapter: providerAdapter }],
    });

    const context = { requestId: "req-repo-router", correlationId: "corr-repo-router" };

    const storeResult = await adapter.storeArtifactInRepo(
      createStoreArtifactInRepoRequest(new Uint8Array([1]), {
        target: {
          provider: "huggingface",
          repository: "openai/demo-artifacts",
          path: "a.txt",
        },
      }),
      context,
    );

    const retrieveResult = await adapter.retrieveArtifactFromRepo(
      createRetrieveArtifactFromRepoRequest({
        provider: "huggingface",
        repository: "openai/demo-artifacts",
        path: "a.txt",
      }),
      context,
    );

    const hasResult = await adapter.hasArtifactInRepo(
      createHasArtifactInRepoRequest({
        provider: "huggingface",
        repository: "openai/demo-artifacts",
        path: "a.txt",
      }),
      context,
    );

    expect(storeResult.ok).toBe(true);
    expect(retrieveResult.ok).toBe(true);
    expect(hasResult.ok).toBe(true);
  });

  it("fails with unavailable when provider is not configured", async () => {
    const adapter = createArtifactRepoStorageAdapter({ providers: [] });

    const result = await adapter.hasArtifactInRepo(
      createHasArtifactInRepoRequest({
        provider: "huggingface",
        repository: "openai/demo-artifacts",
        path: "missing.txt",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unavailable provider failure.");
    }

    expect(result.error.code).toBe("unavailable");
  });
});
