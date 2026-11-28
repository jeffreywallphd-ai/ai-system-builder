import type {ApplicationRequestContext} from "../../../application/ports";
import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import {copyBoundedPassiveData} from "../../../contracts/shared";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, readUiPresentationIntent,
  type HeadlessHostIncarnationId, type UiPresentationDetail} from "../../../contracts/headless";
import {composeHeadlessModelMetadata} from "./headlessModelMetadata";

/** Recorded-only read. The existing window owner supplies current ModelRead and lease fences. */
export function composeHeadlessModelPresentation(options: {
  readonly documents: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly hostIncarnationId: HeadlessHostIncarnationId;
}) {
  const {documents, rootDirectory, hostIncarnationId} = options;
  const forOrganization = documents.forOrganization.bind(documents);
  return async (raw: unknown, suppliedContext: ApplicationRequestContext,
    stillAllowed: () => Promise<boolean>): Promise<UiPresentationDetail | undefined> => {
    try {
      const intent = readUiPresentationIntent(copyBoundedPassiveData(raw));
      if (intent?.action !== "show-model" || !isHeadlessHostIncarnationId(hostIncarnationId) ||
          documents.organizationId !== undefined || !isOrganizationId(suppliedContext.organizationId) ||
          !suppliedContext.principalId || !isWorkspaceId(suppliedContext.workspaceId)) return;
      const context = Object.freeze({organizationId: suppliedContext.organizationId, principalId: suppliedContext.principalId,
        workspaceId: suppliedContext.workspaceId});
      const current = () => suppliedContext.organizationId === context.organizationId &&
        suppliedContext.principalId === context.principalId && suppliedContext.workspaceId === context.workspaceId;
      const allowed = async () => current() && await stillAllowed() === true && current();
      if (!await allowed()) return;
      const metadata = composeHeadlessModelMetadata(forOrganization(context.organizationId), rootDirectory);
      const result = await metadata.execute({version: HEADLESS_CONTRACT_VERSION, operation: "models.record",
        input: {hostIncarnationId, workspaceId: context.workspaceId, modelRecordId: intent.modelRecordId}},
      {hostIncarnationId, context, stillAllowed: allowed, isCurrent: current});
      if (!await allowed() || !result.ok || result.operation !== "models.record" ||
          result.value.model.updatedAt !== intent.modelUpdatedAt) return;
      const model = result.value.model;
      return {title: "Saved model", summary: `Status: ${model.lifecycleStatus}. Type: ${model.artifactForm}. Runtime and supply checks: not checked.`};
    } catch {return undefined;}
  };
}
