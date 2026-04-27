import {
  createContractError,
  createFailureResult,
  createSuccessResult,
} from "../../contracts/shared";
import type { ApplicationRequestContext } from "../ports";
import type { ArtifactCatalogDeletePort, ArtifactCatalogReadPort } from "../ports/artifact-catalog";
import type { ArtifactObjectStoragePort, ArtifactStorageBindingPort } from "../ports/storage";

export interface DeleteRegisteredArtifactCommand {
  storageKey: string;
}

export interface DeleteRegisteredArtifactUseCaseDependencies {
  artifactCatalogRead: Pick<ArtifactCatalogReadPort, "readArtifactCatalogRecord">;
  artifactCatalogDelete: ArtifactCatalogDeletePort;
  storage: Pick<ArtifactObjectStoragePort, "deleteArtifact">;
  artifactBindingStorage: Pick<ArtifactStorageBindingPort, "deleteArtifactStorageBindings">;
}

type RegisteredDeleteStepStatus = "not-attempted" | "succeeded" | "failed";

export class DeleteRegisteredArtifactUseCase {
  private readonly artifactCatalogRead: Pick<ArtifactCatalogReadPort, "readArtifactCatalogRecord">;
  private readonly artifactCatalogDelete: ArtifactCatalogDeletePort;
  private readonly storage: Pick<ArtifactObjectStoragePort, "deleteArtifact">;
  private readonly artifactBindingStorage: Pick<ArtifactStorageBindingPort, "deleteArtifactStorageBindings">;

  public constructor(dependencies: DeleteRegisteredArtifactUseCaseDependencies) {
    this.artifactCatalogRead = dependencies.artifactCatalogRead;
    this.artifactCatalogDelete = dependencies.artifactCatalogDelete;
    this.storage = dependencies.storage;
    this.artifactBindingStorage = dependencies.artifactBindingStorage;
  }

  public async execute(command: DeleteRegisteredArtifactCommand, context: ApplicationRequestContext = {}) {
    if (!command.storageKey?.trim()) {
      return createFailureResult(
        createContractError("validation", "storageKey must be a non-empty string."),
        context,
      );
    }

    const storageKey = command.storageKey.trim();

    // Registered-delete semantics:
    // 1) Confirm registration exists in catalog.
    // 2) Delete local imported-source bindings.
    // 3) Delete local object bytes.
    // 4) Delete catalog registration last.
    //
    // Remote provider assets are never deleted by this flow.
    // Rollback across steps is not available; failures return explicit partial-cleanup details.
    // Missing local object/bindings are treated as acceptable local state and do not block catalog cleanup.
    const progress = {
      bindings: { status: "not-attempted" as RegisteredDeleteStepStatus, deleted: false },
      localObject: { status: "not-attempted" as RegisteredDeleteStepStatus, deleted: false },
      catalog: { status: "not-attempted" as RegisteredDeleteStepStatus, deleted: false },
    };

    const createPartialFailure = (
      message: string,
      failedStep: "delete-bindings" | "delete-local-object" | "delete-catalog",
      cause?: unknown,
      code: "unavailable" | "not-found" = "unavailable",
    ) =>
      createFailureResult(
        createContractError(code, message, {
          details: {
            storageKey,
            semantics: "registered-local-state-delete",
            rollbackAvailable: false,
            failedStep,
            progress: {
              bindings: {
                status: progress.bindings.status,
                deleted: progress.bindings.deleted,
              },
              localObject: {
                status: progress.localObject.status,
                deleted: progress.localObject.deleted,
                missingAccepted: progress.localObject.status === "succeeded" && !progress.localObject.deleted,
              },
              catalog: {
                status: progress.catalog.status,
                deleted: progress.catalog.deleted,
              },
            },
            partialCleanup: {
              bindingsDeleted: progress.bindings.deleted,
              bindingsAlreadyMissing: progress.bindings.status === "succeeded" && !progress.bindings.deleted,
              localObjectDeleted: progress.localObject.deleted,
              localObjectAlreadyMissing: progress.localObject.status === "succeeded" && !progress.localObject.deleted,
              catalogRecordDeleted: progress.catalog.deleted,
            },
            cause,
          },
        }),
        context,
      );

    const readCatalog = await this.artifactCatalogRead.readArtifactCatalogRecord({
      storageKey,
    }, context);

    if (!readCatalog.ok) {
      if (readCatalog.error.code === "not-found") {
        return createFailureResult(
          createContractError("not-found", `Artifact \"${storageKey}\" is not registered.`),
          context,
        );
      }
      return readCatalog;
    }

    progress.bindings.status = "failed";
    const deleteBindings = await this.artifactBindingStorage.deleteArtifactStorageBindings({
      artifactId: storageKey,
    }, context);
    if (!deleteBindings.ok) {
      return createPartialFailure(
        "Failed to delete artifact backing bindings for registered artifact.",
        "delete-bindings",
        deleteBindings.error,
      );
    }
    progress.bindings.status = "succeeded";
    progress.bindings.deleted = deleteBindings.value.deleted;

    progress.localObject.status = "failed";
    const deleteLocalObject = await this.storage.deleteArtifact({ key: storageKey }, context);
    if (!deleteLocalObject.ok) {
      return createPartialFailure(
        "Failed to delete local artifact object for registered artifact.",
        "delete-local-object",
        deleteLocalObject.error,
      );
    }
    progress.localObject.status = "succeeded";
    progress.localObject.deleted = deleteLocalObject.value.deleted;

    progress.catalog.status = "failed";
    const deleteCatalog = await this.artifactCatalogDelete.deleteArtifactCatalogRecord({
      storageKey,
    }, context);

    if (!deleteCatalog.ok) {
      return createPartialFailure(
        "Local artifact state was cleaned up but catalog deletion failed.",
        "delete-catalog",
        deleteCatalog.error,
      );
    }

    if (!deleteCatalog.value.deleted) {
      return createPartialFailure(
        `Catalog record for artifact \"${storageKey}\" was not deleted after local cleanup.`,
        "delete-catalog",
        undefined,
        "not-found",
      );
    }
    progress.catalog.status = "succeeded";
    progress.catalog.deleted = true;

    return createSuccessResult({ storageKey }, context);
  }
}
