import { describe, expect, expectTypeOf, it } from "../../../../testing/node-test";
import { createSuccessResult, type ContractResult } from "../../../../contracts/shared";
import type { ApplicationRequestContext } from "../../application-request-context";

import type {
  ArtifactContentRetrievalPort,
  ArtifactContentRetrievalValue,
  RetrieveArtifactViewerMediaByStorageKeyRequest,
} from "..";

describe("artifact content retrieval application port", () => {
  it("keeps viewer/media retrieval distinct from artifact-browser descriptor seams", async () => {
    expectTypeOf<keyof ArtifactContentRetrievalPort>().toEqualTypeOf<
      "retrieveArtifactViewerMediaByStorageKey"
    >();
    expectTypeOf<Parameters<ArtifactContentRetrievalPort["retrieveArtifactViewerMediaByStorageKey"]>[0]>()
      .toExtend<RetrieveArtifactViewerMediaByStorageKeyRequest>();
    expectTypeOf<Parameters<ArtifactContentRetrievalPort["retrieveArtifactViewerMediaByStorageKey"]>[1]>()
      .toExtend<ApplicationRequestContext | undefined>();
    expectTypeOf<Awaited<ReturnType<ArtifactContentRetrievalPort["retrieveArtifactViewerMediaByStorageKey"]>>>()
      .toEqualTypeOf<ContractResult<ArtifactContentRetrievalValue>>();

    const port: ArtifactContentRetrievalPort = {
      retrieveArtifactViewerMediaByStorageKey: async (request) =>
        createSuccessResult({
          storageKey: request.storageKey,
          mediaType: "image/png",
          sizeBytes: 3,
          bytes: new Uint8Array([1, 2, 3]),
        }),
    };

    const result = await port.retrieveArtifactViewerMediaByStorageKey({
      storageKey: "uploads/a.png",
    });

    expect(result.ok).toBe(true);
    expect("locator" in { storageKey: "uploads/a.png" }).toBe(false);
  });
});
