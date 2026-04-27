import { describe, expect, expectTypeOf, it } from "../../../../testing/node-test";

import {
  createHasArtifactInRepoRequest,
  createHasArtifactInRepoSuccessResult,
  createRetrieveArtifactFromRepoRequest,
  createRetrieveArtifactFromRepoSuccessResult,
  createStoreArtifactInRepoRequest,
  createStoreArtifactInRepoSuccessResult,
  type HasArtifactInRepoRequest,
  type HasArtifactInRepoResult,
  type RetrieveArtifactFromRepoRequest,
  type RetrieveArtifactFromRepoResult,
  type StoreArtifactInRepoRequest,
  type StoreArtifactInRepoResult,
} from "../../../../contracts/storage";
import type { ApplicationRequestContext } from "../../application-request-context";

import type { ArtifactRepoStoragePort } from "../artifact-repo-storage.port";

describe("ArtifactRepoStoragePort", () => {
  it("keeps a repo-oriented seam with provider/repository/revision/path targets", () => {
    expectTypeOf<keyof ArtifactRepoStoragePort>().toEqualTypeOf<
      "storeArtifactInRepo" | "retrieveArtifactFromRepo" | "hasArtifactInRepo"
    >();

    expectTypeOf<Parameters<ArtifactRepoStoragePort["storeArtifactInRepo"]>[0]>().toExtend<
      StoreArtifactInRepoRequest
    >();
    expectTypeOf<
      Parameters<ArtifactRepoStoragePort["retrieveArtifactFromRepo"]>[0]
    >().toExtend<RetrieveArtifactFromRepoRequest>();
    expectTypeOf<Parameters<ArtifactRepoStoragePort["hasArtifactInRepo"]>[0]>().toExtend<
      HasArtifactInRepoRequest
    >();

    expectTypeOf<Awaited<ReturnType<ArtifactRepoStoragePort["storeArtifactInRepo"]>>>().toEqualTypeOf<
      StoreArtifactInRepoResult
    >();
    expectTypeOf<
      Awaited<ReturnType<ArtifactRepoStoragePort["retrieveArtifactFromRepo"]>>
    >().toEqualTypeOf<RetrieveArtifactFromRepoResult>();
    expectTypeOf<Awaited<ReturnType<ArtifactRepoStoragePort["hasArtifactInRepo"]>>>().toEqualTypeOf<
      HasArtifactInRepoResult
    >();
  });

  it("uses generic application request context for repo-family calls", async () => {
    const context: ApplicationRequestContext = {
      requestId: "req-repo-1",
      correlationId: "corr-repo-1",
    };

    const storeRequest = createStoreArtifactInRepoRequest(new Uint8Array([1, 2, 3]), {
      target: {
        provider: " huggingface ",
        repository: " openai/demo-artifacts ",
        revision: " main ",
        path: " images/a.png ",
      },
      mediaType: "image/png",
    });

    const retrieveRequest = createRetrieveArtifactFromRepoRequest({
      provider: "huggingface",
      repository: "openai/demo-artifacts",
      revision: "main",
      path: "images/a.png",
    });

    const hasRequest = createHasArtifactInRepoRequest({
      provider: "huggingface",
      repository: "openai/demo-artifacts",
      revision: "main",
      path: "images/a.png",
    });

    const calls: Array<{ method: string; context: ApplicationRequestContext | undefined }> = [];

    const port: ArtifactRepoStoragePort = {
      storeArtifactInRepo: async (request, incomingContext) => {
        calls.push({ method: "store", context: incomingContext });
        return createStoreArtifactInRepoSuccessResult({
          target: request.target,
          mediaType: request.mediaType,
          sizeBytes: request.content.byteLength,
        });
      },
      retrieveArtifactFromRepo: async (request, incomingContext) => {
        calls.push({ method: "retrieve", context: incomingContext });
        return createRetrieveArtifactFromRepoSuccessResult(
          {
            target: request.target,
            mediaType: "image/png",
            sizeBytes: 3,
          },
          new Uint8Array([1, 2, 3]),
        );
      },
      hasArtifactInRepo: async (request, incomingContext) => {
        calls.push({ method: "has", context: incomingContext });
        return createHasArtifactInRepoSuccessResult(true, {
          descriptor: {
            target: request.target,
            mediaType: "image/png",
            sizeBytes: 3,
          },
        });
      },
    };

    const storeResult = await port.storeArtifactInRepo(storeRequest, context);
    const retrieveResult = await port.retrieveArtifactFromRepo(retrieveRequest, context);
    const hasResult = await port.hasArtifactInRepo(hasRequest, context);

    expect(calls).toEqual([
      { method: "store", context },
      { method: "retrieve", context },
      { method: "has", context },
    ]);

    expect(storeResult.ok).toBe(true);
    expect(retrieveResult.ok).toBe(true);
    expect(hasResult.ok).toBe(true);

    expect(storeRequest.target).toEqual({
      provider: "huggingface",
      repository: "openai/demo-artifacts",
      revision: "main",
      path: "images/a.png",
    });

    expect("requestId" in storeRequest).toBe(false);
    expect("correlationId" in storeRequest).toBe(false);
    expect("requestId" in retrieveRequest).toBe(false);
    expect("correlationId" in retrieveRequest).toBe(false);
    expect("requestId" in hasRequest).toBe(false);
    expect("correlationId" in hasRequest).toBe(false);

    expect("key" in storeRequest.target).toBe(false);
  });
});
