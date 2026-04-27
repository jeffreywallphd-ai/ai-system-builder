import { describe, expect, it, testDouble } from "../../../testing/node-test";

import {
  createHasArtifactInRepoFailureResult,
  createHasArtifactInRepoSuccessResult,
  createRetrieveArtifactFromRepoSuccessResult,
  createStoreArtifactInRepoSuccessResult,
} from "../../../contracts/storage";
import type { ArtifactRepoStoragePort } from "../../ports/storage";
import {
  HasArtifactInRepoUseCase,
  RetrieveArtifactFromRepoUseCase,
  StoreArtifactInRepoUseCase,
} from "../index";

describe("artifact-repo storage use cases", () => {
  const target = {
    provider: "huggingface" as const,
    repository: "openai/demo",
    revision: "main",
    path: "artifacts/a.bin",
  };

  it("delegates has/store/retrieve through focused artifact-repo storage port seam", async () => {
    const storage: ArtifactRepoStoragePort = {
      hasArtifactInRepo: testDouble.fn(async () => createHasArtifactInRepoSuccessResult(true)),
      storeArtifactInRepo: testDouble.fn(async () => createStoreArtifactInRepoSuccessResult({ target, sizeBytes: 3 })),
      retrieveArtifactFromRepo: testDouble.fn(async () => createRetrieveArtifactFromRepoSuccessResult({ target, sizeBytes: 3 }, new Uint8Array([1, 2, 3]))),
    };

    const hasUseCase = new HasArtifactInRepoUseCase({ artifactRepoStorage: storage });
    const storeUseCase = new StoreArtifactInRepoUseCase({ artifactRepoStorage: storage });
    const retrieveUseCase = new RetrieveArtifactFromRepoUseCase({ artifactRepoStorage: storage });

    const context = { requestId: "req-repo-uc", correlationId: "corr-repo-uc" };

    const hasResult = await hasUseCase.execute({ target }, context);
    const storeResult = await storeUseCase.execute({ target, content: new Uint8Array([1, 2, 3]) }, context);
    const retrieveResult = await retrieveUseCase.execute({ target }, context);

    expect(hasResult.ok).toBe(true);
    expect(storeResult.ok).toBe(true);
    expect(retrieveResult.ok).toBe(true);
    expect(storage.hasArtifactInRepo).toHaveBeenCalledWith({ target }, context);
    expect(storage.storeArtifactInRepo).toHaveBeenCalled();
    expect(storage.retrieveArtifactFromRepo).toHaveBeenCalledWith({ target }, context);
  });

  it("returns validation failure when store command content is empty", async () => {
    const storage: ArtifactRepoStoragePort = {
      hasArtifactInRepo: testDouble.fn(async () => createHasArtifactInRepoFailureResult({ code: "internal", message: "unused" })),
      storeArtifactInRepo: testDouble.fn(),
      retrieveArtifactFromRepo: testDouble.fn(),
    } as unknown as ArtifactRepoStoragePort;

    const useCase = new StoreArtifactInRepoUseCase({ artifactRepoStorage: storage });
    const result = await useCase.execute({
      target,
      content: new Uint8Array([]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected validation failure.");
    }

    expect(result.error.code).toBe("validation");
    expect(storage.storeArtifactInRepo).not.toHaveBeenCalled();
  });
});
