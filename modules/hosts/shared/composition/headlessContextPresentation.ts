import type {ApplicationRequestContext} from "../../../application/ports";
import {ReadHeadlessContextPresentationUseCase} from "../../../application/use-cases/context-management/headless-context-presentation.use-case";
import type {ContextGenerationUseCase} from "../../../application/use-cases/context-management/context-generation.use-case";
import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {readStructuredPresentableContextPlanTask} from "../../../adapters/persistence/system-builder/createStructuredHeadlessContextPlanTaskStore";
import {readStructuredSavedContextMetadata} from "../../../adapters/persistence/system-builder/createStructuredHeadlessContextResultStore";
import {isWorkspaceId} from "../../../contracts/workspace";

/** Existing consent owner calls this under current artifact-read fences. No feature initialization. */
export function composeHeadlessContextPresentation(options: {
  readonly documents: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly hostIncarnationId: string;
  readonly peekProcessor: () => Pick<ContextGenerationUseCase, "readAdmittedContextTask"> | undefined;
}) {
  const {documents, rootDirectory, hostIncarnationId, peekProcessor} = options;
  return (context: ApplicationRequestContext) => {
    if (documents.organizationId !== undefined || !documents.runInOwnedTransaction || !context.organizationId ||
        !context.principalId || !isWorkspaceId(context.workspaceId)) return;
    const transaction = documents.runInOwnedTransaction.bind(documents);
    return new ReadHeadlessContextPresentationUseCase({
      async readSaved(contextId, actor) {
        if (!actor.organizationId || !isWorkspaceId(actor.workspaceId)) return;
        return transaction(owner => readStructuredSavedContextMetadata(owner.forOrganization(actor.organizationId!), rootDirectory,
          actor.workspaceId!, contextId), () => {});
      },
      async readAcceptedTask(taskId, actor, stillAllowed) {
        if (!actor.organizationId || !actor.principalId || !isWorkspaceId(actor.workspaceId) || !await stillAllowed()) return;
        const scope = {organizationId: actor.organizationId, principalId: actor.principalId, workspaceId: actor.workspaceId};
        const accepted = await transaction(owner => readStructuredPresentableContextPlanTask(owner.forOrganization(scope.organizationId),
          scope, hostIncarnationId, taskId), () => {});
        if (!accepted || !await stillAllowed()) return;
        const processor = peekProcessor();
        if (!processor || !await stillAllowed()) return;
        const result = await processor.readAdmittedContextTask(taskId, actor);
        return await stillAllowed() ? result : undefined;
      },
    });
  };
}
