import {createHash} from "node:crypto";
import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {readStructuredSavedContextOrigin} from "../../../adapters/persistence/system-builder/createStructuredHeadlessContextResultStore";
import {readStructuredContextPlanTaskLineage} from "../../../adapters/persistence/system-builder/createStructuredHeadlessContextPlanTaskStore";
import {readStructuredRecordedContextGeneration} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {ReadHeadlessContextRebuildUseCase} from "../../../application/use-cases/context-management";
import type {ApplicationRequestContext} from "../../../application/ports";
import {readHeadlessContextRebuildValue, type HeadlessContextRebuildRequest} from "../../../contracts/headless";
import {composeHeadlessContextPreview} from "./headlessContextPreview";

/** The caller owns the transaction and current authority. Historic definitions
 * do not grant permission, and a producing rebuild does not adopt its ancestor. */
export async function compileRecordedHeadlessContextInputs(partition: StructuredDocumentStore, rootDirectory: string,
  request: HeadlessContextRebuildRequest, context: ApplicationRequestContext, stillAllowed: () => Promise<boolean>) {
  if (!context.organizationId || !context.principalId || partition.organizationId !== context.organizationId ||
      context.workspaceId !== request.input.workspaceId || !await stillAllowed()) return;
  const {reference} = request.input;
  const saved = await readStructuredSavedContextOrigin(partition, rootDirectory, reference.workspaceId, reference.contextId);
  if (!saved || !await stillAllowed() || saved.effect.taskId !== reference.taskId || saved.artifact.kind !== reference.kind ||
      saved.artifact.digest !== reference.artifactDigest) return;
  const original = saved.effect;
  const lineage = await readStructuredContextPlanTaskLineage(partition, original.target.scope,
    original.target.hostIncarnationId, original.taskId);
  if (!lineage || lineage.sourceDigest !== saved.sourceDigest || !await stillAllowed()) return;
  const definition = await readStructuredRecordedContextGeneration(partition, lineage.target, lineage.step, lineage.inputDigest);
  if (!definition || !await stillAllowed() || definition.request.input.settings.kind !== reference.kind) return;
  const {idempotencyKey: _key, hostIncarnationId: _oldHost, rebuildOf: _ancestor, ...recorded} = definition.request.input;
  const compiled = await composeHeadlessContextPreview(partition, rootDirectory).execute({version: request.version,
    operation: "context.preview-generation", input: {...recorded, hostIncarnationId: request.input.hostIncarnationId}},
    {hostIncarnationId: request.input.hostIncarnationId, context, stillAllowed});
  if (!compiled.ok || compiled.operation !== "context.preview-generation" || !await stillAllowed()) return;
  const prepared = compiled.prepared;
  const sourceDigest = createHash("sha256").update(JSON.stringify(prepared.command.kind === "rag-database"
    ? [prepared.command, prepared.admissionSources, prepared.embeddingModel] : [prepared.command, prepared.admissionSources]), "utf8").digest("hex");
  if (sourceDigest !== lineage.sourceDigest || JSON.stringify(prepared.embeddingModel) !== JSON.stringify(definition.embeddingModel)) return;
  return compiled;
}

/** Indexed metadata only. No file, runtime, discovery or old task capability. */
export function composeHeadlessContextRebuildPreview(documents: StructuredDocumentStore, rootDirectory: string) {
  if (documents.organizationId !== undefined || !documents.runInOwnedTransaction)
    throw new Error("Context rebuild inputs require the platform owner.");
  const transaction = documents.runInOwnedTransaction.bind(documents);
  return new ReadHeadlessContextRebuildUseCase(async (request, context, isCurrent) => {
    if (!context.organizationId || !context.principalId || context.workspaceId !== request.input.workspaceId) return;
    return transaction(async owner => {
      if (!isCurrent()) return;
      const compiled = await compileRecordedHeadlessContextInputs(owner.forOrganization(context.organizationId!), rootDirectory,
        request, context, async () => isCurrent());
      return compiled && isCurrent() ? readHeadlessContextRebuildValue({reference: request.input.reference,
        preview: compiled.prepared.preview, byteAvailability: "not-checked"}, request.input) : undefined;
    }, () => {if (!isCurrent()) throw new Error("Context rebuild input access ended.");});
  });
}
