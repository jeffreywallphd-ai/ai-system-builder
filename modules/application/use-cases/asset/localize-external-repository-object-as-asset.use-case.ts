import type { LocalizeExternalRepositoryObjectCommand } from "../../../contracts/asset";
import {
  validateLocalizeExternalRepositoryObjectMutationGuard,
} from "../../services/asset";
import {
  ExternalRepositoryObjectAsAssetWorkflow,
  type ExternalRepositoryObjectAsAssetWorkflowDependencies,
} from "./external-repository-object-as-asset-workflow";

export type LocalizeExternalRepositoryObjectAsAssetUseCaseDependencies =
  ExternalRepositoryObjectAsAssetWorkflowDependencies;

export class LocalizeExternalRepositoryObjectAsAssetUseCase {
  private readonly workflow: ExternalRepositoryObjectAsAssetWorkflow<LocalizeExternalRepositoryObjectCommand>;

  public constructor(dependencies: LocalizeExternalRepositoryObjectAsAssetUseCaseDependencies) {
    this.workflow = new ExternalRepositoryObjectAsAssetWorkflow(dependencies, {
      operation: "asset.localize-external-repository-object",
      portOperation: "localize",
      successStateSummary: "Localized external repository object asset instance.",
      metadataFlag: "externalRepositoryObjectLocalization",
      validateGuard: validateLocalizeExternalRepositoryObjectMutationGuard,
    });
  }

  public execute(command: LocalizeExternalRepositoryObjectCommand) {
    return this.workflow.execute(command);
  }
}
