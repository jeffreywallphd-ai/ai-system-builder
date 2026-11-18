import type {ApplicationRequestContext} from "../../ports";
import type {ModelRegistryPort} from "../../ports/model";
import type {ApprovedContextEmbeddingModelResolverPort, ApprovedContextEmbeddingModelWitness,
  ContextInstalledEmbeddingModelFilesPort} from "../../ports/context-management";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import {prepareApprovedContextEmbeddingModel, readApprovedContextEmbeddingModelWitness} from "./approved-context-embedding-model";

/** Business authority stays here; the filesystem adapter knows only configured roots and existing files. */
export class ResolveApprovedContextEmbeddingModelUseCase implements ApprovedContextEmbeddingModelResolverPort {
  constructor(private readonly models: Pick<ModelRegistryPort, "readRecordedModel">,
    private readonly files: ContextInstalledEmbeddingModelFilesPort) {}

  async resolveExistingModel(raw: ApprovedContextEmbeddingModelWitness, rawContext: ApplicationRequestContext,
    stillAllowed: () => Promise<boolean>) {
    const context = Object.freeze({...rawContext}), witness = readApprovedContextEmbeddingModelWitness(raw);
    try {
      if (!witness || !this.models.readRecordedModel || !isWorkspaceId(context.workspaceId) || !isOrganizationId(context.organizationId) ||
          !context.principalId || context.principalId.length > 160 || hasKnownPassiveCredential(context.principalId) || !await stillAllowed()) return;
      const selected = await this.models.readRecordedModel(context.workspaceId, witness.modelRecordId);
      if (!selected || !await stillAllowed()) return;
      const prepared = prepareApprovedContextEmbeddingModel(selected, context.workspaceId);
      if (!prepared || JSON.stringify(prepared.witness) !== JSON.stringify(witness)) return;
      const result = await this.files.inspectExistingDirectory(prepared.localPath);
      if (!result || !await stillAllowed()) return;
      const reference = readStrictPassiveRecord(copyBoundedPassiveData(result), ["localModelReference"]);
      if (Object.keys(reference).length !== 1 || typeof reference.localModelReference !== "string" || !reference.localModelReference ||
          reference.localModelReference.length > 4096 || /[\u0000-\u001f\u007f]/u.test(reference.localModelReference)) return;
      // Observe the final model facts after the last awaited policy check. The caller
      // still owns the synchronous admission fence and the atomic issue boundary.
      if (!await stillAllowed()) return;
      const latest = await this.models.readRecordedModel(context.workspaceId, witness.modelRecordId);
      if (!latest) return;
      const current = prepareApprovedContextEmbeddingModel(latest, context.workspaceId);
      if (!current || JSON.stringify(current.witness) !== JSON.stringify(witness)) return;
      return Object.freeze({localModelReference: reference.localModelReference});
    } catch {return;}
  }
}
