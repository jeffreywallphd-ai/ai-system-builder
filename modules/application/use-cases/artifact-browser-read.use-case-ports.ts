import type {
  BrowseArtifactsCommand,
  BrowseArtifactsUseCaseResult,
  ReadArtifactContentCommand,
  ReadArtifactContentUseCaseResult,
  ReadArtifactDetailCommand,
  ReadArtifactDetailUseCaseResult,
  ArtifactBrowserCommandContext,
} from "./artifact-browser-read.types";
import type {
  ArtifactBrowserUnregisteredCommandContext,
  BrowseUnregisteredArtifactsUseCaseResult,
  DeleteUnregisteredArtifactCommand,
  DeleteUnregisteredArtifactUseCaseResult,
  RegisterUnregisteredArtifactCommand,
  RegisterUnregisteredArtifactUseCaseResult,
} from "./artifact-browser-unregistered.types";
import type { DeleteRegisteredArtifactCommand } from "./delete-registered-artifact.use-case";

export interface BrowseArtifactsUseCasePort {
  execute: (
    command: BrowseArtifactsCommand,
    context?: ArtifactBrowserCommandContext,
  ) => Promise<BrowseArtifactsUseCaseResult>;
}

export interface ReadArtifactDetailUseCasePort {
  execute: (
    command: ReadArtifactDetailCommand,
    context?: ArtifactBrowserCommandContext,
  ) => Promise<ReadArtifactDetailUseCaseResult>;
}

export interface ReadArtifactContentUseCasePort {
  execute: (
    command: ReadArtifactContentCommand,
    context?: ArtifactBrowserCommandContext,
  ) => Promise<ReadArtifactContentUseCaseResult>;
}

export interface BrowseUnregisteredArtifactsUseCasePort {
  execute: (
    context?: ArtifactBrowserUnregisteredCommandContext,
  ) => Promise<BrowseUnregisteredArtifactsUseCaseResult>;
}

export interface RegisterUnregisteredArtifactUseCasePort {
  execute: (
    command: RegisterUnregisteredArtifactCommand,
    context?: ArtifactBrowserUnregisteredCommandContext,
  ) => Promise<RegisterUnregisteredArtifactUseCaseResult>;
}

export interface DeleteUnregisteredArtifactUseCasePort {
  execute: (
    command: DeleteUnregisteredArtifactCommand,
    context?: ArtifactBrowserUnregisteredCommandContext,
  ) => Promise<DeleteUnregisteredArtifactUseCaseResult>;
}

export interface DeleteRegisteredArtifactUseCasePort {
  execute: (
    command: DeleteRegisteredArtifactCommand,
    context?: ArtifactBrowserUnregisteredCommandContext,
  ) => Promise<DeleteUnregisteredArtifactUseCaseResult>;
}
