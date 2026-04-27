import type { ArtifactCatalogReadPort } from "../../../../application/ports/artifact-catalog";
import type { ApplicationRequestContext } from "../../../../application/ports";
import type {
  ArtifactContentRetrievalPort,
  RetrieveArtifactViewerMediaByStorageKeyRequest,
} from "../../../../application/ports/artifact-content";
import type { ArtifactObjectStoragePort } from "../../../../application/ports/storage";
import { createContractError, createFailureResult, createSuccessResult } from "../../../../contracts/shared";
import { normalizeStorageArtifactKey } from "../../../../contracts/storage";

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
      const [catalogResult, retrieveResult] = await Promise.all([
        options.artifactCatalogRead.readArtifactCatalogRecord({ storageKey }, context),
        options.storage.retrieveArtifact(
          {
            key: storageKey,
          },
          context,
        ),
      ]);

      if (!catalogResult.ok) {
        return catalogResult;
      }

      if (!retrieveResult.ok) {
        return createFailureResult(
          createContractError(retrieveResult.error.code, retrieveResult.error.message, {
            details: retrieveResult.error.details,
          }),
          context,
        );
      }

      const bytes = retrieveResult.value.content instanceof Uint8Array
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
