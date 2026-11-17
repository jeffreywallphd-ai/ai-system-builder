import { createStructuredIngestionAcquisitionRepository } from "../../../adapters/persistence/ingestion";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createLocalArtifactCatalogPersistenceAdapter, createLocalArtifactStorageBindingAdapter } from "../../../adapters/storage/filesystem";

/** Use the ingestion transaction's owner for both new provider records. */
export function composeIngestionAcquisitionRepository(rootDirectory: string, documents: StructuredDocumentStore) {
  return createStructuredIngestionAcquisitionRepository(documents, async (owner, artifact) => {
    const options = { rootDirectory, documents: owner };
    const context = { workspaceId: artifact.catalog.workspaceId, organizationId: owner.organizationId };
    const catalog = createLocalArtifactCatalogPersistenceAdapter(options);
    const stored = await catalog.createArtifactCatalogRecordIfAbsent({ record: artifact.catalog }, context);
    if (!stored.ok || stored.value.storageKey !== artifact.catalog.storageKey)
      throw new Error("The provider artifact catalog record could not be created.");
    const bindings = createLocalArtifactStorageBindingAdapter(options);
    const bound = await bindings.createArtifactStorageBindingIfAbsent({ binding: artifact.binding }, context);
    if (!bound.ok || bound.value.binding.artifactId !== artifact.binding.artifactId ||
        bound.value.binding.workspaceId !== artifact.binding.workspaceId)
      throw new Error("The provider artifact backing could not be created.");
  });
}
