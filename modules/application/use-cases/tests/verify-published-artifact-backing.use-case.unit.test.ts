import { describe, expect, it, testDouble } from "../../../testing/node-test";

import { createHasArtifactInRepoSuccessResult } from "../../../contracts/storage";
import { createContractError } from "../../../contracts/shared";
import type {
  ArtifactRepoStoragePort,
  ArtifactStorageBindingPort,
} from "../../ports/storage";
import { VerifyPublishedArtifactBackingUseCase } from "../verify-published-artifact-backing.use-case";

describe("VerifyPublishedArtifactBackingUseCase", () => {
  it("re-checks remote existence and updates published binding verification metadata", async () => {
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
              artifactId: "uploads/a.png",
              role: "published",
              createdAt: "2026-04-16T00:00:00.000Z",
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

    const useCase = new VerifyPublishedArtifactBackingUseCase({
      artifactRepoStorage,
      artifactBindingStorage,
      now: () => "2026-04-17T00:00:00.000Z",
    });

    const result = await useCase.execute({ artifactId: "uploads/a.png" });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected verify success.");
    }

    expect(result.value).toEqual({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/a.png",
        revision: "main",
        locator: "openai/demo/images/a.png",
      },
      verification: {
        exists: false,
        verifiedAt: "2026-04-17T00:00:00.000Z",
      },
    });
    expect(artifactBindingStorage.upsertArtifactStorageBinding).toHaveBeenCalled();
  });

  it("supports legacy published rows that only have locator-encoded repo targets", async () => {
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
              artifactId: "imports/huggingface/openai/demo/main/images/a.png",
              role: "published",
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

    const useCase = new VerifyPublishedArtifactBackingUseCase({
      artifactRepoStorage,
      artifactBindingStorage,
      now: () => "2026-04-17T00:00:00.000Z",
    });

    const result = await useCase.execute({ artifactId: "imports/huggingface/openai/demo/main/images/a.png" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected verify success.");
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

  it("returns explicit verify auth guidance when repository access is unavailable", async () => {
    const artifactRepoStorage: ArtifactRepoStoragePort = {
      hasArtifactInRepo: testDouble.fn(async () => ({
        ok: false as const,
        error: createContractError("unavailable", "Hugging Face hasArtifactInRepo failed authentication (token invalid/insufficient or repository access denied)."),
      })),
      storeArtifactInRepo: testDouble.fn(),
      retrieveArtifactFromRepo: testDouble.fn(),
    } as unknown as ArtifactRepoStoragePort;

    const artifactBindingStorage: ArtifactStorageBindingPort = {
      readArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true,
        value: {
          bindings: [
            {
              artifactId: "uploads/a.png",
              role: "published",
              createdAt: "2026-04-16T00:00:00.000Z",
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
      upsertArtifactStorageBinding: testDouble.fn(),
    } as unknown as ArtifactStorageBindingPort;

    const useCase = new VerifyPublishedArtifactBackingUseCase({
      artifactRepoStorage,
      artifactBindingStorage,
    });

    const result = await useCase.execute({ artifactId: "uploads/a.png" });
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unavailable failure.");
    }
    expect(result.error.code).toBe("unavailable");
    expect(result.error.message).toContain("published Hugging Face backing access");
  });
});
