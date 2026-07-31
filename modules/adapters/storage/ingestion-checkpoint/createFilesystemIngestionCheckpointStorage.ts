import { createHash } from "node:crypto";

import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import type { IngestionCheckpointStoragePort } from "../../../application/ports/ingestion";
import {
  INGESTION_TASK_MAXIMUM_CHUNKS,
  INGESTION_TASK_MAXIMUM_CHUNK_BYTES,
  normalizeIngestionSha256Digest,
} from "../../../contracts/ingestion";
import { createWorkspaceId } from "../../../contracts/workspace";
import {
  deleteContainedFile,
  listContainedFiles,
  readContainedFile,
  removeEmptyContainedParent,
  statContainedFile,
  writeContainedFileStream,
} from "../../filesystem-security";
import { resolveOrganizationStorageKey } from "../filesystem/organizationStorageScope";

export interface CreateFilesystemIngestionCheckpointStorageOptions {
  readonly rootDirectory: string;
  readonly organizationContextProvider?: OrganizationRequestContextProviderPort;
}

export function createFilesystemIngestionCheckpointStorage(options: CreateFilesystemIngestionCheckpointStorageOptions): IngestionCheckpointStoragePort {
  const rootDirectory = options.rootDirectory.trim();
  if (!rootDirectory) throw new Error("Checkpoint rootDirectory is required.");
  const scopedPrefix = (workspaceId: string, checkpointId: string) => resolveOrganizationStorageKey(
    `workspaces/${createWorkspaceId(workspaceId)}/ingestion-checkpoints/${opaqueId(checkpointId)}`,
    options.organizationContextProvider,
  );

  async function entries(workspaceId: string, checkpointId: string): Promise<readonly string[]> {
    const prefix = scopedPrefix(workspaceId, checkpointId);
    const found = (await listContainedFiles({ rootDirectory, prefix, rejectUnsafeEntries: true }).catch((error) => {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    })).sort();
    if (found.length > INGESTION_TASK_MAXIMUM_CHUNKS || found.some((entry, index) => entry !== chunkName(index))) {
      throw new Error("Ingestion checkpoint is malformed or exceeds its chunk limit.");
    }
    return found;
  }

  async function summary(workspaceId: string, checkpointId: string): Promise<{ chunkCount: number; sizeBytes: number }> {
    const prefix = scopedPrefix(workspaceId, checkpointId);
    const found = await entries(workspaceId, checkpointId);
    let sizeBytes = 0;
    for (const entry of found) sizeBytes += (await statContainedFile({ rootDirectory, key: `${prefix}/${entry}` })).size;
    return { chunkCount: found.length, sizeBytes };
  }

  return {
    async appendChunk(request) {
      const prefix = scopedPrefix(request.workspaceId, request.checkpointId);
      const chunkIndex = integer(request.chunkIndex, 0, INGESTION_TASK_MAXIMUM_CHUNKS - 1, "Checkpoint chunk index");
      const expectedOffset = integer(request.expectedOffset, 0, Number.MAX_SAFE_INTEGER, "Checkpoint expected offset");
      if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength < 1 || request.bytes.byteLength > INGESTION_TASK_MAXIMUM_CHUNK_BYTES) throw new Error("Checkpoint chunk bytes must be a bounded non-empty byte array.");
      const expectedDigest = normalizeIngestionSha256Digest(request.sha256);
      const actualDigest = digest(request.bytes);
      if (expectedDigest !== actualDigest) throw new Error("Checkpoint chunk digest does not match its bytes.");
      const current = await summary(request.workspaceId, request.checkpointId);
      if (chunkIndex < current.chunkCount) {
        if (chunkIndex !== current.chunkCount - 1) throw new Error("Only the most recently accepted checkpoint chunk may be retried.");
        const existing = await readContainedFile({ rootDirectory, key: `${prefix}/${chunkName(chunkIndex)}`, maximumBytes: INGESTION_TASK_MAXIMUM_CHUNK_BYTES });
        if (existing.size !== request.bytes.byteLength || digest(existing.content) !== expectedDigest || current.sizeBytes - existing.size !== expectedOffset) throw new Error("Retried checkpoint chunk does not match the accepted chunk.");
        return { ...current, duplicate: true };
      }
      if (chunkIndex !== current.chunkCount || expectedOffset !== current.sizeBytes) throw new Error("Checkpoint chunk is out of order or has a stale offset.");
      const key = `${prefix}/${chunkName(chunkIndex)}`;
      try {
        await writeContainedFileStream({
          rootDirectory,
          key,
          content: singleChunk(request.bytes),
          maximumBytes: INGESTION_TASK_MAXIMUM_CHUNK_BYTES,
          overwrite: false,
        });
      } catch (error) {
        const existing = await readContainedFile({ rootDirectory, key, maximumBytes: INGESTION_TASK_MAXIMUM_CHUNK_BYTES }).catch(() => undefined);
        if (!existing || existing.size !== request.bytes.byteLength || digest(existing.content) !== expectedDigest) throw error;
        return { chunkCount: current.chunkCount + 1, sizeBytes: current.sizeBytes + existing.size, duplicate: true };
      }
      return { chunkCount: current.chunkCount + 1, sizeBytes: current.sizeBytes + request.bytes.byteLength, duplicate: false };
    },
    async *readChunks(input) {
      const expectedChunkCount = integer(input.expectedChunkCount, 0, INGESTION_TASK_MAXIMUM_CHUNKS, "Expected checkpoint chunk count");
      const expectedSizeBytes = integer(input.expectedSizeBytes, 0, Number.MAX_SAFE_INTEGER, "Expected checkpoint size");
      const prefix = scopedPrefix(input.workspaceId, input.checkpointId);
      const found = await entries(input.workspaceId, input.checkpointId);
      if (found.length !== expectedChunkCount) throw new Error("Checkpoint chunk count does not match authoritative task state.");
      let sizeBytes = 0;
      for (const entry of found) {
        const content = await readContainedFile({ rootDirectory, key: `${prefix}/${entry}`, maximumBytes: INGESTION_TASK_MAXIMUM_CHUNK_BYTES });
        sizeBytes += content.size;
        if (sizeBytes > expectedSizeBytes) throw new Error("Checkpoint bytes exceed authoritative task state.");
        yield content.content;
      }
      if (sizeBytes !== expectedSizeBytes) throw new Error("Checkpoint size does not match authoritative task state.");
    },
    async inspectCheckpoint(input) { return summary(input.workspaceId, input.checkpointId); },
    async deleteCheckpoint(input) {
      const prefix = scopedPrefix(input.workspaceId, input.checkpointId);
      const found = await entries(input.workspaceId, input.checkpointId);
      for (const entry of found) await deleteContainedFile({ rootDirectory, key: `${prefix}/${entry}` });
      if (found.length > 0) await removeEmptyContainedParent({ rootDirectory, key: `${prefix}/${found[found.length - 1]}` });
    },
  };
}

function chunkName(index: number): string { return `${index.toString().padStart(8, "0")}.chunk`; }
async function* singleChunk(bytes: Uint8Array): AsyncIterable<Uint8Array> { yield bytes; }
function opaqueId(value: string): string { const normalized = String(value).trim(); if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(normalized)) throw new Error("Checkpoint id must be a bounded opaque identifier."); return normalized; }
function integer(value: number, minimum: number, maximum: number, label: string): number { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} is outside its permitted range.`); return value; }
function digest(bytes: Uint8Array): `sha256:${string}` { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
