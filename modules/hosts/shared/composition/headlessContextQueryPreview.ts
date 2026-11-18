import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {PreviewHeadlessContextQueryUseCase} from "../../../application/use-cases/context-management/headless-context-query-preview.use-case";
import {HEADLESS_CONTRACT_VERSION} from "../../../contracts/headless";
import {compileRecordedHeadlessContextInputs} from "./headlessContextRebuild";

/** Metadata only; question text never enters a transaction or runtime owner. */
export function composeHeadlessContextQueryPreview(documents: StructuredDocumentStore, rootDirectory: string) {
  if (documents.organizationId !== undefined || !documents.runInOwnedTransaction) throw new Error("Context query preview requires the platform owner.");
  const transaction = documents.runInOwnedTransaction.bind(documents);
  return new PreviewHeadlessContextQueryUseCase(async (target, context, isCurrent) => {
    if (!context.organizationId || !context.principalId || context.workspaceId !== target.workspaceId || !isCurrent()) return;
    return transaction(async owner => {
      if (!isCurrent()) return;
      const compiled = await compileRecordedHeadlessContextInputs(owner.forOrganization(context.organizationId!), rootDirectory,
        {version: HEADLESS_CONTRACT_VERSION, operation: "context.preview-rebuild", input: target}, context, async () => isCurrent());
      if (!compiled || !isCurrent() || compiled.prepared.command.kind !== "rag-database" || !compiled.prepared.embeddingModel) return;
      return {modelRecordId: compiled.prepared.embeddingModel.modelRecordId, modelUpdatedAt: compiled.prepared.embeddingModel.modelUpdatedAt,
        sourceCount: compiled.prepared.admissionSources.length};
    }, () => {if (!isCurrent()) throw new Error("Context query preview ended.");});
  });
}
