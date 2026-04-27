import type {
  RegisterUnregisteredArtifactSuccessValue,
  UnregisteredArtifactBrowseSuccessValue,
} from "../../../contracts/artifact-browser";
import type { ContractResult } from "../../../contracts/shared";
import type { ApplicationRequestContext } from "../application-request-context";

export interface ArtifactBrowserUnregisteredPort {
  browseUnregisteredArtifacts(
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<UnregisteredArtifactBrowseSuccessValue>>;

  registerUnregisteredArtifact(
    request: { storageKey: string },
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<RegisterUnregisteredArtifactSuccessValue>>;

  deleteUnregisteredArtifact(
    request: { storageKey: string },
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<{ storageKey: string }>>;
}
