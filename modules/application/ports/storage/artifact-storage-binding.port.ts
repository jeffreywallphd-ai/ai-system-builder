import type { ApplicationRequestContext } from "../application-request-context";
import type { ContractResult } from "../../../contracts/shared";
import type { ArtifactStorageBinding } from "../../../contracts/storage";

export interface UpsertArtifactStorageBindingRequest {
  binding: ArtifactStorageBinding;
}

export interface ReadArtifactStorageBindingsRequest {
  artifactId: string;
}

export interface DeleteArtifactStorageBindingsRequest {
  artifactId: string;
}

export interface ArtifactStorageBindingPort {
  upsertArtifactStorageBinding(
    request: UpsertArtifactStorageBindingRequest,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<{ binding: ArtifactStorageBinding }>>;

  readArtifactStorageBindings(
    request: ReadArtifactStorageBindingsRequest,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<{ bindings: ArtifactStorageBinding[] }>>;

  deleteArtifactStorageBindings(
    request: DeleteArtifactStorageBindingsRequest,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<{ deleted: boolean }>>;
}
