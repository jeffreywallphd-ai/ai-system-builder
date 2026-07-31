import type {
  RegisterStagedArtifactResult,
  StagedArtifactMetadata,
} from "../../contracts/ingestion";
import type { ContractErrorDetails } from "../../contracts/shared";

export { ARTIFACT_UPLOAD_MAXIMUM_BYTES } from "../../contracts/artifact-upload";

export interface StoreArtifactUploadCommand {
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface StoreArtifactUploadCommandContext {
  source: string;
  workspaceId?: string;
}

export type StoreArtifactUploadUseCaseResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
> = RegisterStagedArtifactResult<TDetails, TMetadata>;
