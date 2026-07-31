import type { ArtifactCatalogReadPort } from "../../../../application/ports/artifact-catalog";
import type { ApplicationRequestContext } from "../../../../application/ports";
import type {
  ArtifactContentRetrievalPort,
  RetrieveArtifactViewerMediaByStorageKeyRequest,
} from "../../../../application/ports/artifact-content";
import type { ArtifactObjectStoragePort } from "../../../../application/ports/storage";
import {
  createContractError,
  createFailureResult,
  createSuccessResult,
} from "../../../../contracts/shared";
import { normalizeStorageArtifactKey } from "../../../../contracts/storage";
import { isWorkspaceId } from "../../../../contracts/workspace";

export interface CreateFilesystemArtifactContentRetrievalAdapterOptions {
  storage: Pick<ArtifactObjectStoragePort, "retrieveArtifact">;
  artifactCatalogRead: ArtifactCatalogReadPort;
}

export function createFilesystemArtifactContentRetrievalAdapter(
  options: CreateFilesystemArtifactContentRetrievalAdapterOptions,
): ArtifactContentRetrievalPort {
  return {
    async retrieveArtifactViewerMediaByStorageKey(
      request: RetrieveArtifactViewerMediaByStorageKeyRequest,
      context: ApplicationRequestContext = {},
    ) {
      const storageKey = normalizeStorageArtifactKey(request.storageKey);
      const catalogResult =
        await options.artifactCatalogRead.readArtifactCatalogRecord(
          {
            workspaceId: isWorkspaceId(context.workspaceId)
              ? context.workspaceId
              : undefined,
            storageKey,
          },
          context,
        );

      if (!catalogResult.ok) {
        return catalogResult;
      }

      if (
        catalogResult.value.record.workspaceId !== context.workspaceId ||
        catalogResult.value.record.storageKey !== storageKey
      ) {
        return createFailureResult(
          createContractError(
            "not-found",
            `Artifact not found for storage key \"${storageKey}\".`,
          ),
          context,
        );
      }

      const retrieveResult = await options.storage.retrieveArtifact(
        {
          key: storageKey,
          maximumBytes: request.maximumBytes,
        },
        context,
      );

      if (!retrieveResult.ok) {
        return createFailureResult(
          createContractError(
            retrieveResult.error.code,
            retrieveResult.error.message,
            {
              details: retrieveResult.error.details,
            },
          ),
          context,
        );
      }

      const bytes =
        retrieveResult.value.content instanceof Uint8Array
          ? retrieveResult.value.content
          : new Uint8Array(retrieveResult.value.content as ArrayBufferLike);

      return createSuccessResult(
        {
          storageKey,
          mediaType: catalogResult.value.record.mediaType,
          sizeBytes: bytes.byteLength,
          bytes,
        },
        context,
      );
    },
  };
}
