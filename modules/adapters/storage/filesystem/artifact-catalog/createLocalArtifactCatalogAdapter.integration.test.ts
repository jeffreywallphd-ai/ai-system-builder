import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "../../../../testing/node-test";
import { createLocalArtifactCatalogPersistenceAdapter } from "./createLocalArtifactCatalogAdapter";

let tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map(async (root) => rm(root, { recursive: true, force: true })));
  tempRoots = [];
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "artifact-catalog-local-"));
  tempRoots.push(root);
  return root;
}

describe("createLocalArtifactCatalogPersistenceAdapter", () => {
  it("appends and reads image catalog metadata through explicit catalog operations", async () => {
    const rootDirectory = await createTempRoot();
    const adapter = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });

    const append = await adapter.appendArtifactCatalogRecord({
      record: {
        storageKey: " uploads/cat.png ",
        artifactFamily: "image",
        mediaType: "image/png",
      },
    });
    expect(append.ok).toBe(true);

    const browse = await adapter.browseArtifactCatalogRecords({ artifactFamily: "image" });
    const read = await adapter.readArtifactCatalogRecord({ storageKey: "uploads/cat.png" });

    expect(browse.ok).toBe(true);
    expect(read.ok).toBe(true);
    if (!browse.ok || !read.ok) {
      throw new Error("Expected catalog browse/read success.");
    }

    expect(browse.value.records.length).toBe(1);
    expect(read.value.record.storageKey).toBe("uploads/cat.png");
  });
});
