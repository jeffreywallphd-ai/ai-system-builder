import { describe, expect, it, testDouble } from "../../../testing/node-test";

import { createHasArtifactInRepoSuccessResult } from "../../../contracts/storage";
import type { ArtifactRepoStoragePort, ArtifactStorageBindingPort } from "../../ports/storage";
import { VerifyImportedArtifactSourceBackingUseCase } from "../verify-imported-artifact-source-backing.use-case";

describe("VerifyImportedArtifactSourceBackingUseCase", () => {
  it("re-checks remote imported source and updates verification metadata", async () => {
    const artifactRepoStorage: ArtifactRepoStoragePort = {
      hasArtifactInRepo: testDouble.fn(async () => createHasArtifactInRepoSuccessResult(true)),
      storeArtifactInRepo: testDouble.fn(),
      retrieveArtifactFromRepo: testDouble.fn(),
    } as unknown as ArtifactRepoStoragePort;

    const artifactBindingStorage: ArtifactStorageBindingPort = {
      readArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true,
        value: {
          bindings: [
            {
              artifactId: "artifacts/20260418000000-local01",
              role: "imported-source",
              createdAt: "2026-04-17T00:00:00.000Z",
              backing: {
                kind: "artifact-repo",
                provider: "huggingface",
                locator: "openai/demo/images/a.png",
                target: {
                  provider: "huggingface",
                  repository: "openai/demo",
                  path: "images/a.png",
                  revision: "main",
                },
              },
            },
          ],
        },
      })),
      upsertArtifactStorageBinding: testDouble.fn(async (request) => ({
        ok: true,
        value: { binding: request.binding },
      })),
    } as unknown as ArtifactStorageBindingPort;

    const useCase = new VerifyImportedArtifactSourceBackingUseCase({
      artifactRepoStorage,
      artifactBindingStorage,
      now: () => "2026-04-18T00:00:00.000Z",
    });

    const result = await useCase.execute({ artifactId: "artifacts/20260418000000-local01" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected source verify success.");
    }
    expect(result.value.verification).toEqual({
      exists: true,
      verifiedAt: "2026-04-18T00:00:00.000Z",
    });
    expect(artifactBindingStorage.upsertArtifactStorageBinding).toHaveBeenCalled();
  });

  it("supports legacy imported-source rows that only have locator-encoded targets", async () => {
    const artifactRepoStorage: ArtifactRepoStoragePort = {
      hasArtifactInRepo: testDouble.fn(async () => createHasArtifactInRepoSuccessResult(false)),
      storeArtifactInRepo: testDouble.fn(),
      retrieveArtifactFromRepo: testDouble.fn(),
    } as unknown as ArtifactRepoStoragePort;

    const artifactBindingStorage: ArtifactStorageBindingPort = {
      readArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true,
        value: {
          bindings: [
            {
              artifactId: "imports/huggingface/openai/demo/main/images/a.png",
              role: "imported-source",
              createdAt: "2026-04-16T00:00:00.000Z",
              backing: {
                kind: "artifact-repo",
                provider: "huggingface",
                locator: "openai/demo/images/a.png",
                revision: "main",
              },
            },
          ],
        },
      })),
      upsertArtifactStorageBinding: testDouble.fn(async (request) => ({
        ok: true,
        value: { binding: request.binding },
      })),
    } as unknown as ArtifactStorageBindingPort;

    const useCase = new VerifyImportedArtifactSourceBackingUseCase({
      artifactRepoStorage,
      artifactBindingStorage,
      now: () => "2026-04-18T00:00:00.000Z",
    });

    const result = await useCase.execute({ artifactId: "imports/huggingface/openai/demo/main/images/a.png" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected source verify success.");
    }
    expect(result.value.target.repository).toBe("openai/demo");
    expect(result.value.target.path).toBe("images/a.png");
    const upsertCall = (artifactBindingStorage.upsertArtifactStorageBinding as ReturnType<typeof testDouble.fn>)
      .mock.calls[0]?.[0];
    expect(upsertCall).toMatchObject({
      binding: {
        backing: {
          target: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "images/a.png",
            revision: "main",
          },
        },
      },
    });
  });
});
