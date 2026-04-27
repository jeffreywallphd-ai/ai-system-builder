import type {
  ArtifactBrowseSuccessValue,
  ArtifactContentReadSuccessValue,
  ArtifactReadSuccessValue,
} from "../../contracts/artifact-browser";
import type { ContractErrorDetails, ContractResult } from "../../contracts/shared";
import type { StorageObjectMetadata } from "../../contracts/storage";
import type {
  ApplicationRequestContext,
  BrowseArtifactsRequest,
  ReadArtifactContentRequest,
  ReadArtifactDetailRequest,
} from "../ports/artifact-browser";

export type BrowseArtifactsCommand = BrowseArtifactsRequest;

export type ReadArtifactDetailCommand = ReadArtifactDetailRequest;

export type ReadArtifactContentCommand = ReadArtifactContentRequest;

export type ArtifactBrowserCommandContext = ApplicationRequestContext;

export type BrowseArtifactsUseCaseResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
> = ContractResult<ArtifactBrowseSuccessValue, TDetails>;

export type ReadArtifactDetailUseCaseResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
> = ContractResult<ArtifactReadSuccessValue<TMetadata>, TDetails>;

export type ReadArtifactContentUseCaseResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
> = ContractResult<ArtifactContentReadSuccessValue, TDetails>;
