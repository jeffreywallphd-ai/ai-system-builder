import type {
  ArtifactBrowserLocator,
  ArtifactBrowseSuccessValue,
  ArtifactReadSuccessValue,
} from "../../../contracts/artifact-browser";
import type { ContractResult } from "../../../contracts/shared";
import type { StorageObjectMetadata } from "../../../contracts/storage";
import type { ArtifactFamily } from "../../../domain/artifact";
import type { ApplicationRequestContext } from "../application-request-context";

export interface BrowseArtifactsRequest {
  artifactFamily?: ArtifactFamily;
}

export interface ReadArtifactDetailRequest {
  locator: ArtifactBrowserLocator;
}

export interface ArtifactBrowserMetadataReadPort {
  browseArtifacts(
    request: BrowseArtifactsRequest,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ArtifactBrowseSuccessValue>>;

  readArtifactDetail<TMetadata extends StorageObjectMetadata = StorageObjectMetadata>(
    request: ReadArtifactDetailRequest,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ArtifactReadSuccessValue<TMetadata>>>;
}
