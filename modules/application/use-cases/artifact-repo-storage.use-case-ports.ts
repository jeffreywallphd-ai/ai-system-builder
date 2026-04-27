import type { ApplicationRequestContext } from "../ports";
import type {
  ArtifactRepoTarget,
  HasArtifactInRepoResult,
  RetrieveArtifactFromRepoResult,
  StoreArtifactInRepoResult,
} from "../../contracts/storage";

export interface HasArtifactInRepoCommand {
  target: ArtifactRepoTarget;
}

export interface StoreArtifactInRepoCommand {
  target: ArtifactRepoTarget;
  content: Uint8Array;
  mediaType?: string;
  metadata?: Readonly<Record<string, unknown>>;
  overwrite?: boolean;
}

export interface RetrieveArtifactFromRepoCommand {
  target: ArtifactRepoTarget;
}

export type ArtifactRepoStorageCommandContext = ApplicationRequestContext;

export interface HasArtifactInRepoUseCasePort {
  execute: (
    command: HasArtifactInRepoCommand,
    context?: ArtifactRepoStorageCommandContext,
  ) => Promise<HasArtifactInRepoResult>;
}

export interface StoreArtifactInRepoUseCasePort {
  execute: (
    command: StoreArtifactInRepoCommand,
    context?: ArtifactRepoStorageCommandContext,
  ) => Promise<StoreArtifactInRepoResult>;
}

export interface RetrieveArtifactFromRepoUseCasePort {
  execute: (
    command: RetrieveArtifactFromRepoCommand,
    context?: ArtifactRepoStorageCommandContext,
  ) => Promise<RetrieveArtifactFromRepoResult>;
}
