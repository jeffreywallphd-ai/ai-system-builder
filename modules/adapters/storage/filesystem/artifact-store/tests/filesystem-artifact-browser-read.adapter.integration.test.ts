import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "../../../../../testing/node-test";
import { createStoreArtifactRequest } from "../../../../../contracts/storage";
import { createLocalArtifactCatalogPersistenceAdapter } from "../../artifact-catalog";
import { createLocalArtifactStorageBindingAdapter } from "../../artifact-catalog";
import {
  createFilesystemArtifactBrowserReadAdapter,
  createFilesystemArtifactObjectStorageAdapter,
} from "..";

let tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map(async (root) => rm(root, { recursive: true, force: true })));
  tempRoots = [];
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "artifact-browser-catalog-"));
  tempRoots.push(root);
  return root;
}

describe("filesystem artifact browser read adapter", () => {
  it("includes uploaded non-image artifacts in default browse results", async () => {
    const rootDirectory = await createTempRoot();
    const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
    const objectStorage = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      artifactCatalogAppend: artifactCatalog,
    });
    const browserRead = createFilesystemArtifactBrowserReadAdapter({
      rootDirectory,
      artifactCatalogRead: artifactCatalog,
      artifactCatalogAppend: artifactCatalog,
      storage: objectStorage,
    });

    await objectStorage.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([1, 2, 3]), {
        descriptor: {
          key: "uploads/session/cat.png",
          mediaType: "image/png",
        },
      }),
    );
    await objectStorage.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([4, 5, 6]), {
        descriptor: {
          key: "uploads/session/train.parquet",
          mediaType: "application/x-parquet",
        },
      }),
    );

    const browseResult = await browserRead.browseArtifacts({});
    expect(browseResult.ok).toBe(true);
    if (!browseResult.ok) {
      throw new Error("Expected browse success.");
    }

    const imageItem = browseResult.value.items.find((item) => item.storageKey === "uploads/session/cat.png");
    const dataItem = browseResult.value.items.find((item) => item.storageKey === "uploads/session/train.parquet");
    expect(imageItem).toMatchObject({
      artifactFamily: "image",
      mediaType: "image/png",
    });
    expect(dataItem).toMatchObject({
      artifactFamily: "tabular",
      mediaType: "application/x-parquet",
    });
  });

  it("uses artifact catalog records from explicit catalog seam instead of filesystem traversal", async () => {
    const rootDirectory = await createTempRoot();
    const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
    const objectStorage = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      artifactCatalogAppend: artifactCatalog,
    });
    const browserRead = createFilesystemArtifactBrowserReadAdapter({
      rootDirectory,
      artifactCatalogRead: artifactCatalog,
      artifactCatalogAppend: artifactCatalog,
      storage: objectStorage,
    });

    await objectStorage.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([1, 2, 3]), {
        descriptor: {
          key: "uploads/session/cat.png",
          mediaType: "image/png",
          metadata: {
            originalFileName: "cat.png",
          },
        },
      }),
    );

    await mkdir(path.join(rootDirectory, "hidden"), { recursive: true });
    await writeFile(path.join(rootDirectory, "hidden", "not-cataloged.png"), new Uint8Array([9, 9]));

    const browseResult = await browserRead.browseArtifacts({ artifactFamily: "image" });

    expect(browseResult.ok).toBe(true);
    if (!browseResult.ok) {
      throw new Error("Expected browse success.");
    }

    expect(browseResult.value.items.length).toBe(1);
    expect(browseResult.value.items[0]).toMatchObject({
      storageKey: "uploads/session/cat.png",
      artifactFamily: "image",
      mediaType: "image/png",
      sizeBytes: 3,
      sourceKind: "upload",
      originalName: "cat.png",
    });
    expect(browseResult.value.items.find((item) => item.storageKey.includes("hidden"))).toBeUndefined();
  });

  it("keeps read/detail/content storage-key-based and path agnostic", async () => {
    const rootDirectory = await createTempRoot();
    const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
    const objectStorage = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      artifactCatalogAppend: artifactCatalog,
    });
    const browserRead = createFilesystemArtifactBrowserReadAdapter({
      rootDirectory,
      artifactCatalogRead: artifactCatalog,
      artifactCatalogAppend: artifactCatalog,
      storage: objectStorage,
    });

    await objectStorage.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([4, 5, 6, 7]), {
        descriptor: {
          key: "uploads/session/dog.png",
          mediaType: "image/png",
        },
      }),
    );

    const detail = await browserRead.readArtifactDetail({ locator: { storageKey: "uploads/session/dog.png" } });
    const content = await browserRead.readArtifactContent({ locator: { storageKey: "uploads/session/dog.png" } });

    expect(detail.ok).toBe(true);
    expect(content.ok).toBe(true);
    if (!detail.ok || !content.ok) {
      throw new Error("Expected detail/content success.");
    }

    expect(detail.value.artifact.locator.storageKey).toBe("uploads/session/dog.png");
    expect(content.value.content).toMatchObject({
      locator: { storageKey: "uploads/session/dog.png" },
      availability: "available",
      retrieval: "deferred",
    });
    expect("bytes" in content.value.content).toBe(false);
  });

  it("returns detail read model without metadata when catalog record has no metadata", async () => {
    const rootDirectory = await createTempRoot();
    const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
    const objectStorage = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      artifactCatalogAppend: artifactCatalog,
    });
    const browserRead = createFilesystemArtifactBrowserReadAdapter({
      rootDirectory,
      artifactCatalogRead: artifactCatalog,
      artifactCatalogAppend: artifactCatalog,
      storage: objectStorage,
    });

    await objectStorage.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([4, 5, 6, 7]), {
        descriptor: {
          key: "uploads/session/without-metadata.png",
          mediaType: "image/png",
        },
      }),
    );

    const detail = await browserRead.readArtifactDetail({
      locator: { storageKey: "uploads/session/without-metadata.png" },
    });

    expect(detail.ok).toBe(true);
    if (!detail.ok) {
      throw new Error("Expected detail success.");
    }

    expect(detail.value.artifact).toMatchObject({
      locator: { storageKey: "uploads/session/without-metadata.png" },
      artifactFamily: "image",
      mediaType: "image/png",
      sizeBytes: 4,
    });
    expect(detail.value.artifact.metadata).toBeUndefined();
  });

  it("adds published backing metadata from artifact storage bindings into detail read model", async () => {
    const rootDirectory = await createTempRoot();
    const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
    const artifactBindings = createLocalArtifactStorageBindingAdapter({ rootDirectory });
    const objectStorage = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      artifactCatalogAppend: artifactCatalog,
    });
    const browserRead = createFilesystemArtifactBrowserReadAdapter({
      rootDirectory,
      artifactCatalogRead: artifactCatalog,
      artifactCatalogAppend: artifactCatalog,
      storage: objectStorage,
      artifactBindingRead: artifactBindings,
    });

    await objectStorage.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([9, 8, 7]), {
        descriptor: {
          key: "uploads/session/published.png",
          mediaType: "image/png",
        },
      }),
    );
    await artifactBindings.upsertArtifactStorageBinding({
      binding: {
        artifactId: "uploads/session/published.png",
        role: "published",
        createdAt: "2026-04-17T00:00:00.000Z",
        backing: {
          kind: "artifact-repo",
          provider: "huggingface",
          locator: "openai/demo-artifacts/images/published.png",
          revision: "main",
          target: {
            provider: "huggingface",
            repository: "openai/demo-artifacts",
            path: "images/published.png",
            revision: "main",
          },
        },
      },
    });

    const detail = await browserRead.readArtifactDetail({
      locator: { storageKey: "uploads/session/published.png" },
    });

    expect(detail.ok).toBe(true);
    if (!detail.ok) {
      throw new Error("Expected detail success.");
    }
    expect(detail.value.artifact.metadata).toMatchObject({
      publishedBacking: {
        target: {
          provider: "huggingface",
          repository: "openai/demo-artifacts",
          path: "images/published.png",
          revision: "main",
          locator: "openai/demo-artifacts/images/published.png",
        },
        verification: {
          exists: false,
        },
      },
    });
  });

  it("falls back to locator decode for legacy published-binding rows without structured target", async () => {
    const rootDirectory = await createTempRoot();
    const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
    const artifactBindings = createLocalArtifactStorageBindingAdapter({ rootDirectory });
    const objectStorage = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      artifactCatalogAppend: artifactCatalog,
    });
    const browserRead = createFilesystemArtifactBrowserReadAdapter({
      rootDirectory,
      artifactCatalogRead: artifactCatalog,
      artifactCatalogAppend: artifactCatalog,
      storage: objectStorage,
      artifactBindingRead: artifactBindings,
    });

    await objectStorage.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([9, 8, 7]), {
        descriptor: {
          key: "uploads/session/legacy.png",
          mediaType: "image/png",
        },
      }),
    );
    await artifactBindings.upsertArtifactStorageBinding({
      binding: {
        artifactId: "uploads/session/legacy.png",
        role: "published",
        createdAt: "2026-04-17T00:00:00.000Z",
        backing: {
          kind: "artifact-repo",
          provider: "huggingface",
          locator: "openai/demo-artifacts/images/legacy.png",
          revision: "main",
        },
      },
    });

    const detail = await browserRead.readArtifactDetail({
      locator: { storageKey: "uploads/session/legacy.png" },
    });

    expect(detail.ok).toBe(true);
    if (!detail.ok) {
      throw new Error("Expected detail success.");
    }
    expect(detail.value.artifact.metadata).toMatchObject({
      publishedBacking: {
        target: {
          provider: "huggingface",
          repository: "openai/demo-artifacts",
          path: "images/legacy.png",
          revision: "main",
          locator: "openai/demo-artifacts/images/legacy.png",
        },
        verification: {
          exists: false,
        },
      },
    });
  });

  it("surfaces imported-source and published backings distinctly and adds browse state metadata", async () => {
    const rootDirectory = await createTempRoot();
    const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
    const artifactBindings = createLocalArtifactStorageBindingAdapter({ rootDirectory });
    const objectStorage = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      artifactCatalogAppend: artifactCatalog,
    });
    const browserRead = createFilesystemArtifactBrowserReadAdapter({
      rootDirectory,
      artifactCatalogRead: artifactCatalog,
      artifactCatalogAppend: artifactCatalog,
      storage: objectStorage,
      artifactBindingRead: artifactBindings,
    });

    await objectStorage.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([1, 2, 3, 4]), {
        descriptor: {
          key: "artifacts/20260418000000-local01",
          mediaType: "image/png",
        },
      }),
    );
    await artifactBindings.upsertArtifactStorageBinding({
      binding: {
        artifactId: "artifacts/20260418000000-local01",
        role: "imported-source",
        createdAt: "2026-04-17T00:00:00.000Z",
        backing: {
          kind: "artifact-repo",
          provider: "huggingface",
          locator: "openai/demo/images/local01.png",
          target: {
            provider: "huggingface",
            repository: "openai/demo",
            path: "images/local01.png",
            revision: "main",
          },
        },
      },
    });
    await artifactBindings.upsertArtifactStorageBinding({
      binding: {
        artifactId: "artifacts/20260418000000-local01",
        role: "published",
        createdAt: "2026-04-18T00:00:00.000Z",
        backing: {
          kind: "artifact-repo",
          provider: "huggingface",
          locator: "openai/demo-public/images/local01.png",
          target: {
            provider: "huggingface",
            repository: "openai/demo-public",
            path: "images/local01.png",
            revision: "main",
          },
        },
      },
    });

    const browse = await browserRead.browseArtifacts({ artifactFamily: "image" });
    const detail = await browserRead.readArtifactDetail({
      locator: { storageKey: "artifacts/20260418000000-local01" },
    });

    expect(browse.ok).toBe(true);
    if (!browse.ok) {
      throw new Error("Expected browse success.");
    }
    expect(browse.value.items[0]?.metadata).toMatchObject({
      backingState: {
        hasImportedSourceBacking: true,
        hasPublishedBacking: true,
        hasLocalObjectAvailable: true,
        isLocalized: true,
        isRemoteOnly: false,
      },
    });

    expect(detail.ok).toBe(true);
    if (!detail.ok) {
      throw new Error("Expected detail success.");
    }
    expect(detail.value.artifact.metadata).toMatchObject({
      importedSourceBacking: {
        target: {
          repository: "openai/demo",
        },
      },
      publishedBacking: {
        target: {
          repository: "openai/demo-public",
        },
      },
    });
  });

  it("detects unregistered uploaded artifacts by diffing uploads folder against catalog", async () => {
    const rootDirectory = await createTempRoot();
    const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
    const objectStorage = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      artifactCatalogAppend: artifactCatalog,
    });
    const browserRead = createFilesystemArtifactBrowserReadAdapter({
      rootDirectory,
      artifactCatalogRead: artifactCatalog,
      artifactCatalogAppend: artifactCatalog,
      storage: objectStorage,
    });

    await objectStorage.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([1, 2, 3]), {
        descriptor: { key: "uploads/session/registered.json", mediaType: "application/json" },
      }),
    );
    await mkdir(path.join(rootDirectory, "uploads", "session"), { recursive: true });
    await writeFile(path.join(rootDirectory, "uploads", "session", "orphan.parquet"), new Uint8Array([7, 8]));

    const result = await browserRead.browseUnregisteredArtifacts();
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected unregistered browse success.");
    }

    expect(result.value.items.length).toBe(1);
    expect(result.value.items[0]).toMatchObject({
      storageKey: "uploads/session/orphan.parquet",
      relativePath: "session/orphan.parquet",
      fileName: "orphan.parquet",
      mediaType: "application/x-parquet",
    });
  });

  it("registers an unregistered uploaded artifact into the artifact catalog", async () => {
    const rootDirectory = await createTempRoot();
    const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
    const browserRead = createFilesystemArtifactBrowserReadAdapter({
      rootDirectory,
      artifactCatalogRead: artifactCatalog,
      artifactCatalogAppend: artifactCatalog,
    });

    await mkdir(path.join(rootDirectory, "uploads", "session"), { recursive: true });
    await writeFile(path.join(rootDirectory, "uploads", "session", "report.pdf"), new Uint8Array([1, 2, 3, 4]));

    const registerResult = await browserRead.registerUnregisteredArtifact({
      storageKey: "uploads/session/report.pdf",
    });
    expect(registerResult.ok).toBe(true);

    const browseRegistered = await browserRead.browseArtifacts({});
    expect(browseRegistered.ok).toBe(true);
    if (!browseRegistered.ok) {
      throw new Error("Expected browse success.");
    }
    expect(browseRegistered.value.items.length).toBe(1);
    expect(browseRegistered.value.items[0]).toMatchObject({
      storageKey: "uploads/session/report.pdf",
      mediaType: "application/pdf",
      artifactFamily: "document",
    });
  });

  it("uses consistent catalog artifactFamily derivation for normal uploads and unregistered registration", async () => {
    const rootDirectory = await createTempRoot();
    const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
    const objectStorage = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      artifactCatalogAppend: artifactCatalog,
    });
    const browserRead = createFilesystemArtifactBrowserReadAdapter({
      rootDirectory,
      artifactCatalogRead: artifactCatalog,
      artifactCatalogAppend: artifactCatalog,
      storage: objectStorage,
    });

    await objectStorage.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([5, 5, 5]), {
        descriptor: {
          key: "uploads/session/from-store.pdf",
          mediaType: "application/pdf",
        },
      }),
    );
    await mkdir(path.join(rootDirectory, "uploads", "session"), { recursive: true });
    await writeFile(path.join(rootDirectory, "uploads", "session", "from-unregistered.pdf"), new Uint8Array([6, 6, 6]));
    await browserRead.registerUnregisteredArtifact({
      storageKey: "uploads/session/from-unregistered.pdf",
    });

    const browseResult = await browserRead.browseArtifacts({ artifactFamily: "document" });
    expect(browseResult.ok).toBe(true);
    if (!browseResult.ok) {
      throw new Error("Expected browse success.");
    }

    const byKey = new Map(browseResult.value.items.map((item) => [item.storageKey, item]));
    expect(byKey.get("uploads/session/from-store.pdf")?.artifactFamily).toBe("document");
    expect(byKey.get("uploads/session/from-unregistered.pdf")?.artifactFamily).toBe("document");
  });

  it("deletes unregistered uploaded artifacts without touching registered catalog artifacts", async () => {
    const rootDirectory = await createTempRoot();
    const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
    const browserRead = createFilesystemArtifactBrowserReadAdapter({
      rootDirectory,
      artifactCatalogRead: artifactCatalog,
      artifactCatalogAppend: artifactCatalog,
    });

    await mkdir(path.join(rootDirectory, "uploads", "session"), { recursive: true });
    await writeFile(path.join(rootDirectory, "uploads", "session", "delete-me.txt"), new Uint8Array([1]));

    const deleteResult = await browserRead.deleteUnregisteredArtifact({
      storageKey: "uploads/session/delete-me.txt",
    });
    expect(deleteResult.ok).toBe(true);

    const listResult = await browserRead.browseUnregisteredArtifacts();
    expect(listResult.ok).toBe(true);
    if (!listResult.ok) {
      throw new Error("Expected browse success.");
    }
    expect(listResult.value.items.find((item) => item.storageKey === "uploads/session/delete-me.txt")).toBeUndefined();
  });
});
