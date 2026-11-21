import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {captureModelReferenceSaveEffect, commitStructuredModelReferenceSave, inspectStructuredModelReferenceSave,
  type ModelReferenceSaveEffect} from "../../../adapters/persistence/system-builder/createStructuredHeadlessModelReferenceStore";
import {readStructuredOwnedModelPlanTaskSourceDigest} from "../../../adapters/persistence/system-builder/createStructuredHeadlessModelPlanTaskStore";
import type {ModelDownloadTasksUseCase} from "../../../application/use-cases/model/model-download-tasks.use-case";
import {isHeadlessReadCurrent} from "./headlessReadCurrent";

/** Private metadata-only integration. No transport advertises saving until the
 * separate save-plan/approval protocol and real hosts qualify. Old download
 * consent must never be accepted by authorizeExactSave. */
export function composeHeadlessModelReferenceSave(options: {
  readonly documents: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly effect: ModelReferenceSaveEffect;
  readonly isCurrent: () => boolean;
  readonly authorizeExactSave: (owner: StructuredDocumentStore, effect: ModelReferenceSaveEffect) => Promise<boolean>;
  readonly peekOwner: () => Pick<ModelDownloadTasksUseCase, "peekApprovedSourceRegistration"> | undefined;
  readonly now?: () => number;
}) {
  const {documents, rootDirectory, isCurrent, authorizeExactSave, peekOwner} = options;
  const effect = captureModelReferenceSaveEffect(options.effect), now = options.now ?? Date.now;
  if (documents.organizationId !== undefined || !documents.runInOwnedTransaction || typeof authorizeExactSave !== "function" ||
      typeof peekOwner !== "function" || typeof isCurrent !== "function") throw new Error("A Model reference save requires the platform owner and exact save authorizer.");
  const transaction = documents.runInOwnedTransaction.bind(documents), current = () => isHeadlessReadCurrent(isCurrent);
  const protect = () => {if (!current()) throw new Error("The exact Model reference save ended.");};
  async function authorized(owner: StructuredDocumentStore) {
    return current() && await authorizeExactSave(owner, effect) === true && current()
      ? owner.forOrganization(effect.target.scope.organizationId) : undefined;
  }
  async function inspect() {
    return transaction(async owner => {
      const partition = await authorized(owner); if (!partition) return;
      const result = await inspectStructuredModelReferenceSave(partition, effect);
      return await authorized(owner) ? result : undefined;
    }, protect);
  }
  return {
    async save() {
      let entered = false;
      try {
        const existing = await inspect(); if (!existing || !current()) return;
        if (existing.kind === "committed") return {...existing, created: false};
        const admitted = await transaction(async owner => {
          const partition = await authorized(owner); if (!partition) return;
          const sourceDigest = await readStructuredOwnedModelPlanTaskSourceDigest(partition, effect.target.scope,
            effect.target.hostIncarnationId, effect.taskId);
          return sourceDigest && effect.manifestDigest === "sha256:" + sourceDigest && await authorized(owner) ? sourceDigest : undefined;
        }, protect);
        if (!admitted || !current()) return;
        const model = peekOwner(); if (!model || !current()) return;
        // Capture the original loaded owner's method. Compilation is cached-only
        // and runs OUTSIDE a retriable metadata transaction.
        const prepare = model.peekApprovedSourceRegistration.bind(model);
        const prepared = await prepare({workspaceId: effect.target.scope.workspaceId, requestId: effect.taskId}, effect.manifestDigest,
          {organizationId: effect.target.scope.organizationId, principalId: effect.target.scope.principalId, modelWriteAuthorized: true});
        if (!prepared || !current()) return;
        const sourceCurrent = prepared.isOriginalSourceCurrent;
        const live = () => current() && isHeadlessReadCurrent(sourceCurrent);
        if (!live()) return;
        // The application owner returns immutable private inputs. Detach the
        // snapshot again so DB awaits never retain mutable caller objects.
        const snapshot = Object.freeze({...structuredClone({review: prepared.review, sourceManifest: prepared.sourceManifest,
          localPath: prepared.localPath, storageAuthority: prepared.storageAuthority}), isOriginalSourceCurrent: sourceCurrent});
        entered = true;
        const result = await transaction(async owner => {
          const partition = await authorized(owner); if (!partition || !live()) throw new Error("Model saving is unavailable.");
          const sourceDigest = await readStructuredOwnedModelPlanTaskSourceDigest(partition, effect.target.scope,
            effect.target.hostIncarnationId, effect.taskId);
          if (sourceDigest !== admitted || !live() || !await authorized(owner)) throw new Error("Model saving is unavailable.");
          const saved = await commitStructuredModelReferenceSave(partition, rootDirectory, effect, snapshot, sourceDigest, now());
          if (!live() || !await authorized(owner)) throw new Error("Model saving is unavailable.");
          return saved;
        }, () => {if (!live()) throw new Error("The original Model source ended.");});
        return current() ? result : undefined;
      } catch {
        if (!entered || !current()) return;
        // One read-only reconciliation handles a lost commit reply. Never create
        // another record or repeat the mutation after an uncertain outcome.
        try {const result = await inspect(); return result?.kind === "committed" && current() ? {...result, created: false} : undefined;} catch {return;}
      }
    },
  };
}
