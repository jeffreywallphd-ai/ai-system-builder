import type { ApplicationRequestContext } from "../../../../application/ports";
import type { IngestionFileByteStoragePort } from "../../../../application/ports/ingestion";
import type { OrganizationRequestContextProviderPort } from "../../../../application/ports/organization";
import { INGESTION_TASK_MAXIMUM_FILE_BYTES, normalizeIngestionSha256Digest } from "../../../../contracts/ingestion";
import { createContractError, createFailureResult, createSuccessResult } from "../../../../contracts/shared";
import { createStoreArtifactFailureResult, createStoreArtifactSuccessResult, normalizeStorageArtifactKey } from "../../../../contracts/storage";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { writeContainedFileStream } from "../../../filesystem-security";
import { resolveOrganizationStorageKey } from "../organizationStorageScope";
import { verifiedPublicationStream } from "./verifiedPublicationStream";

interface Options {
  readonly rootDirectory: string;
  readonly organizationContextProvider?: OrganizationRequestContextProviderPort;
}
interface StreamInput {
  readonly content: AsyncIterable<Uint8Array>;
  readonly maximumBytes: number;
  readonly expectedSizeBytes: number;
  readonly expectedSha256?: string;
}

/** Exclusive private publication only; it never deletes a published target. */
export function createFilesystemIngestionFileByteStorageAdapter(options: Options): IngestionFileByteStoragePort {
  const scope = (context: ApplicationRequestContext) => {
    const workspaceId = createWorkspaceId(context.workspaceId!);
    const organization = options.organizationContextProvider?.getCurrentOrganizationContext();
    if (options.organizationContextProvider && (!organization || organization.organizationId !== context.organizationId)) throw new Error("Unavailable scope.");
    return { workspaceId, contexts: organization ? { getCurrentOrganizationContext: () => organization } : undefined };
  };
  const inspect = (input: StreamInput) => {
    const expected = input.expectedSha256 === undefined ? undefined : normalizeIngestionSha256Digest(input.expectedSha256);
    const verified = verifiedPublicationStream({...input, expectedSha256: expected}, INGESTION_TASK_MAXIMUM_FILE_BYTES);
    return {content: verified.content, result: () => {
      const result = verified.result();
      return {sizeBytes: result.sizeBytes, digest: normalizeIngestionSha256Digest(result.digest)};
    } };
  };
  return {
    async verifyContent(input, supplied) {
      const context = { ...supplied };
      try {
        scope(context);
        const verified = inspect({ ...input });
        for await (const _chunk of verified.content) { /* bounded inspection, no target */ }
        return createSuccessResult(verified.result(), context);
      } catch {
        return createFailureResult(createContractError("validation", "Transferred file content could not be verified."), context);
      }
    },
    async storeArtifactStream(input, supplied = {}) {
      const context = { ...supplied };
      try {
        const request = { ...input, descriptor: { ...input.descriptor } };
        const captured = scope(context);
        const key = normalizeStorageArtifactKey(request.descriptor.key!);
        const prefix = `workspaces/${captured.workspaceId}/artifacts/files/ingestion/`;
        if (!key.startsWith(prefix) || !/^[a-f0-9]{32}$/.test(key.slice(prefix.length)) || request.overwrite !== false
          || !request.expectedSha256 || typeof request.descriptor.mediaType !== "string"
          || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(request.descriptor.mediaType)
          || request.descriptor.mediaType.length > 255) throw new Error("Invalid publication.");
        const verified = inspect(request);
        const scopedKey = resolveOrganizationStorageKey(key, captured.contexts);
        const written = await writeContainedFileStream({ rootDirectory: options.rootDirectory, key: scopedKey,
          content: verified.content, maximumBytes: request.maximumBytes, overwrite: false });
        const result = verified.result();
        if (written.sizeBytes !== result.sizeBytes) throw new Error("Invalid acknowledgement.");
        return createStoreArtifactSuccessResult({ key, mediaType: request.descriptor.mediaType, sizeBytes: result.sizeBytes,
          checksum: { algorithm: "sha256", value: result.digest.slice(7) } }, context);
      } catch {
        // Link/unlink/fsync acknowledgement can be uncertain. Never compensate
        // by deleting the candidate; the private writing state retains it.
        return createStoreArtifactFailureResult(createContractError("unavailable", "File publication could not be acknowledged. Retained data requires recovery."), context);
      }
    },
  };
}
