import type { ApplicationRequestContext } from "../application-request-context";
import type {
  DeleteArtifactRequest,
  DeleteArtifactResult,
  HasArtifactRequest,
  HasArtifactResult,
  RetrieveArtifactRequest,
  RetrieveArtifactResult,
  StoreArtifactRequest,
  StoreArtifactResult,
} from "../../../contracts/storage";

/**
 * Application port for the artifact-object storage family (key/blob oriented).
 */
export interface ArtifactObjectStoragePort {
  storeArtifact<TContent = Uint8Array>(
    request: StoreArtifactRequest<TContent>,
    context?: ApplicationRequestContext,
  ): Promise<StoreArtifactResult>;

  retrieveArtifact<TContent = Uint8Array>(
    request: RetrieveArtifactRequest,
    context?: ApplicationRequestContext,
  ): Promise<RetrieveArtifactResult<TContent>>;

  hasArtifact(
    request: HasArtifactRequest,
    context?: ApplicationRequestContext,
  ): Promise<HasArtifactResult>;

  deleteArtifact(
    request: DeleteArtifactRequest,
    context?: ApplicationRequestContext,
  ): Promise<DeleteArtifactResult>;
}
