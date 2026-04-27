import type {
  ArtifactBrowserLocator,
  ArtifactContentReadSuccessValue,
} from "../../../contracts/artifact-browser";
import type { ContractResult } from "../../../contracts/shared";
import type { ApplicationRequestContext } from "../application-request-context";

export interface ReadArtifactContentRequest {
  locator: ArtifactBrowserLocator;
}

export interface ArtifactBrowserContentReadPort {
  readArtifactContent(
    request: ReadArtifactContentRequest,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ArtifactContentReadSuccessValue>>;
}
