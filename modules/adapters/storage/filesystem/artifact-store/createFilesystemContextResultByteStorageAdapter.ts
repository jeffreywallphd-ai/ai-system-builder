import type {ApplicationRequestContext} from "../../../../application/ports";
import type {ContextResultByteStoragePort} from "../../../../application/ports/context-management";
import type {OrganizationRequestContextProviderPort} from "../../../../application/ports/organization";
import {CONTEXT_GENERATION_LIMITS, CONTEXT_MARKDOWN_PACK_MEDIA_TYPE, CONTEXT_RAG_DATABASE_MEDIA_TYPE}
  from "../../../../contracts/context-management";
import {createContractError} from "../../../../contracts/shared";
import {createStoreArtifactFailureResult, createStoreArtifactSuccessResult} from "../../../../contracts/storage";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {writeContainedFileStream} from "../../../filesystem-security";
import {resolveOrganizationStorageKey} from "../organizationStorageScope";
import {verifiedPublicationStream} from "./verifiedPublicationStream";

/** No metadata registration or delete capability. Unknown writes stay retained. */
export function createFilesystemContextResultByteStorageAdapter(options: {
  readonly rootDirectory: string;
  readonly organizationContextProvider?: OrganizationRequestContextProviderPort;
}): ContextResultByteStoragePort {
  const {rootDirectory, organizationContextProvider} = options;
  return {async publishResult(input, supplied) {
    const context: ApplicationRequestContext = {...supplied};
    try {
      const {publicationId, mediaType, content, expectedSizeBytes, expectedSha256} = input;
      const workspaceId = createWorkspaceId(context.workspaceId!);
      const observed = organizationContextProvider?.getCurrentOrganizationContext();
      if (organizationContextProvider && (!observed || observed.organizationId !== context.organizationId))
        throw new Error("Unavailable scope.");
      // Copy provider facts before any producer/writer await. A mutable provider
      // record cannot redirect a later write into a different organization.
      const organization = observed ? {...observed} : undefined;
      const key = `workspaces/${workspaceId}/artifacts/context/${publicationId}`;
      if (typeof publicationId !== "string" || !/^[a-f0-9]{32}$/.test(publicationId) ||
          (mediaType !== CONTEXT_MARKDOWN_PACK_MEDIA_TYPE && mediaType !== CONTEXT_RAG_DATABASE_MEDIA_TYPE) ||
          !Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes < 1 ||
          typeof expectedSha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(expectedSha256))
        throw new Error("Invalid result publication.");
      const verified = verifiedPublicationStream({content, expectedSizeBytes, expectedSha256,
        maximumBytes: expectedSizeBytes}, CONTEXT_GENERATION_LIMITS.maximumArtifactBytes);
      const scopedKey = resolveOrganizationStorageKey(key, organization ? {getCurrentOrganizationContext: () => organization} : undefined);
      const written = await writeContainedFileStream({rootDirectory, key: scopedKey, content: verified.content,
        maximumBytes: expectedSizeBytes, overwrite: false});
      const result = verified.result();
      if (written.sizeBytes !== result.sizeBytes) throw new Error("Invalid publication acknowledgement.");
      return createStoreArtifactSuccessResult({key, mediaType, sizeBytes: result.sizeBytes,
        checksum: {algorithm: "sha256", value: result.digest.slice(7)}}, context);
    } catch {
      return createStoreArtifactFailureResult(createContractError("unavailable",
        "Context result publication could not be confirmed. Retained data requires recovery."), context);
    }
  }};
}
