import { describe, expect, it } from "../../../testing/node-test";
import {
  INGESTION_TASK_MAXIMUM_FILES,
  normalizeIngestionTaskTransportCommand,
  normalizeIngestionSourceRefreshRecord,
  normalizeIngestionSourceSnapshot,
  normalizeIngestionTaskRecord,
  type IngestionSourceRefreshRecord,
  type IngestionSourceSnapshot,
  type IngestionTaskRecord,
} from "..";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const now = "2026-07-30T04:00:00.000Z";

function task(overrides: Partial<IngestionTaskRecord> = {}): IngestionTaskRecord {
  return {
    schemaVersion: "1.0",
    taskId: "ingestion-task-1" as never,
    workspaceId: "workspace-a" as never,
    kind: "file-batch",
    status: "transferring",
    files: [{
      fileId: "file-1" as never,
      checkpointId: "checkpoint-1",
      fileName: "training.jsonl",
      mediaType: "application/jsonl",
      totalBytes: 10,
      status: "transferring",
      acceptedBytes: 4,
      nextChunkIndex: 1,
      lastChunk: { index: 0, sizeBytes: 4, digest: digest("a") },
    }],
    progress: { acceptedBytes: 999, totalBytes: 999, completedItems: 99, totalItems: 99, percent: 99, message: "  Uploading  " },
    revision: 1,
    cleanupPending: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function snapshot(overrides: Partial<IngestionSourceSnapshot> = {}): IngestionSourceSnapshot {
  return {
    schemaVersion: "1.0",
    snapshotId: "snapshot-1" as never,
    sourceId: "source-1" as never,
    workspaceId: "workspace-a" as never,
    locator: { kind: "file", displayName: "Training", originalName: "training.jsonl" },
    contentDigest: digest("b"),
    sizeBytes: 10,
    mediaType: "application/jsonl",
    rawArtifactKey: "workspaces/workspace-a/artifacts/training.jsonl",
    capturedAt: now,
    ...overrides,
  };
}

describe("acquisition task contracts", () => {
  it("derives authoritative bounded progress instead of trusting callers", () => {
    expect(normalizeIngestionTaskRecord(task()).progress).toEqual({
      acceptedBytes: 4,
      totalBytes: 10,
      completedItems: 0,
      totalItems: 1,
      percent: 40,
      message: "Uploading",
    });
  });

  it("rejects unbounded files, paths, invalid chunk order, and dishonest completion", () => {
    expect(() => normalizeIngestionTaskRecord(task({ files: Array.from({ length: INGESTION_TASK_MAXIMUM_FILES + 1 }, (_, index) => ({ ...task().files[0]!, fileId: `file-${index}` as never, checkpointId: `checkpoint-${index}` })) }))).toThrow("between 1 and");
    expect(() => normalizeIngestionTaskRecord(task({ files: [{ ...task().files[0]!, fileName: "../secret.csv" }] }))).toThrow("must not contain a path");
    expect(() => normalizeIngestionTaskRecord(task({ files: [{ ...task().files[0]!, nextChunkIndex: 2 }] }))).toThrow("immediately precede");
    expect(() => normalizeIngestionTaskRecord(task({ status: "succeeded", cleanupPending: false, completedAt: now }))).toThrow("every file");
  });

  it("requires exact provider revisions and robots evidence without credential-bearing URLs", () => {
    expect(normalizeIngestionSourceSnapshot(snapshot({
      locator: { kind: "hugging-face", displayName: "Data", repository: "owner/data", path: "data/train.parquet", revision: "abc1234" },
      providerRevision: "abc1234",
    })).providerRevision).toBe("abc1234");
    expect(() => normalizeIngestionSourceSnapshot(snapshot({
      locator: { kind: "hugging-face", displayName: "Data", repository: "owner/data", path: "data/train.parquet", revision: "abc1234" },
      providerRevision: "main",
    }))).toThrow("exact selected revision");
    expect(() => normalizeIngestionSourceSnapshot(snapshot({
      locator: { kind: "hugging-face", displayName: "Data", repository: "owner/data", path: "data/train.parquet", revision: "main" },
      providerRevision: "main",
    }))).toThrow("immutable commit SHA");
    expect(() => normalizeIngestionSourceSnapshot(snapshot({
      locator: { kind: "website", displayName: "Docs", requestedUrl: "https://user:secret@example.com/docs", canonicalUrl: "https://example.com/docs" },
    }))).toThrow("must not include credentials");
    expect(() => normalizeIngestionSourceSnapshot(snapshot({
      locator: { kind: "website", displayName: "Docs", requestedUrl: "https://example.com/docs", canonicalUrl: "https://example.com/docs" },
    }))).toThrow("robots decision");
  });

  it("derives zero-byte provider progress from completed items", () => {
    const source = { provider: "huggingface" as const, repository: "owner/data", path: "data/train.parquet", revision: "a".repeat(40) };
    const pending = normalizeIngestionTaskRecord(task({
      kind: "hugging-face",
      status: "queued",
      files: [{ ...task().files[0]!, totalBytes: 0, acceptedBytes: 0, nextChunkIndex: 0, lastChunk: undefined, status: "pending", providerSource: source }],
      cleanupPending: false,
    }));
    expect(pending.progress.percent).toBe(0);
    const complete = normalizeIngestionTaskRecord({
      ...pending,
      status: "succeeded",
      files: [{ ...pending.files[0]!, status: "finalized", output: { key: "artifact-1", mediaType: "application/octet-stream", sizeBytes: 0, providerRevision: source.revision } }],
      completedAt: now,
    });
    expect(complete.progress).toMatchObject({ completedItems: 1, totalItems: 1, percent: 100 });
  });

  it("models unchanged, changed, unavailable, and removed refreshes honestly", () => {
    const base: IngestionSourceRefreshRecord = { schemaVersion: "1.0", refreshId: "refresh-1" as never, sourceId: "source-1" as never, workspaceId: "workspace-a" as never, previousSnapshotId: "snapshot-1" as never, currentSnapshotId: "snapshot-1" as never, outcome: "unchanged", checkedAt: now, summary: "No changes found." };
    expect(normalizeIngestionSourceRefreshRecord(base).outcome).toBe("unchanged");
    expect(normalizeIngestionSourceRefreshRecord({ ...base, refreshId: "refresh-2" as never, outcome: "changed", currentSnapshotId: "snapshot-2" as never }).outcome).toBe("changed");
    expect(normalizeIngestionSourceRefreshRecord({ ...base, refreshId: "refresh-3" as never, outcome: "unavailable", currentSnapshotId: undefined }).outcome).toBe("unavailable");
    expect(normalizeIngestionSourceRefreshRecord({ ...base, refreshId: "refresh-4" as never, outcome: "removed", currentSnapshotId: undefined }).outcome).toBe("removed");
    expect(() => normalizeIngestionSourceRefreshRecord({ ...base, outcome: "unchanged", currentSnapshotId: "snapshot-2" as never })).toThrow("retain the previous snapshot");
  });

  it("normalizes bounded transport commands and accepts JSON byte arrays", () => {
    expect(normalizeIngestionTaskTransportCommand({
      action: "append-chunk",
      taskId: "task-1",
      fileId: "file-1",
      chunkIndex: 0,
      expectedOffset: 0,
      bytes: [1, 2, 3] as never,
      sha256: digest("a"),
    })).toMatchObject({ action: "append-chunk", bytes: new Uint8Array([1, 2, 3]) });
    expect(normalizeIngestionTaskTransportCommand({
      action: "create-website",
      scope: { kind: "pages", urls: ["https://example.com/docs#start"], maximumPages: 1 },
    })).toEqual({
      action: "create-website",
      scope: { kind: "pages", urls: ["https://example.com/docs"], maximumPages: 1 },
    });
    expect(normalizeIngestionTaskTransportCommand({ action: "finalize-file", taskId: "task-1", fileId: "file-1" }))
      .toEqual({ action: "finalize-file", taskId: "task-1", fileId: "file-1" });
  });

  it("rejects mutable provider revisions, credential-bearing URLs, and unbounded command inputs", () => {
    expect(() => normalizeIngestionTaskTransportCommand({
      action: "create-hugging-face",
      files: [{ repository: "owner/data", path: "train.parquet", revision: "main" }],
    })).toThrow("immutable commit SHA");
    expect(() => normalizeIngestionTaskTransportCommand({
      action: "create-website",
      scope: { kind: "pages", urls: ["https://user:secret@example.com/docs"] },
    })).toThrow("without credentials");
    expect(() => normalizeIngestionTaskTransportCommand({
      action: "create-files",
      files: Array.from({ length: INGESTION_TASK_MAXIMUM_FILES + 1 }, (_, index) => ({
        fileName: `file-${index}.jsonl`, mediaType: "application/jsonl", sizeBytes: 1,
      })),
    })).toThrow("Select between 1 and");
    expect(() => normalizeIngestionTaskTransportCommand({
      action: "append-chunk", taskId: "task-1", fileId: "file-1", chunkIndex: 0,
      expectedOffset: 0, bytes: [] as never, sha256: digest("a"),
    })).toThrow("Chunk bytes must contain");
  });
});
