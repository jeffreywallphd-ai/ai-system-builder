import type {ApplicationRequestContext} from "../../../application/ports";
import {isWorkspaceId} from "../../../contracts/workspace";
import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {readStructuredPresentableDatasetPlanTask} from "../../../adapters/persistence/ingestion/createStructuredHeadlessDatasetPlanTaskStore";
import {createStructuredDatasetVersionRepository} from "../../../adapters/persistence/dataset-version";
import {ReadHeadlessDataPresentationUseCase} from "../../../application/use-cases/ingestion-acquisition/headless-data-presentation.use-case";
import type {PrepareTrainingDatasetFromArtifactsUseCase} from "../../../application/use-cases/prepare-training-dataset-from-artifacts.use-case";
import {composeIngestionAcquisitionRepository} from "./composeIngestionAcquisitionRepository";

/** Call only inside the existing presentation owner's current artifact-read fences. */
export function composeHeadlessDataPresentation(options: {
  readonly documents: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly hostIncarnationId: string;
  readonly getProcessor: () => Promise<Pick<PrepareTrainingDatasetFromArtifactsUseCase,
    "readAdmittedLocalDatasetStatus" | "peekAdmittedLocalDatasetReview">>;
}) {
  const {documents, hostIncarnationId, rootDirectory, getProcessor} = options;
  return (context: ApplicationRequestContext) => {
    if (!context.organizationId || !context.principalId || !isWorkspaceId(context.workspaceId) || documents.organizationId !== undefined) return;
    const partition = documents.forOrganization(context.organizationId);
    return new ReadHeadlessDataPresentationUseCase({sources: composeIngestionAcquisitionRepository(rootDirectory, partition),
      versions: createStructuredDatasetVersionRepository(partition),
      async readAcceptedTask(taskId, actor, stillAllowed) {
        if (!documents.runInOwnedTransaction || !actor.organizationId || !actor.principalId || !isWorkspaceId(actor.workspaceId)) return;
        const scope = {organizationId: actor.organizationId, principalId: actor.principalId, workspaceId: actor.workspaceId};
        const accepted = await documents.runInOwnedTransaction(owner => readStructuredPresentableDatasetPlanTask(
          owner.forOrganization(scope.organizationId), scope, hostIncarnationId, taskId), () => {});
        if (!accepted || !await stillAllowed()) return; // No lazy feature access for unknown, foreign or unaccepted tasks.
        const processor = await getProcessor();
        if (!await stillAllowed()) return;
        const review = processor.peekAdmittedLocalDatasetReview(taskId, actor);
        if (review) return {taskId, state: "review-required", review};
        const status = await processor.readAdmittedLocalDatasetStatus(taskId, actor);
        if (!await stillAllowed()) return;
        const completedReview = processor.peekAdmittedLocalDatasetReview(taskId, actor);
        return completedReview ? {taskId, state: "review-required", review: completedReview} : status ? {...status, review: null} : undefined;
      }});
  };
}
