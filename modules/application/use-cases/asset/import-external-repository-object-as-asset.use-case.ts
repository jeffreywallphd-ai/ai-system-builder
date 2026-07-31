import type { ImportExternalRepositoryObjectCommand } from "../../../contracts/asset";
import {
  validateImportExternalRepositoryObjectMutationGuard,
} from "../../services/asset";
import {
  ExternalRepositoryObjectAsAssetWorkflow,
  type ExternalRepositoryObjectAsAssetWorkflowDependencies,
} from "./external-repository-object-as-asset-workflow";

export type ImportExternalRepositoryObjectAsAssetUseCaseDependencies =
  ExternalRepositoryObjectAsAssetWorkflowDependencies;

export class ImportExternalRepositoryObjectAsAssetUseCase {
  private readonly workflow: ExternalRepositoryObjectAsAssetWorkflow<ImportExternalRepositoryObjectCommand>;

  public constructor(dependencies: ImportExternalRepositoryObjectAsAssetUseCaseDependencies) {
    this.workflow = new ExternalRepositoryObjectAsAssetWorkflow(dependencies, {
      operation: "asset.import-external-repository-object",
      portOperation: "import",
      successStateSummary: "Imported external repository object asset instance.",
      metadataFlag: "externalRepositoryObjectImport",
      validateGuard: validateImportExternalRepositoryObjectMutationGuard,
    });
  }

  public execute(command: ImportExternalRepositoryObjectCommand) {
    return this.workflow.execute(command);
  }
}
