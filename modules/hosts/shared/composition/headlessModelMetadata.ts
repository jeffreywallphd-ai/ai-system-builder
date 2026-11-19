import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {createLocalModelRegistryAdapter} from "../../../adapters/persistence/model";
import {ReadHeadlessModelMetadataUseCase} from "../../../application/use-cases/model";
import {isOrganizationId} from "../../../contracts/organization";

/** Pin one organization partition. No feature, runtime, provider or discovery. */
export function composeHeadlessModelMetadata(documents: StructuredDocumentStore, rootDirectory: string) {
  const organizationId = documents.organizationId;
  if (!isOrganizationId(organizationId)) throw new Error("Model metadata requires an organization partition.");
  const partition = documents.forOrganization(organizationId);
  if (partition.organizationId !== organizationId) throw new Error("Model metadata partition is unavailable.");
  return new ReadHeadlessModelMetadataUseCase({organizationId,
    models: createLocalModelRegistryAdapter({documents: partition, rootDirectory,
      filePath: `${rootDirectory}/model-registry/models.json`, discovery: {enabled: false}})});
}
