import type { ApplicationRequestContext } from "../application-request-context";
import type {
  HasArtifactInRepoRequest,
  HasArtifactInRepoResult,
  RetrieveArtifactFromRepoRequest,
  RetrieveArtifactFromRepoResult,
  StoreArtifactInRepoRequest,
  StoreArtifactInRepoResult,
} from "../../../contracts/storage";

/**
 * Application port for artifact-repo storage family semantics
 * (provider/repository/revision/path oriented).
 */
export interface ArtifactRepoStoragePort {
  storeArtifactInRepo(
    request: StoreArtifactInRepoRequest,
    context?: ApplicationRequestContext,
  ): Promise<StoreArtifactInRepoResult>;

  retrieveArtifactFromRepo(
    request: RetrieveArtifactFromRepoRequest,
    context?: ApplicationRequestContext,
  ): Promise<RetrieveArtifactFromRepoResult>;

  hasArtifactInRepo(
    request: HasArtifactInRepoRequest,
    context?: ApplicationRequestContext,
  ): Promise<HasArtifactInRepoResult>;
}
