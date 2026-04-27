import { describe, expect, it, testDouble } from "../../../testing/node-test";

import { createContractError } from "../../../contracts/shared";
import type { ArtifactCatalogDeletePort, ArtifactCatalogReadPort } from "../../ports/artifact-catalog";
import type { ArtifactObjectStoragePort, ArtifactStorageBindingPort } from "../../ports/storage";
import { DeleteRegisteredArtifactUseCase } from "../delete-registered-artifact.use-case";

describe("DeleteRegisteredArtifactUseCase", () => {
  function createCatalogRead(callOrder?: string[]): Pick<ArtifactCatalogReadPort, "readArtifactCatalogRecord"> {
    return {
      readArtifactCatalogRecord: testDouble.fn(async () => {
        callOrder?.push("read-catalog");
        return {
          ok: true,
          value: {
            record: {
              storageKey: "artifacts/a-1",
              artifactFamily: "image",
            },
          },
        };
      }),
    };
  }

  it("deletes bindings, then local object, then catalog record", async () => {
    const callOrder: string[] = [];
    const artifactCatalogRead = createCatalogRead(callOrder);
    const artifactBindingStorage: Pick<ArtifactStorageBindingPort, "deleteArtifactStorageBindings"> = {
      deleteArtifactStorageBindings: testDouble.fn(async () => {
        callOrder.push("delete-bindings");
        return {
          ok: true,
          value: { deleted: true },
        };
      }),
    };
    const storage: Pick<ArtifactObjectStoragePort, "deleteArtifact"> = {
      deleteArtifact: testDouble.fn(async () => {
        callOrder.push("delete-local-object");
        return {
          ok: true,
          value: { deleted: true },
        };
      }),
    };
    const artifactCatalogDelete: ArtifactCatalogDeletePort = {
      deleteArtifactCatalogRecord: testDouble.fn(async () => {
        callOrder.push("delete-catalog");
        return {
          ok: true,
          value: { deleted: true },
        };
      }),
    };

    const useCase = new DeleteRegisteredArtifactUseCase({
      artifactCatalogRead,
      artifactCatalogDelete,
      storage,
      artifactBindingStorage,
    });

    const result = await useCase.execute({ storageKey: "artifacts/a-1" });

    expect(result.ok).toBe(true);
    expect(callOrder).toEqual([
      "read-catalog",
      "delete-bindings",
      "delete-local-object",
      "delete-catalog",
    ]);
  });

  it("returns binding-step partial failure and does not continue when binding deletion fails", async () => {
    const artifactCatalogRead = createCatalogRead();
    const artifactBindingStorage: Pick<ArtifactStorageBindingPort, "deleteArtifactStorageBindings"> = {
      deleteArtifactStorageBindings: testDouble.fn(async () => ({
        ok: false,
        error: createContractError("unavailable", "binding file locked"),
      })),
    };
    const storage: Pick<ArtifactObjectStoragePort, "deleteArtifact"> = {
      deleteArtifact: testDouble.fn(),
    };
    const artifactCatalogDelete: ArtifactCatalogDeletePort = {
      deleteArtifactCatalogRecord: testDouble.fn(),
    };

    const useCase = new DeleteRegisteredArtifactUseCase({
      artifactCatalogRead,
      artifactCatalogDelete,
      storage,
      artifactBindingStorage,
    });

    const result = await useCase.execute({ storageKey: "artifacts/a-1" });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected failure.");
    }
    expect(result.error.code).toBe("unavailable");
    expect(result.error.details).toMatchObject({
      storageKey: "artifacts/a-1",
      failedStep: "delete-bindings",
      partialCleanup: {
        bindingsDeleted: false,
        localObjectDeleted: false,
        catalogRecordDeleted: false,
      },
    });
    expect(storage.deleteArtifact).not.toHaveBeenCalled();
    expect(artifactCatalogDelete.deleteArtifactCatalogRecord).not.toHaveBeenCalled();
  });

  it("returns storage-step partial failure and does not delete catalog when local object deletion fails", async () => {
    const artifactCatalogRead = createCatalogRead();
    const artifactBindingStorage: Pick<ArtifactStorageBindingPort, "deleteArtifactStorageBindings"> = {
      deleteArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true,
        value: { deleted: true },
      })),
    };
    const storage: Pick<ArtifactObjectStoragePort, "deleteArtifact"> = {
      deleteArtifact: testDouble.fn(async () => ({
        ok: false,
        error: createContractError("unavailable", "local object delete failed"),
      })),
    };
    const artifactCatalogDelete: ArtifactCatalogDeletePort = {
      deleteArtifactCatalogRecord: testDouble.fn(),
    };

    const useCase = new DeleteRegisteredArtifactUseCase({
      artifactCatalogRead,
      artifactCatalogDelete,
      storage,
      artifactBindingStorage,
    });

    const result = await useCase.execute({ storageKey: "artifacts/a-1" });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected failure.");
    }
    expect(result.error.code).toBe("unavailable");
    expect(result.error.details).toMatchObject({
      storageKey: "artifacts/a-1",
      failedStep: "delete-local-object",
      partialCleanup: {
        bindingsDeleted: true,
        localObjectDeleted: false,
        catalogRecordDeleted: false,
      },
    });
    expect(artifactCatalogDelete.deleteArtifactCatalogRecord).not.toHaveBeenCalled();
  });

  it("returns catalog-step partial failure after local cleanup when catalog deletion fails", async () => {
    const artifactCatalogRead = createCatalogRead();
    const artifactBindingStorage: Pick<ArtifactStorageBindingPort, "deleteArtifactStorageBindings"> = {
      deleteArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true,
        value: { deleted: true },
      })),
    };
    const storage: Pick<ArtifactObjectStoragePort, "deleteArtifact"> = {
      deleteArtifact: testDouble.fn(async () => ({
        ok: true,
        value: { deleted: true },
      })),
    };
    const artifactCatalogDelete: ArtifactCatalogDeletePort = {
      deleteArtifactCatalogRecord: testDouble.fn(async () => ({
        ok: false,
        error: createContractError("unavailable", "catalog unavailable"),
      })),
    };

    const useCase = new DeleteRegisteredArtifactUseCase({
      artifactCatalogRead,
      artifactCatalogDelete,
      storage,
      artifactBindingStorage,
    });

    const result = await useCase.execute({ storageKey: "artifacts/a-1" });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected failure.");
    }
    expect(result.error.code).toBe("unavailable");
    expect(result.error.details).toMatchObject({
      storageKey: "artifacts/a-1",
      failedStep: "delete-catalog",
      partialCleanup: {
        bindingsDeleted: true,
        localObjectDeleted: true,
        catalogRecordDeleted: false,
      },
    });
  });

  it("treats missing local object as acceptable and still deletes the catalog record", async () => {
    const artifactCatalogRead = createCatalogRead();
    const artifactBindingStorage: Pick<ArtifactStorageBindingPort, "deleteArtifactStorageBindings"> = {
      deleteArtifactStorageBindings: testDouble.fn(async () => ({
        ok: true,
        value: { deleted: true },
      })),
    };
    const storage: Pick<ArtifactObjectStoragePort, "deleteArtifact"> = {
      deleteArtifact: testDouble.fn(async () => ({
        ok: true,
        value: { deleted: false },
      })),
    };
    const artifactCatalogDelete: ArtifactCatalogDeletePort = {
      deleteArtifactCatalogRecord: testDouble.fn(async () => ({
        ok: true,
        value: { deleted: true },
      })),
    };

    const useCase = new DeleteRegisteredArtifactUseCase({
      artifactCatalogRead,
      artifactCatalogDelete,
      storage,
      artifactBindingStorage,
    });

    const result = await useCase.execute({ storageKey: "artifacts/a-1" });

    expect(result.ok).toBe(true);
    expect(artifactCatalogDelete.deleteArtifactCatalogRecord).toHaveBeenCalledTimes(1);
  });
});
