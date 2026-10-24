import { createHash } from "node:crypto";
import type { ApplicationRequestContext } from "../../../../application/ports";
import type { IngestionFileByteStoragePort } from "../../../../application/ports/ingestion";
import type { OrganizationRequestContextProviderPort } from "../../../../application/ports/organization";
import { INGESTION_TASK_MAXIMUM_FILE_BYTES, normalizeIngestionSha256Digest } from "../../../../contracts/ingestion";
import { createContractError, createFailureResult, createSuccessResult } from "../../../../contracts/shared";
import { createStoreArtifactFailureResult, createStoreArtifactSuccessResult, normalizeStorageArtifactKey } from "../../../../contracts/storage";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { writeContainedFileStream } from "../../../filesystem-security";
import { resolveOrganizationStorageKey } from "../organizationStorageScope";

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
    if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 0 || input.maximumBytes > INGESTION_TASK_MAXIMUM_FILE_BYTES
      || !Number.isSafeInteger(input.expectedSizeBytes) || input.expectedSizeBytes < 0 || input.expectedSizeBytes > input.maximumBytes) throw new Error("Invalid bounds.");
    const expected = input.expectedSha256 === undefined ? undefined : normalizeIngestionSha256Digest(input.expectedSha256);
    const hash = createHash("sha256");
    let sizeBytes = 0;
    let digest: ReturnType<typeof normalizeIngestionSha256Digest> | undefined;
    const content = async function* () {
      for await (const chunk of input.content) {
        if (!(chunk instanceof Uint8Array) || chunk.byteLength > input.maximumBytes - sizeBytes) throw new Error("Invalid content.");
        // The producer cannot mutate bytes after hashing while the writer awaits I/O.
        const owned = new Uint8Array(chunk);
        sizeBytes += owned.byteLength;
        hash.update(owned);
        yield owned;
      }
      digest = normalizeIngestionSha256Digest(`sha256:${hash.digest("hex")}`);
      // Generator EOF precedes the contained writer's target link/rename.
      if (sizeBytes !== input.expectedSizeBytes || (expected && expected !== digest)) throw new Error("Content verification failed.");
    };
    return { content: content(), result: () => {
      if (!digest || sizeBytes !== input.expectedSizeBytes) throw new Error("Incomplete content.");
      return { sizeBytes, digest };
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
