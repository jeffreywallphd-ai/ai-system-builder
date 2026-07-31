import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "../../../../testing/node-test";
import { createHasArtifactRequest } from "../../../../contracts/storage";
import { createFilesystemArtifactObjectStorageAdapter } from "../../filesystem/artifact-store";
import { createFilesystemIngestionCheckpointStorage } from "../createFilesystemIngestionCheckpointStorage";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function root(label: string): Promise<string> { const value = await mkdtemp(join(tmpdir(), label)); roots.push(value); return value; }
const sha = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

describe("filesystem ingestion checkpoint and stream storage", () => {
  it("accepts ordered bounded chunks, makes only the last retry idempotent, streams them, and cleans them", async () => {
    const directory = await root("ingestion-checkpoint-");
    const checkpoints = createFilesystemIngestionCheckpointStorage({ rootDirectory: directory });
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([4, 5]);
    await expect(checkpoints.appendChunk({ workspaceId: "workspace-a", checkpointId: "checkpoint-1", chunkIndex: 0, expectedOffset: 0, bytes: first, sha256: sha(first) })).resolves.toEqual({ chunkCount: 1, sizeBytes: 3, duplicate: false });
    await expect(checkpoints.appendChunk({ workspaceId: "workspace-a", checkpointId: "checkpoint-1", chunkIndex: 0, expectedOffset: 0, bytes: first, sha256: sha(first) })).resolves.toEqual({ chunkCount: 1, sizeBytes: 3, duplicate: true });
    await expect(checkpoints.appendChunk({ workspaceId: "workspace-a", checkpointId: "checkpoint-1", chunkIndex: 2, expectedOffset: 3, bytes: second, sha256: sha(second) })).rejects.toThrow("out of order");
    await expect(checkpoints.appendChunk({ workspaceId: "workspace-a", checkpointId: "checkpoint-1", chunkIndex: 1, expectedOffset: 3, bytes: second, sha256: sha(first) })).rejects.toThrow("digest");
    await checkpoints.appendChunk({ workspaceId: "workspace-a", checkpointId: "checkpoint-1", chunkIndex: 1, expectedOffset: 3, bytes: second, sha256: sha(second) });
    const chunks: number[][] = [];
    for await (const chunk of checkpoints.readChunks({ workspaceId: "workspace-a", checkpointId: "checkpoint-1", expectedChunkCount: 2, expectedSizeBytes: 5 })) chunks.push([...chunk]);
    expect(chunks).toEqual([[1, 2, 3], [4, 5]]);
    await checkpoints.deleteCheckpoint({ workspaceId: "workspace-a", checkpointId: "checkpoint-1" });
    await expect(checkpoints.inspectCheckpoint({ workspaceId: "workspace-a", checkpointId: "checkpoint-1" })).resolves.toEqual({ chunkCount: 0, sizeBytes: 0 });
  });

  it("finalizes an async stream atomically with exact size and digest and removes failed output", async () => {
    const directory = await root("ingestion-stream-");
    const storage = createFilesystemArtifactObjectStorageAdapter({ rootDirectory: directory, now: () => "2026-07-30T04:00:00.000Z" });
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    async function* content() { yield bytes.slice(0, 2); yield bytes.slice(2); }
    const result = await storage.storeArtifactStream({ content: content(), descriptor: { key: "workspaces/workspace-a/artifacts/files/train.jsonl", mediaType: "application/jsonl", metadata: { originalFileName: "train.jsonl" } }, maximumBytes: 5, expectedSizeBytes: 5, expectedSha256: sha(bytes) }, { workspaceId: "workspace-a" });
    expect(result).toMatchObject({ ok: true, value: { sizeBytes: 5, checksum: { algorithm: "sha256", value: sha(bytes).slice(7) } } });
    expect([...await readFile(join(directory, "workspaces", "workspace-a", "artifacts", "files", "train.jsonl"))]).toEqual([...bytes]);
    async function* wrong() { yield bytes; }
    const failed = await storage.storeArtifactStream({ content: wrong(), descriptor: { key: "workspaces/workspace-a/artifacts/files/wrong.jsonl", mediaType: "application/jsonl" }, maximumBytes: 5, expectedSizeBytes: 4 }, { workspaceId: "workspace-a" });
    expect(failed.ok).toBe(false);
    await expect(storage.hasArtifact(createHasArtifactRequest("workspaces/workspace-a/artifacts/files/wrong.jsonl"))).resolves.toMatchObject({ ok: true, value: { exists: false } });
  });
});
