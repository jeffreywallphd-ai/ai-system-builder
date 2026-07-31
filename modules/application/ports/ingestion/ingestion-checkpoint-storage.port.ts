import type { ApplicationRequestContext } from "../application-request-context";

export interface AppendIngestionCheckpointChunkRequest {
  readonly workspaceId: string;
  readonly checkpointId: string;
  readonly chunkIndex: number;
  readonly expectedOffset: number;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

export interface IngestionCheckpointSummary {
  readonly chunkCount: number;
  readonly sizeBytes: number;
}

export interface IngestionCheckpointStoragePort {
  appendChunk(request: AppendIngestionCheckpointChunkRequest, context?: ApplicationRequestContext): Promise<IngestionCheckpointSummary & { readonly duplicate: boolean }>;
  readChunks(input: { workspaceId: string; checkpointId: string; expectedChunkCount: number; expectedSizeBytes: number }, context?: ApplicationRequestContext): AsyncIterable<Uint8Array>;
  inspectCheckpoint(input: { workspaceId: string; checkpointId: string }, context?: ApplicationRequestContext): Promise<IngestionCheckpointSummary>;
  deleteCheckpoint(input: { workspaceId: string; checkpointId: string }, context?: ApplicationRequestContext): Promise<void>;
}
