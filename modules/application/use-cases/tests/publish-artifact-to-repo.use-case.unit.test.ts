import { describe, expect, it, testDouble } from "../../../testing/node-test";

import {
  createHasArtifactInRepoSuccessResult,
  createRetrieveArtifactSuccessResult,
  createStoreArtifactInRepoSuccessResult,
} from "../../../contracts/storage";
import type {
  ArtifactObjectStoragePort,
  ArtifactRepoStoragePort,
  ArtifactStorageBindingPort,
} from "../../ports/storage";
import { PublishArtifactToRepoUseCase } from "../publish-artifact-to-repo.use-case";

describe("PublishArtifactToRepoUseCase", () => {
  it("publishes local artifact bytes, verifies remote existence, and persists a published binding", async () => {
    const artifactStorage: ArtifactObjectStoragePort = {
      storeArtifact: testDouble.fn(),
      retrieveArtifact: testDouble.fn(async () => createRetrieveArtifactSuccessResult({
        key: "uploads/a.png",
        mediaType: "image/png",
        sizeBytes: 3,
      }, new Uint8Array([1, 2, 3]))),
      hasArtifact: testDouble.fn(),
      deleteArtifact: testDouble.fn(),
    } as unknown as ArtifactObjectStoragePort;

    const artifactRepoStorage: ArtifactRepoStoragePort = {
      hasArtifactInRepo: testDouble.fn(async () => createHasArtifactInRepoSuccessResult(true)),
      storeArtifactInRepo: testDouble.fn(async (request) => createStoreArtifactInRepoSuccessResult({
        target: request.target,
        mediaType: request.mediaType,
        sizeBytes: request.content.byteLength,
      })),
      retrieveArtifactFromRepo: testDouble.fn(),
    } as unknown as ArtifactRepoStoragePort;

    const artifactBindingStorage: ArtifactStorageBindingPort = {
      upsertArtifactStorageBinding: testDouble.fn(async (request) => ({
        ok: true,
        value: { binding: request.binding },
      })),
      readArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true,
        value: {
          bindings: [],
        },
      })),
    } as unknown as ArtifactStorageBindingPort;

    const useCase = new PublishArtifactToRepoUseCase({
      artifactStorage,
      artifactRepoStorage,
      artifactBindingStorage,
      now: () => "2026-04-17T00:00:00.000Z",
    });

    const result = await useCase.execute({
      artifactId: "uploads/a.png",
      target: {
        provider: "huggingface",
        repository: "openai/demo-artifacts",
        revision: "main",
        path: "images/a.png",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected publish success.");
    }
    expect(result.value).toEqual({
      target: {
        provider: "huggingface",
        repository: "openai/demo-artifacts",
        path: "images/a.png",
        revision: "main",
        locator: "openai/demo-artifacts/images/a.png",
      },
      verification: {
        exists: true,
        verifiedAt: "2026-04-17T00:00:00.000Z",
      },
    });
    expect(artifactBindingStorage.upsertArtifactStorageBinding).toHaveBeenCalledWith({
      binding: {
        artifactId: "uploads/a.png",
        role: "published",
        createdAt: "2026-04-17T00:00:00.000Z",
        backing: {
          kind: "artifact-repo",
          provider: "huggingface",
          locator: "openai/demo-artifacts/images/a.png",
          revision: "main",
          target: {
            provider: "huggingface",
            repository: "openai/demo-artifacts",
            revision: "main",
            path: "images/a.png",
          },
          verification: {
            exists: true,
            verifiedAt: "2026-04-17T00:00:00.000Z",
          },
        },
      },
    });
    expect(artifactBindingStorage.readArtifactStorageBindings).toHaveBeenCalledWith({
      artifactId: "uploads/a.png",
    });
  });

  it("upserts published backing records when the same artifact is published again", async () => {
    const artifactStorage: ArtifactObjectStoragePort = {
      storeArtifact: testDouble.fn(),
      retrieveArtifact: testDouble.fn(async () => createRetrieveArtifactSuccessResult({
        key: "uploads/a.png",
        mediaType: "image/png",
        sizeBytes: 3,
      }, new Uint8Array([1, 2, 3]))),
      hasArtifact: testDouble.fn(),
      deleteArtifact: testDouble.fn(),
    } as unknown as ArtifactObjectStoragePort;

    const artifactRepoStorage: ArtifactRepoStoragePort = {
      hasArtifactInRepo: testDouble.fn(async () => createHasArtifactInRepoSuccessResult(true)),
      storeArtifactInRepo: testDouble.fn(async (request) => createStoreArtifactInRepoSuccessResult({
        target: request.target,
        mediaType: request.mediaType,
        sizeBytes: request.content.byteLength,
      })),
      retrieveArtifactFromRepo: testDouble.fn(),
    } as unknown as ArtifactRepoStoragePort;

    const artifactBindingStorage: ArtifactStorageBindingPort = {
      upsertArtifactStorageBinding: testDouble.fn(async (request) => ({
        ok: true,
        value: { binding: request.binding },
      })),
      readArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true,
        value: {
          bindings: [],
        },
      })),
    } as unknown as ArtifactStorageBindingPort;

    const useCase = new PublishArtifactToRepoUseCase({
      artifactStorage,
      artifactRepoStorage,
      artifactBindingStorage,
      now: () => "2026-04-17T00:00:00.000Z",
    });

    await useCase.execute({
      artifactId: "uploads/a.png",
      target: {
        provider: "huggingface",
        repository: "openai/demo-artifacts",
        revision: "main",
        path: "images/a.png",
      },
    });
    await useCase.execute({
      artifactId: "uploads/a.png",
      target: {
        provider: "huggingface",
        repository: "openai/demo-artifacts",
        revision: "v2",
        path: "images/a.png",
      },
    });

    expect(artifactBindingStorage.upsertArtifactStorageBinding).toHaveBeenCalledTimes(2);
  });
});
