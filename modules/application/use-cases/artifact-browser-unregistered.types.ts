import type {
  RegisterUnregisteredArtifactSuccessValue,
  UnregisteredArtifactBrowseSuccessValue,
} from "../../contracts/artifact-browser";
import type { ContractErrorDetails, ContractResult } from "../../contracts/shared";
import type { ApplicationRequestContext } from "../ports";

export interface RegisterUnregisteredArtifactCommand {
  storageKey: string;
}

export interface DeleteUnregisteredArtifactCommand {
  storageKey: string;
}

export type ArtifactBrowserUnregisteredCommandContext = ApplicationRequestContext;

export type BrowseUnregisteredArtifactsUseCaseResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
> = ContractResult<UnregisteredArtifactBrowseSuccessValue, TDetails>;

export type RegisterUnregisteredArtifactUseCaseResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
> = ContractResult<RegisterUnregisteredArtifactSuccessValue, TDetails>;

export type DeleteUnregisteredArtifactUseCaseResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
> = ContractResult<{ storageKey: string }, TDetails>;
