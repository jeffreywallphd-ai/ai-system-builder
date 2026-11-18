import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {createStructuredIngestionAcquisitionRepository} from "../../../adapters/persistence/ingestion";
import {createStructuredDatasetVersionRepository} from "../../../adapters/persistence/dataset-version";
import {createLocalModelRegistryAdapter} from "../../../adapters/persistence/model";
import {PreviewHeadlessContextInputsUseCase} from "../../../application/use-cases/context-management/headless-context-preview.use-case";

/** Organization partition only. No active Context, runtime, discovery or artifact-byte dependencies. */
export function composeHeadlessContextPreview(documents: StructuredDocumentStore, rootDirectory: string) {
  if (!documents.organizationId) throw new Error("Context preview requires an organization partition.");
  return new PreviewHeadlessContextInputsUseCase({sources: createStructuredIngestionAcquisitionRepository(documents),
    versions: createStructuredDatasetVersionRepository(documents),
    models: createLocalModelRegistryAdapter({filePath: `${rootDirectory}/model-registry/models.json`, rootDirectory,
      documents, discovery: {enabled: false}})});
}
