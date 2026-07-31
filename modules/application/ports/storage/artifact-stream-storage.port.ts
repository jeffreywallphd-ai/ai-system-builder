import type { StorageObjectDescriptorInput, StoreArtifactResult } from "../../../contracts/storage";
import type { ApplicationRequestContext } from "../application-request-context";

export interface StoreArtifactStreamRequest {
  readonly content: AsyncIterable<Uint8Array>;
  readonly descriptor: StorageObjectDescriptorInput;
  readonly maximumBytes: number;
  readonly expectedSizeBytes: number;
  readonly expectedSha256?: string;
  readonly overwrite?: boolean;
  readonly requestId?: string;
  readonly correlationId?: string;
}

export interface ArtifactStreamStoragePort {
  storeArtifactStream(request: StoreArtifactStreamRequest, context?: ApplicationRequestContext): Promise<StoreArtifactResult>;
}
