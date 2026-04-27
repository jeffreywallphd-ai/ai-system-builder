import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "../../../../../testing/node-test";
import { createStoreArtifactRequest } from "../../../../../contracts/storage";
import { createLocalArtifactCatalogPersistenceAdapter } from "../../artifact-catalog";
import {
  createFilesystemArtifactContentRetrievalAdapter,
  createFilesystemArtifactObjectStorageAdapter,
} from "..";

let tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map(async (root) => rm(root, { recursive: true, force: true })));
  tempRoots = [];
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "artifact-media-retrieval-"));
  tempRoots.push(root);
  return root;
}

describe("filesystem artifact content retrieval adapter", () => {
  it("retrieves viewer media bytes from separate retrieval seam while browse contracts stay descriptor-only", async () => {
    const rootDirectory = await createTempRoot();
    const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
    const objectStorage = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      artifactCatalogAppend: artifactCatalog,
    });
    const mediaRetrieval = createFilesystemArtifactContentRetrievalAdapter({
      storage: objectStorage,
      artifactCatalogRead: artifactCatalog,
    });

    await objectStorage.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([7, 8, 9]), {
        descriptor: {
          key: "uploads/session/view.png",
          mediaType: "image/png",
        },
      }),
    );

    const retrieval = await mediaRetrieval.retrieveArtifactViewerMediaByStorageKey(
      { storageKey: "uploads/session/view.png" },
      { requestId: "req-view-1", correlationId: "corr-view-1" },
    );

    expect(retrieval.ok).toBe(true);
    if (!retrieval.ok) {
      throw new Error("Expected media-view retrieval success.");
    }

    expect(retrieval.value).toEqual({
      storageKey: "uploads/session/view.png",
      mediaType: "image/png",
      sizeBytes: 3,
      bytes: new Uint8Array([7, 8, 9]),
    });
    expect(retrieval.requestId).toBe("req-view-1");
    expect(retrieval.correlationId).toBe("corr-view-1");
    expect("locator" in retrieval.value).toBe(false);
  });
});
