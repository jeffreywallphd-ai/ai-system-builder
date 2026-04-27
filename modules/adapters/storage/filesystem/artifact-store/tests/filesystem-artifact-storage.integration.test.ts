import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, testDouble } from "../../../../../testing/node-test";

import {
  createDeleteArtifactRequest,
  createHasArtifactRequest,
  createRetrieveArtifactRequest,
  createStoreArtifactRequest,
} from "../../../../../contracts/storage";
import type { LoggingPort } from "../../../../../application/ports/logging";
import { createFilesystemArtifactObjectStorageAdapter } from "..";

let tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
  tempRoots = [];
});

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "desktop-storage-adapter-"));
  tempRoots.push(root);
  return root;
}

function createLoggingPortMock(log = testDouble.fn<LoggingPort["log"]>().mockResolvedValue(undefined)) {
  return {
    log,
  } satisfies LoggingPort;
}

describe("desktop filesystem artifact-object storage adapter integration", () => {
  function sha256Hex(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
  }

  it("writes artifact bytes to disk under the configured root and returns a contract descriptor", async () => {
    const rootDirectory = await createTempRoot();
    const log = testDouble.fn<LoggingPort["log"]>().mockResolvedValue(undefined);
    const adapter = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      logging: createLoggingPortMock(log),
      now: () => "2026-04-14T12:00:00.000Z",
    });
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const request = createStoreArtifactRequest(bytes, {
      descriptor: {
        key: "uploads/session-1/kitten.png",
        mediaType: "image/png",
        metadata: {
          originalFileName: "kitten.png",
        },
      },
      requestId: "req-store-1",
      correlationId: "corr-store-1",
    });

    const result = await adapter.storeArtifact(request);

    expect(result).toEqual({
      ok: true,
      value: {
        key: "uploads/session-1/kitten.png",
        mediaType: "image/png",
        sizeBytes: bytes.byteLength,
        checksum: {
          algorithm: "sha256",
          value: sha256Hex(bytes),
        },
        metadata: {
          originalFileName: "kitten.png",
        },
      },
      requestId: "req-store-1",
      correlationId: "corr-store-1",
    });

    const writtenBytes = await readFile(
      path.join(rootDirectory, "uploads", "session-1", "kitten.png"),
    );
    expect(new Uint8Array(writtenBytes)).toEqual(bytes);

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]?.[0]).toMatchObject({
      event: "storage.filesystem.store.started",
      operation: "storage.artifact.store",
      component: "adapters.storage.filesystem",
      host: "desktop",
    });
    expect(log.mock.calls[1]?.[0]).toMatchObject({
      event: "storage.filesystem.store.succeeded",
      operation: "storage.artifact.store",
      outcome: "success",
      data: {
        key: "uploads/session-1/kitten.png",
        absolutePath: path.join(rootDirectory, "uploads", "session-1", "kitten.png"),
        sizeBytes: bytes.byteLength,
        checksumAlgorithm: "sha256",
        checksumValue: sha256Hex(bytes),
      },
    });
  });

  it("computes checksum from stored content for generic artifact media types", async () => {
    const rootDirectory = await createTempRoot();
    const adapter = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
    });
    const artifactBytes = new Uint8Array([10, 20, 30, 40, 50]);
    const result = await adapter.storeArtifact(
      createStoreArtifactRequest(artifactBytes, {
        descriptor: {
          key: "artifacts/reports/output.pdf",
          mediaType: "application/pdf",
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected generic artifact store success.");
    }

    expect(result.value.checksum).toEqual({
      algorithm: "sha256",
      value: sha256Hex(artifactBytes),
    });
  });

  it("returns a structured failure when post-write verification cannot stat the stored file", async () => {
    const rootDirectory = await createTempRoot();
    const log = testDouble.fn<LoggingPort["log"]>().mockResolvedValue(undefined);
    const statPath = testDouble.fn().mockRejectedValue(
      Object.assign(new Error("missing file after write"), {
        code: "ENOENT",
      }),
    );
    const adapter = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      logging: createLoggingPortMock(log),
      statPath: statPath as typeof import("node:fs/promises").stat,
    });

    const result = await adapter.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([1, 2, 3]), {
        descriptor: {
          key: "uploads/verifies/missing-after-write.png",
          mediaType: "image/png",
        },
        requestId: "req-verify-fail-1",
        correlationId: "corr-verify-fail-1",
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected post-write verification failure.");
    }

    expect(result.error.code).toBe("not-found");
    expect(result.error.message).toContain("Failed to store artifact bytes");
    expect(result.error.details).toMatchObject({
      operation: "storeArtifact",
      key: "uploads/verifies/missing-after-write.png",
      absolutePath: path.join(rootDirectory, "uploads", "verifies", "missing-after-write.png"),
      filesystemCode: "ENOENT",
    });

    expect(statPath).toHaveBeenCalledWith(
      path.join(rootDirectory, "uploads", "verifies", "missing-after-write.png"),
    );
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]?.[0]).toMatchObject({
      event: "storage.filesystem.store.failed",
      outcome: "failure",
      error: {
        errorType: "storage",
        errorCode: "not-found",
      },
    });
  });

  it("returns a structured failure when post-write verification size mismatches the write payload", async () => {
    const rootDirectory = await createTempRoot();
    const adapter = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      statPath: testDouble.fn().mockResolvedValue({
        isFile: () => true,
        size: 999,
      }) as typeof import("node:fs/promises").stat,
    });

    const result = await adapter.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([9, 8, 7]), {
        descriptor: {
          key: "uploads/verifies/size-mismatch.png",
          mediaType: "image/png",
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected post-write size verification failure.");
    }
    expect(result.error.code).toBe("unavailable");
    expect(result.error.message).toContain("expected 3 bytes but found 999");
    expect(result.error.details).toMatchObject({
      operation: "storeArtifact",
      key: "uploads/verifies/size-mismatch.png",
    });
  });

  it("generates a logical upload key when none is supplied and stores bytes on disk", async () => {
    const rootDirectory = await createTempRoot();
    const adapter = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      now: () => "2026-04-14T12:00:00.000Z",
      randomSuffix: () => "abc123",
    });

    const result = await adapter.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([255, 216, 255]), {
        descriptor: {
          mediaType: "image/jpeg",
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected generated-key store success.");
    }

    expect(result.value.key).toBe("uploads/20260414120000000-abc123.jpg");
    expect(path.isAbsolute(result.value.key)).toBe(false);
    expect(result.value.key.includes(rootDirectory)).toBe(false);

    const writtenBytes = await readFile(
      path.join(rootDirectory, "uploads", "20260414120000000-abc123.jpg"),
    );
    expect(new Uint8Array(writtenBytes)).toEqual(new Uint8Array([255, 216, 255]));
  });

  it("preserves markdown extension when generating a key from original upload metadata", async () => {
    const rootDirectory = await createTempRoot();
    const adapter = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      now: () => "2026-04-14T12:00:00.000Z",
      randomSuffix: () => "abc123",
    });

    const result = await adapter.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([35, 32, 72, 101]), {
        descriptor: {
          mediaType: "text/markdown",
          metadata: {
            originalFileName: "architecture-document-scope-boundaries.md",
          },
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected generated markdown-key store success.");
    }

    expect(result.value.key).toBe("uploads/20260414120000000-abc123.md");
  });

  it("preserves json extension when generating a key from original upload metadata", async () => {
    const rootDirectory = await createTempRoot();
    const adapter = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
      now: () => "2026-04-14T12:00:00.000Z",
      randomSuffix: () => "json123",
    });

    const result = await adapter.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([123, 125]), {
        descriptor: {
          mediaType: "application/json",
          metadata: {
            originalFileName: "schema.json",
          },
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected generated json-key store success.");
    }

    expect(result.value.key).toBe("uploads/20260414120000000-json123.json");
    expect(result.value.key.endsWith(".bin")).toBe(false);
  });

  it("returns a structured conflict failure when overwrite is disabled and key already exists", async () => {
    const rootDirectory = await createTempRoot();
    const adapter = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
    });
    const request = createStoreArtifactRequest(new Uint8Array([1, 2, 3]), {
      descriptor: {
        key: "uploads/conflict/same-key.png",
        mediaType: "image/png",
      },
      overwrite: false,
      requestId: "req-store-conflict",
      correlationId: "corr-store-conflict",
    });

    const firstWrite = await adapter.storeArtifact(request);
    const secondWrite = await adapter.storeArtifact(request);

    expect(firstWrite.ok).toBe(true);
    expect(secondWrite.ok).toBe(false);
    if (secondWrite.ok) {
      throw new Error("Expected second write to fail with a conflict.");
    }

    expect(secondWrite.error.code).toBe("conflict");
    expect(secondWrite.error.message).toContain("already exists");
    expect(secondWrite.error.details).toMatchObject({
      operation: "storeArtifact",
    });
    expect(secondWrite.requestId).toBe("req-store-conflict");
    expect(secondWrite.correlationId).toBe("corr-store-conflict");
  });

  it("returns a structured validation failure when storage key contains traversal segments", async () => {
    const rootDirectory = await createTempRoot();
    const adapter = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
    });

    const result = await adapter.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([1]), {
        descriptor: {
          key: "../outside.png",
          mediaType: "image/png",
        },
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected traversal-key validation failure.");
    }
    expect(result.error.code).toBe("validation");
    expect(result.error.details).toMatchObject({
      operation: "storeArtifact",
    });
  });

  it("retrieves stored bytes, keeps descriptor key logical, and does not leak host paths", async () => {
    const rootDirectory = await createTempRoot();
    const adapter = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
    });
    const storedBytes = new Uint8Array([11, 22, 33, 44]);

    const storeResult = await adapter.storeArtifact(
      createStoreArtifactRequest(storedBytes, {
        descriptor: {
          key: "uploads/retrieve/me.png",
          mediaType: "image/png",
        },
      }),
    );
    expect(storeResult.ok).toBe(true);

    const retrieveResult = await adapter.retrieveArtifact(
      createRetrieveArtifactRequest("uploads/retrieve/me.png", {
        requestId: "req-retrieve-1",
        correlationId: "corr-retrieve-1",
      }),
    );

    expect(retrieveResult.ok).toBe(true);
    if (!retrieveResult.ok) {
      throw new Error("Expected retrieve success for an existing key.");
    }

    expect(retrieveResult.requestId).toBe("req-retrieve-1");
    expect(retrieveResult.correlationId).toBe("corr-retrieve-1");
    expect(retrieveResult.value.descriptor.key).toBe("uploads/retrieve/me.png");
    expect(path.isAbsolute(retrieveResult.value.descriptor.key)).toBe(false);
    expect(retrieveResult.value.descriptor.key.includes(rootDirectory)).toBe(false);
    expect(retrieveResult.value.content).toEqual(storedBytes);
  });

  it("returns has/delete success envelopes that track real filesystem state", async () => {
    const rootDirectory = await createTempRoot();
    const adapter = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
    });
    const key = "uploads/lifecycle/stateful.bin";

    const hasBeforeStore = await adapter.hasArtifact(createHasArtifactRequest(key));
    expect(hasBeforeStore).toEqual({
      ok: true,
      value: {
        exists: false,
        descriptor: undefined,
      },
      requestId: undefined,
      correlationId: undefined,
    });

    const storeResult = await adapter.storeArtifact(
      createStoreArtifactRequest(new Uint8Array([7, 8, 9]), {
        descriptor: { key },
      }),
    );
    expect(storeResult.ok).toBe(true);

    const hasAfterStore = await adapter.hasArtifact(
      createHasArtifactRequest(key, {
        requestId: "req-has-1",
        correlationId: "corr-has-1",
      }),
    );
    expect(hasAfterStore.ok).toBe(true);
    if (!hasAfterStore.ok) {
      throw new Error("Expected hasArtifact success.");
    }
    expect(hasAfterStore.requestId).toBe("req-has-1");
    expect(hasAfterStore.correlationId).toBe("corr-has-1");
    expect(hasAfterStore.value.exists).toBe(true);
    expect(hasAfterStore.value.descriptor).toEqual({
      key,
      sizeBytes: 3,
    });

    const deleteExisting = await adapter.deleteArtifact(
      createDeleteArtifactRequest(key, {
        requestId: "req-delete-1",
        correlationId: "corr-delete-1",
      }),
    );
    expect(deleteExisting).toEqual({
      ok: true,
      value: {
        deleted: true,
      },
      requestId: "req-delete-1",
      correlationId: "corr-delete-1",
    });

    const hasAfterDelete = await adapter.hasArtifact(createHasArtifactRequest(key));
    expect(hasAfterDelete.ok).toBe(true);
    if (!hasAfterDelete.ok) {
      throw new Error("Expected hasArtifact success after deletion.");
    }
    expect(hasAfterDelete.value.exists).toBe(false);

    const deleteMissing = await adapter.deleteArtifact(createDeleteArtifactRequest(key));
    expect(deleteMissing).toEqual({
      ok: true,
      value: {
        deleted: false,
      },
      requestId: undefined,
      correlationId: undefined,
    });
  });

  it("returns not-found retrieve failure for missing keys", async () => {
    const rootDirectory = await createTempRoot();
    const adapter = createFilesystemArtifactObjectStorageAdapter({
      rootDirectory,
    });

    const retrieveMissing = await adapter.retrieveArtifact(
      createRetrieveArtifactRequest("uploads/missing/none.png", {
        requestId: "req-retrieve-missing",
        correlationId: "corr-retrieve-missing",
      }),
    );

    expect(retrieveMissing.ok).toBe(false);
    if (retrieveMissing.ok) {
      throw new Error("Expected missing retrieve failure.");
    }

    expect(retrieveMissing.error.code).toBe("not-found");
    expect(retrieveMissing.error.details).toMatchObject({
      operation: "retrieveArtifact",
    });
    expect(retrieveMissing.requestId).toBe("req-retrieve-missing");
    expect(retrieveMissing.correlationId).toBe("corr-retrieve-missing");
  });
});
