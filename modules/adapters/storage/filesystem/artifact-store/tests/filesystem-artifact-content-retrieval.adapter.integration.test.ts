import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "../../../../../testing/node-test";
import { createStoreArtifactRequest } from "../../../../../contracts/storage";
import { createLocalArtifactCatalogPersistenceAdapter } from "../../artifact-catalog";
import {
  createFilesystemArtifactContentRetrievalAdapter,
  createFilesystemArtifactObjectStorageAdapter,
} from "..";

let tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "artifact-media-retrieval-"),
  );
  tempRoots.push(root);
  return root;
}

describe("filesystem artifact content retrieval adapter", () => {
  it("retrieves viewer media bytes from separate retrieval seam while browse contracts stay descriptor-only", async () => {
    const rootDirectory = await createTempRoot();
    const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({
      rootDirectory,
    });
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
      { workspaceId: "workspace-a" },
    );

    const retrieval =
      await mediaRetrieval.retrieveArtifactViewerMediaByStorageKey(
        { storageKey: "uploads/session/view.png" },
        {
          requestId: "req-view-1",
          correlationId: "corr-view-1",
          workspaceId: "workspace-a",
        },
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

  it("does not retrieve bytes until workspace catalog ownership is validated", async () => {
    const retrieveCalls: unknown[] = [];
    const retrieveArtifact = async (request: unknown) => {
      retrieveCalls.push(request);
      return {
        ok: true as const,
        value: {
          descriptor: {
            key: "workspaces/workspace-a/artifacts/files/a.png",
            sizeBytes: 1,
          },
          content: new Uint8Array([1]),
        },
      };
    };
    const readArtifactCatalogRecord = async ({
      workspaceId,
      storageKey,
    }: {
      workspaceId?: string;
      storageKey: string;
    }) => {
      if (
        workspaceId === "workspace-a" &&
        storageKey === "workspaces/workspace-a/artifacts/files/a.png"
      ) {
        return {
          ok: true as const,
          value: {
            record: {
              workspaceId: "workspace-a",
              storageKey,
              artifactFamily: "image" as const,
              mediaType: "image/png",
            },
          },
        };
      }
      return {
        ok: false as const,
        error: { code: "not-found" as const, message: "Artifact not found." },
      };
    };
    const adapter = createFilesystemArtifactContentRetrievalAdapter({
      storage: { retrieveArtifact },
      artifactCatalogRead: {
        browseArtifactCatalogRecords: async () => ({
          ok: true as const,
          value: { records: [] },
        }),
        readArtifactCatalogRecord,
      },
    });

    const missingWorkspace =
      await adapter.retrieveArtifactViewerMediaByStorageKey(
        { storageKey: "workspaces/workspace-a/artifacts/files/a.png" },
        {},
      );
    const wrongWorkspace =
      await adapter.retrieveArtifactViewerMediaByStorageKey(
        { storageKey: "workspaces/workspace-a/artifacts/files/a.png" },
        { workspaceId: "workspace-b" },
      );
    const missingRecord = await adapter.retrieveArtifactViewerMediaByStorageKey(
      { storageKey: "workspaces/workspace-a/artifacts/files/missing.png" },
      { workspaceId: "workspace-a" },
    );

    expect(missingWorkspace.ok).toBe(false);
    expect(wrongWorkspace.ok).toBe(false);
    expect(missingRecord.ok).toBe(false);
    expect(retrieveCalls.length).toBe(0);

    const success = await adapter.retrieveArtifactViewerMediaByStorageKey(
      {
        storageKey: "workspaces/workspace-a/artifacts/files/a.png",
        maximumBytes: 2048,
      },
      { workspaceId: "workspace-a" },
    );
    expect(success.ok).toBe(true);
    expect(retrieveCalls.length).toBe(1);
    expect(retrieveCalls[0]).toEqual({
      key: "workspaces/workspace-a/artifacts/files/a.png",
      maximumBytes: 2048,
    });
  });

  it("rejects an oversized artifact from filesystem metadata before returning bytes", async () => {
    const rootDirectory = await createTempRoot();
    const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({
      rootDirectory,
    });
    const objectStorage = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      artifactCatalogAppend: artifactCatalog,
    });
    const mediaRetrieval = createFilesystemArtifactContentRetrievalAdapter({
      storage: objectStorage,
      artifactCatalogRead: artifactCatalog,
    });

    await objectStorage.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([1, 2, 3]), {
        descriptor: {
          key: "uploads/session/oversized.txt",
          mediaType: "text/plain",
        },
      }),
      { workspaceId: "workspace-a" },
    );

    const retrieval =
      await mediaRetrieval.retrieveArtifactViewerMediaByStorageKey(
        { storageKey: "uploads/session/oversized.txt", maximumBytes: 2 },
        { workspaceId: "workspace-a" },
      );

    expect(retrieval.ok).toBe(false);
    if (retrieval.ok) throw new Error("Expected bounded read failure.");
    expect(retrieval.error.code).toBe("unavailable");
    expect(retrieval.error.message).toBe(
      "Artifact exceeds the permitted read size.",
    );
    expect(retrieval.error.details).toEqual({
      operation: "retrieveArtifact",
      maximumBytes: 2,
      sizeBytes: 3,
    });
  });

  it("does not let exact content reads bypass catalog workspace ownership", async () => {
    const retrieveCalls: unknown[] = [];
    const retrieveArtifact = async (request: unknown) => {
      retrieveCalls.push(request);
      return {
        ok: true as const,
        value: {
          descriptor: { key: "shared.png", sizeBytes: 1 },
          content: new Uint8Array([9]),
        },
      };
    };
    const adapter = createFilesystemArtifactContentRetrievalAdapter({
      storage: { retrieveArtifact },
      artifactCatalogRead: {
        browseArtifactCatalogRecords: async () => ({
          ok: true as const,
          value: { records: [] },
        }),
        readArtifactCatalogRecord: async () => ({
          ok: true as const,
          value: {
            record: {
              workspaceId: "workspace-b",
              storageKey: "shared.png",
              artifactFamily: "image" as const,
            },
          },
        }),
      },
    });

    const result = await adapter.retrieveArtifactViewerMediaByStorageKey(
      { storageKey: "shared.png" },
      { workspaceId: "workspace-a" },
    );

    expect(result.ok).toBe(false);
    expect(retrieveCalls.length).toBe(0);
  });
});
