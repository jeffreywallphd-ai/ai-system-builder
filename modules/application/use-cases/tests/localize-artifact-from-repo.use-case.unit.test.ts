import { describe, expect, it, testDouble } from "../../../testing/node-test";

import {
  createRetrieveArtifactFromRepoSuccessResult,
  createStoreArtifactFailureResult,
  createStoreArtifactSuccessResult,
  type StoreArtifactRequest,
} from "../../../contracts/storage";
import { createContractError } from "../../../contracts/shared";
import type {
  ArtifactObjectStoragePort,
  ArtifactRepoStoragePort,
  ArtifactStorageBindingPort,
} from "../../ports/storage";
import {
  LocalizeArtifactFromRepoUseCase,
  type LocalizeArtifactFromRepoSuccessValue,
} from "../localize-artifact-from-repo.use-case";

describe("LocalizeArtifactFromRepoUseCase", () => {
  it("fails before binding, provider, or storage access when workspace context is missing", async () => {
    const readBindings = testDouble.fn();
    const retrieveFromRepo = testDouble.fn();
    const storeArtifact = testDouble.fn();
    const useCase = new LocalizeArtifactFromRepoUseCase({
      artifactRepoStorage: {
        retrieveArtifactFromRepo: retrieveFromRepo,
      } as unknown as ArtifactRepoStoragePort,
      artifactBindingStorage: {
        readArtifactStorageBindings: readBindings,
      } as unknown as ArtifactStorageBindingPort,
      artifactStorage: {
        storeArtifact,
      } as unknown as ArtifactObjectStoragePort,
    });

    const result = await useCase.execute({
      artifactId: "artifacts/20260418000000-local01",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected missing workspace context to fail.");
    expect(result.error.code).toBe("validation");
    expect(readBindings).toHaveBeenCalledTimes(0);
    expect(retrieveFromRepo).toHaveBeenCalledTimes(0);
    expect(storeArtifact).toHaveBeenCalledTimes(0);
  });

  it("retrieves imported bytes from repo, stores local object, and writes local+source bindings", async () => {
    const artifactRepoStorage: ArtifactRepoStoragePort = {
      hasArtifactInRepo: testDouble.fn(),
      storeArtifactInRepo: testDouble.fn(),
      retrieveArtifactFromRepo: testDouble.fn(async () =>
        createRetrieveArtifactFromRepoSuccessResult(
          {
            target: {
              provider: "huggingface",
              repository: "openai/demo",
              path: "images/a.png",
              revision: "main",
            },
            mediaType: "image/png",
            sizeBytes: 3,
          },
          new Uint8Array([1, 2, 3]),
        ),
      ),
    } as unknown as ArtifactRepoStoragePort;

    const artifactStorage: ArtifactObjectStoragePort = {
      storeArtifact: testDouble.fn(
        async (
          request: StoreArtifactRequest<Uint8Array>,
          context?: { workspaceId?: string },
        ) => {
          if (context?.workspaceId !== "workspace-a") {
            return createStoreArtifactFailureResult(
              createContractError("unavailable", "Failed to store artifact bytes."),
            );
          }
          return createStoreArtifactSuccessResult({
            key: request.descriptor.key ?? "",
            mediaType: request.descriptor.mediaType,
            sizeBytes: request.content.byteLength,
          });
        },
      ),
      retrieveArtifact: testDouble.fn(),
      hasArtifact: testDouble.fn(),
      deleteArtifact: testDouble.fn(),
    } as unknown as ArtifactObjectStoragePort;

    const artifactBindingStorage: ArtifactStorageBindingPort = {
      readArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true,
        value: {
          bindings: [
            {
              workspaceId: "workspace-a",
              artifactId: "artifacts/20260418000000-local01",
              role: "imported-source",
              createdAt: "2026-04-17T00:00:00.000Z",
              backing: {
                kind: "artifact-repo",
                provider: "huggingface",
                locator: "openai/demo/images/a.png",
                revision: "main",
                target: {
                  provider: "huggingface",
                  repository: "openai/demo",
                  path: "images/a.png",
                  revision: "main",
                },
                verification: {
                  exists: true,
                  verifiedAt: "2026-04-17T00:00:00.000Z",
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

    const useCase = new LocalizeArtifactFromRepoUseCase({
      artifactRepoStorage,
      artifactBindingStorage,
      artifactStorage,
      now: () => "2026-04-18T00:00:00.000Z",
    });

    const result = await useCase.execute(
      { artifactId: "artifacts/20260418000000-local01" },
      { workspaceId: "workspace-a" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected localization success.");
    }

    expect(result.value).toMatchObject({
      artifactId: "artifacts/20260418000000-local01",
      localObject: {
        key: "artifacts/20260418000000-local01",
        mediaType: "image/png",
        sizeBytes: 3,
      },
    });
    expect(
      artifactBindingStorage.upsertArtifactStorageBinding,
    ).toHaveBeenCalledTimes(2);
    expect(
      (artifactStorage.storeArtifact as ReturnType<typeof testDouble.fn>).mock
        .calls[0],
    ).toMatchObject([
      {
        descriptor: {
          metadata: { originalFileName: "images/a.png" },
        },
      },
      { workspaceId: "workspace-a" },
    ]);
    const importedSourceUpsertCall = (
      artifactBindingStorage.upsertArtifactStorageBinding as ReturnType<
        typeof testDouble.fn
      >
    ).mock.calls.find((call) => call[0]?.binding?.role === "imported-source");
    expect(importedSourceUpsertCall?.[0]).toMatchObject({
      binding: {
        workspaceId: "workspace-a",
        role: "imported-source",
        backing: {
          target: {
            repository: "openai/demo",
            path: "images/a.png",
          },
        },
      },
    });
  });

  it("uses retrieved content length when storage descriptor omits sizeBytes", async () => {
    const retrievedContent = new Uint8Array([1, 2, 3, 4]);
    const artifactRepoStorage: ArtifactRepoStoragePort = {
      hasArtifactInRepo: testDouble.fn(),
      storeArtifactInRepo: testDouble.fn(),
      retrieveArtifactFromRepo: testDouble.fn(async () =>
        createRetrieveArtifactFromRepoSuccessResult(
          {
            target: {
              provider: "huggingface",
              repository: "openai/demo",
              path: "images/a.png",
              revision: "main",
            },
            mediaType: "image/png",
            sizeBytes: retrievedContent.byteLength,
          },
          retrievedContent,
        ),
      ),
    } as unknown as ArtifactRepoStoragePort;

    const artifactStorage: ArtifactObjectStoragePort = {
      storeArtifact: testDouble.fn(
        async (request: StoreArtifactRequest<Uint8Array>) =>
          createStoreArtifactSuccessResult({
            key: request.descriptor.key ?? "",
            mediaType: request.descriptor.mediaType,
          }),
      ),
      retrieveArtifact: testDouble.fn(),
      hasArtifact: testDouble.fn(),
      deleteArtifact: testDouble.fn(),
    } as unknown as ArtifactObjectStoragePort;

    const artifactBindingStorage: ArtifactStorageBindingPort = {
      readArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true,
        value: {
          bindings: [
            {
              workspaceId: "workspace-a",
              artifactId: "artifacts/20260418000000-local01",
              role: "imported-source",
              createdAt: "2026-04-17T00:00:00.000Z",
              backing: {
                kind: "artifact-repo",
                provider: "huggingface",
                locator: "openai/demo/images/a.png",
                revision: "main",
                target: {
                  provider: "huggingface",
                  repository: "openai/demo",
                  path: "images/a.png",
                  revision: "main",
                },
                verification: {
                  exists: true,
                  verifiedAt: "2026-04-17T00:00:00.000Z",
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

    const useCase = new LocalizeArtifactFromRepoUseCase({
      artifactRepoStorage,
      artifactBindingStorage,
      artifactStorage,
      now: () => "2026-04-18T00:00:00.000Z",
    });

    const result = await useCase.execute(
      { artifactId: "artifacts/20260418000000-local01" },
      { workspaceId: "workspace-a" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected localization success.");
    }

    const value = result.value as LocalizeArtifactFromRepoSuccessValue;
    expect(value.localObject.sizeBytes).toBe(retrievedContent.byteLength);
  });

  it("returns explicit localize auth guidance when repository retrieval is unavailable", async () => {
    const artifactRepoStorage: ArtifactRepoStoragePort = {
      hasArtifactInRepo: testDouble.fn(),
      storeArtifactInRepo: testDouble.fn(),
      retrieveArtifactFromRepo: testDouble.fn(async () => ({
        ok: false as const,
        error: createContractError(
          "unavailable",
          "Hugging Face retrieveArtifactFromRepo requires an access token for this repository. No token is configured.",
        ),
      })),
    } as unknown as ArtifactRepoStoragePort;

    const artifactStorage: ArtifactObjectStoragePort = {
      storeArtifact: testDouble.fn(),
      retrieveArtifact: testDouble.fn(),
      hasArtifact: testDouble.fn(),
      deleteArtifact: testDouble.fn(),
    } as unknown as ArtifactObjectStoragePort;

    const artifactBindingStorage: ArtifactStorageBindingPort = {
      readArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true,
        value: {
          bindings: [
            {
              workspaceId: "workspace-a",
              artifactId: "artifacts/20260418000000-local01",
              role: "imported-source",
              createdAt: "2026-04-17T00:00:00.000Z",
              backing: {
                kind: "artifact-repo",
                provider: "huggingface",
                locator: "openai/private-demo/images/a.png",
                revision: "main",
                target: {
                  provider: "huggingface",
                  repository: "openai/private-demo",
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

    const useCase = new LocalizeArtifactFromRepoUseCase({
      artifactRepoStorage,
      artifactBindingStorage,
      artifactStorage,
    });

    const result = await useCase.execute(
      { artifactId: "artifacts/20260418000000-local01" },
      { workspaceId: "workspace-a" },
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected unavailable failure.");
    }
    expect(result.error.code).toBe("unavailable");
    expect(result.error.message).toContain("localize imported artifact");
  });
});
