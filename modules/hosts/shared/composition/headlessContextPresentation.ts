import type {ApplicationRequestContext} from "../../../application/ports";
import {ReadHeadlessContextPresentationUseCase} from "../../../application/use-cases/context-management/headless-context-presentation.use-case";
import type {ContextGenerationUseCase} from "../../../application/use-cases/context-management/context-generation.use-case";
import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {readStructuredPresentableContextPlanTask, readStructuredPresentableContextPlanTaskLineage} from "../../../adapters/persistence/system-builder/createStructuredHeadlessContextPlanTaskStore";
import {readStructuredSavedContextMetadata} from "../../../adapters/persistence/system-builder/createStructuredHeadlessContextResultStore";
import {readStructuredRecordedContextQuery} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {compileHeadlessContextQueryInputs, type HeadlessContextQueryOwner} from "./headlessContextQueryExecution";
import {readHeadlessContextTaskValue} from "../../../contracts/headless";
import {isWorkspaceId} from "../../../contracts/workspace";

/** Existing consent owner supplies current artifact-read fences and, for queries, ModelRead too. No feature initialization. */
export function composeHeadlessContextPresentation(options: {
  readonly documents: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly hostIncarnationId: string;
  readonly peekQueryOwner?: () => Pick<HeadlessContextQueryOwner, "readAdmittedContextQueryTask"> | undefined;
  readonly peekProcessor: () => Pick<ContextGenerationUseCase, "readAdmittedContextTask"> | undefined;
}) {
  const {documents, rootDirectory, hostIncarnationId, peekProcessor} = options;
  return (context: ApplicationRequestContext) => {
    if (documents.organizationId !== undefined || !documents.runInOwnedTransaction || !context.organizationId ||
        !context.principalId || !isWorkspaceId(context.workspaceId)) return;
    const transaction = documents.runInOwnedTransaction.bind(documents);
    return new ReadHeadlessContextPresentationUseCase({
      async readAcceptedQueryTask(taskId, actor, stillAllowed) {
        if (!actor.organizationId || !actor.principalId || !isWorkspaceId(actor.workspaceId) || !await stillAllowed()) return;
        const scope = {organizationId: actor.organizationId, principalId: actor.principalId, workspaceId: actor.workspaceId};
        const metadata = await transaction(async owner => {
          const partition = owner.forOrganization(scope.organizationId);
          const lineage = await readStructuredPresentableContextPlanTaskLineage(partition, scope, hostIncarnationId, taskId);
          if (!lineage) return;
          const request = await readStructuredRecordedContextQuery(partition, lineage.target, lineage.step, lineage.inputDigest);
          if (!request) return;
          // Metadata stays in this owned snapshot. External window policy is checked
          // before/after it; reentering the root policy transaction here can deadlock.
          const compiled = await compileHeadlessContextQueryInputs(partition, rootDirectory, request, actor, async () => true);
          return compiled ? {request, compiled} : undefined;
        }, () => {});
        if (!metadata || !await stillAllowed()) return;
        const queryOwner = options.peekQueryOwner?.();
        if (!queryOwner || !await stillAllowed()) return;
        const snapshot = await queryOwner.readAdmittedContextQueryTask(taskId, actor);
        if (!snapshot || !await stillAllowed()) return;
        return readHeadlessContextTaskValue({taskId: snapshot.taskId, state: snapshot.state, review: null,
          query: {queryDigest: metadata.request.input.queryDigest, maximumResults: metadata.request.input.maximumResults,
            embeddingDevice: metadata.request.input.embeddingDevice, sources: metadata.compiled.publicSources,
            matches: snapshot.matches, cleanupPending: snapshot.cleanupPending}}, {kind: "task", taskId});
      },
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
