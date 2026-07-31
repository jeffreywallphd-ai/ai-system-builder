import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "../../../../testing/node-test";
import { createLocalArtifactCatalogPersistenceAdapter } from "./createLocalArtifactCatalogAdapter";

let tempRoots: string[] = [];


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
        workspaceId: "workspace-a",
        storageKey: " uploads/cat.png ",
        artifactFamily: "image",
        mediaType: "image/png",
      },
    });
    expect(append.ok).toBe(true);

    const browse = await adapter.browseArtifactCatalogRecords({ workspaceId: "workspace-a", artifactFamily: "image" });
    const read = await adapter.readArtifactCatalogRecord({ workspaceId: "workspace-a", storageKey: "uploads/cat.png" });

    expect(browse.ok).toBe(true);
    expect(read.ok).toBe(true);
    if (!browse.ok || !read.ok) {
      throw new Error("Expected catalog browse/read success.");
    }

    expect(browse.value.records.length).toBe(1);
    expect(read.value.record.storageKey).toBe("uploads/cat.png");
  });

  it("moves legacy binary JSON records into the structured-text family", async () => {
    const rootDirectory = await createTempRoot();
    await mkdir(path.join(rootDirectory, ".catalog"), { recursive: true });
    await writeFile(path.join(rootDirectory, ".catalog", "artifact-catalog.ndjson"), `${JSON.stringify({ workspaceId: "workspace-a", storageKey: "uploads/records.jsonl", artifactFamily: "binary", mediaType: "application/x-ndjson", originalName: "records.jsonl" })}\n`, "utf8");
    const adapter = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
    const structured = await adapter.browseArtifactCatalogRecords({ workspaceId: "workspace-a", artifactFamily: "structured-text" });
    const binary = await adapter.browseArtifactCatalogRecords({ workspaceId: "workspace-a", artifactFamily: "binary" });
    const read = await adapter.readArtifactCatalogRecord({ workspaceId: "workspace-a", storageKey: "uploads/records.jsonl" });
    expect(structured.ok).toBe(true);
    expect(binary.ok).toBe(true);
    expect(read.ok).toBe(true);
    if (!structured.ok || !binary.ok || !read.ok) throw new Error("Expected legacy JSON catalog reads to succeed.");
    expect(structured.value.records.length).toBe(1);
    expect(binary.value.records.length).toBe(0);
    expect(read.value.record.artifactFamily).toBe("structured-text");
  });

  it("isolates catalog browse and exact reads by workspace id without exposing legacy records", async () => {
    const rootDirectory = await createTempRoot();
    const adapter = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });

    await adapter.appendArtifactCatalogRecord({ record: { workspaceId: "workspace-a", storageKey: "uploads/a.png", artifactFamily: "image" } });
    await adapter.appendArtifactCatalogRecord({ record: { workspaceId: "workspace-b", storageKey: "uploads/b.png", artifactFamily: "image" } });
    await adapter.appendArtifactCatalogRecord({ record: { storageKey: "uploads/legacy.png", artifactFamily: "image" } });

    const workspaceA = await adapter.browseArtifactCatalogRecords({ workspaceId: "workspace-a" });
    const workspaceB = await adapter.browseArtifactCatalogRecords({ workspaceId: "workspace-b" });
    const crossRead = await adapter.readArtifactCatalogRecord({ workspaceId: "workspace-b", storageKey: "uploads/a.png" });
    const missingWorkspace = await adapter.browseArtifactCatalogRecords({ workspaceId: "" });

    expect(workspaceA.ok).toBe(true);
    expect(workspaceB.ok).toBe(true);
    if (!workspaceA.ok || !workspaceB.ok) throw new Error("Expected workspace catalog browse success.");
    expect(workspaceA.value.records.map((record) => record.storageKey)).toEqual(["uploads/a.png"]);
    expect(workspaceB.value.records.map((record) => record.storageKey)).toEqual(["uploads/b.png"]);
    expect(crossRead.ok).toBe(false);
    expect(missingWorkspace.ok).toBe(false);
  });


  it("treats a missing catalog file as empty but returns safe failures for read errors", async () => {
    const rootDirectory = await createTempRoot();
    const missingAdapter = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
    const missing = await missingAdapter.browseArtifactCatalogRecords({ workspaceId: "workspace-a" });
    expect(missing.ok).toBe(true);
    if (!missing.ok) throw new Error("Expected missing catalog to browse as empty.");
    expect(missing.value.records).toEqual([]);

    await mkdir(path.join(rootDirectory, ".catalog"), { recursive: true });
    await mkdir(path.join(rootDirectory, ".catalog", "artifact-catalog.ndjson"));
    const failingAdapter = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
    const failure = await failingAdapter.browseArtifactCatalogRecords({ workspaceId: "workspace-a" });
    expect(failure.ok).toBe(false);
    if (failure.ok) throw new Error("Expected catalog directory read to fail.");
    expect(failure.error.message).toBe("Artifact catalog is unavailable.");
    expect(JSON.stringify(failure.error)).not.toContain(rootDirectory);
    expect(JSON.stringify(failure.error)).not.toContain("artifact-catalog.ndjson");
  });

});
