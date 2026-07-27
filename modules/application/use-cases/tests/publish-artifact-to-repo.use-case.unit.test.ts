import { describe, expect, it, testDouble } from "../../../testing/node-test";

import {
  createHasArtifactInRepoSuccessResult,
  createRetrieveArtifactSuccessResult,
  createStoreArtifactInRepoSuccessResult,
} from "../../../contracts/storage";
import type {
  ArtifactCatalogReadPort,
} from "../../ports/artifact-catalog";
import type {
  ArtifactObjectStoragePort,
  ArtifactRepoStoragePort,
  ArtifactStorageBindingPort,
} from "../../ports/storage";
import { PublishArtifactToRepoUseCase } from "../publish-artifact-to-repo.use-case";

describe("PublishArtifactToRepoUseCase", () => {
  function createArtifactCatalogRead(storageKey = "uploads/a.png"): ArtifactCatalogReadPort {
    return {
      browseArtifactCatalogRecords: testDouble.fn(),
      readArtifactCatalogRecord: testDouble.fn(async () => ({
        ok: true as const,
        value: {
          record: {
            storageKey,
            artifactFamily: "image" as const,
            createdAt: "2026-04-17T00:00:00.000Z",
          },
        },
      })),
    } as unknown as ArtifactCatalogReadPort;
  }

  it("authorizes artifact, credential, and explicit repository creation scopes before reads", async () => {
    const readArtifactCatalogRecord = testDouble.fn();
    const authorizeWorkspaceOperation = testDouble
      .fn()
      .mockRejectedValue(new Error("private policy detail"));
    const useCase = new PublishArtifactToRepoUseCase({
      artifactStorage: {} as ArtifactObjectStoragePort,
      artifactCatalogRead: {
        readArtifactCatalogRecord,
      } as unknown as ArtifactCatalogReadPort,
      artifactRepoStorage: {} as ArtifactRepoStoragePort,
      artifactBindingStorage: {} as ArtifactStorageBindingPort,
      workspaceRepository: {
        readWorkspace: async () => ({
          organizationId: "org-a" as never,
          workspaceId: "workspace-a" as never,
          displayName: "Workspace A",
          status: "active" as const,
          createdAt: "2026-07-27T00:00:00.000Z",
          updatedAt: "2026-07-27T00:00:00.000Z",
        }),
      },
      workspaceAuthorization: { authorizeWorkspaceOperation },
    });

    const result = await useCase.execute(
      {
        artifactId: "uploads/a.png",
        target: {
          provider: "huggingface",
          repository: "owner/repo",
          path: "a.png",
        },
        repositoryCreation: { approved: true, visibility: "private" },
      },
      { workspaceId: "workspace-a" },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected publication authorization failure.");
    expect(result.error.code).toBe("forbidden");
    expect(result.error.message).toBe("Workspace access is forbidden.");
    expect(JSON.stringify(result)).not.toContain("private policy detail");
    expect(authorizeWorkspaceOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "artifact.publish",
        requiredScopes: [
          "artifact:write",
          "provider-credential:use",
          "provider-repository:create",
        ],
      }),
    );
    expect(readArtifactCatalogRecord).not.toHaveBeenCalled();
  });

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
      artifactCatalogRead: createArtifactCatalogRead(),
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
      repositoryCreation: { approved: true, visibility: "private" },
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
    expect(artifactRepoStorage.storeArtifactInRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryCreation: { approved: true, visibility: "private" },
      }),
    );
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
      artifactCatalogRead: createArtifactCatalogRead(),
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

  it("rejects arbitrary storage keys that are not present in the artifact catalog", async () => {
    const retrieveArtifact = testDouble.fn();
    const useCase = new PublishArtifactToRepoUseCase({
      artifactStorage: {
        retrieveArtifact,
      } as unknown as ArtifactObjectStoragePort,
      artifactCatalogRead: {
        readArtifactCatalogRecord: testDouble.fn(async () => ({
          ok: false as const,
          error: { code: "not-found" as const, message: "Artifact catalog record not found." },
        })),
      } as unknown as ArtifactCatalogReadPort,
      artifactRepoStorage: {} as ArtifactRepoStoragePort,
      artifactBindingStorage: {} as ArtifactStorageBindingPort,
    });

    const result = await useCase.execute({
      artifactId: "uploads/arbitrary-secret.bin",
      target: {
        provider: "huggingface",
        repository: "owner/repo",
        path: "secret.bin",
      },
    });

    expect(result.ok).toBe(false);
    expect(retrieveArtifact).not.toHaveBeenCalled();
  });

  it("publishes from the approved primary binding locator instead of the caller artifact id", async () => {
    const retrieveArtifact = testDouble.fn(async () => createRetrieveArtifactSuccessResult(
      { key: "workspaces/workspace-a/artifacts/files/uploads/a.png", sizeBytes: 1 },
      new Uint8Array([1]),
    ));
    const artifactBindingStorage = {
      readArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true as const,
        value: {
          bindings: [{
            workspaceId: "workspace-a" as never,
            artifactId: "uploads/a.png",
            role: "primary" as const,
            backing: {
              kind: "artifact-object" as const,
              provider: "filesystem",
              locator: "workspaces/workspace-a/artifacts/files/uploads/a.png",
            },
          }],
        },
      })),
      upsertArtifactStorageBinding: testDouble.fn(async (request) => ({
        ok: true as const,
        value: { binding: request.binding },
      })),
    } as unknown as ArtifactStorageBindingPort;
    const useCase = new PublishArtifactToRepoUseCase({
      artifactStorage: { retrieveArtifact } as unknown as ArtifactObjectStoragePort,
      artifactCatalogRead: createArtifactCatalogRead(),
      artifactRepoStorage: {
        storeArtifactInRepo: testDouble.fn(async (request) => createStoreArtifactInRepoSuccessResult({
          target: request.target,
          sizeBytes: request.content.byteLength,
        })),
        hasArtifactInRepo: testDouble.fn(async () => createHasArtifactInRepoSuccessResult(true)),
      } as unknown as ArtifactRepoStoragePort,
      artifactBindingStorage,
    });

    const result = await useCase.execute({
      artifactId: "uploads/a.png",
      target: {
        provider: "huggingface",
        repository: "owner/repo",
        path: "a.png",
      },
    }, { workspaceId: "workspace-a" });

    expect(result.ok).toBe(true);
    expect(retrieveArtifact).toHaveBeenCalledWith(
      { key: "workspaces/workspace-a/artifacts/files/uploads/a.png" },
      { workspaceId: "workspace-a" },
    );
  });
});
