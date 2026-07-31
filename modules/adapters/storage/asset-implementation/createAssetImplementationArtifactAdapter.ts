import { createHash } from "node:crypto";

import type { AssetImplementationArtifactPort } from "../../../application/ports/asset-implementation";
import type { ArtifactObjectStoragePort } from "../../../application/ports/storage";
import {
  normalizeAssetImplementationArtifactId,
  normalizeAssetImplementationArtifactKind,
  normalizeSha256Digest,
  type AssetImplementationArtifactDescriptor,
  type AssetImplementationArtifactWriteRequest,
} from "../../../contracts/asset-implementation";
import {
  createRetrieveArtifactRequest,
  createStoreArtifactRequest,
} from "../../../contracts/storage";
import type { WorkspaceId } from "../../../contracts/workspace";

export function createAssetImplementationArtifactAdapter(
  storage: ArtifactObjectStoragePort,
): AssetImplementationArtifactPort {
  return {
    async putImmutable<TContent>(
      request: AssetImplementationArtifactWriteRequest<TContent>,
    ) {
      const content = toBytes(request.content);
      const hex = createHash("sha256").update(content).digest("hex");
      const digest = normalizeSha256Digest(`sha256:${hex}`);
      if (
        request.expectedDigest &&
        normalizeSha256Digest(request.expectedDigest) !== digest
      )
        throw new Error(
          "Implementation artifact digest does not match expected content.",
        );
      const kind = normalizeAssetImplementationArtifactKind(request.kind);
      const artifactId = normalizeAssetImplementationArtifactId(
        `implementation-artifact:${kind}:${hex}`,
      );
      const key = storageKey(request.workspaceId, kind, hex);
      const result = await storage.storeArtifact(
        createStoreArtifactRequest(content, {
          descriptor: {
            key,
            mediaType: request.mediaType,
            sizeBytes: content.byteLength,
            checksum: { algorithm: "sha256", value: hex },
          },
          overwrite: false,
        }),
        { workspaceId: request.workspaceId },
      );
      if (!result.ok && result.error.code !== "conflict")
        throw new Error("Implementation artifact storage failed.");
      return {
        artifactId,
        kind,
        digest,
        mediaType: request.mediaType,
        sizeBytes: content.byteLength,
      };
    },
    async readVerified<TContent>(
      workspaceId: WorkspaceId,
      descriptor: AssetImplementationArtifactDescriptor,
    ): Promise<TContent> {
      const hex = descriptor.digest.slice("sha256:".length);
      const result = await storage.retrieveArtifact<Uint8Array>(
        createRetrieveArtifactRequest(
          storageKey(workspaceId, descriptor.kind, hex),
        ),
        { workspaceId },
      );
      if (!result.ok) throw new Error("Implementation artifact was not found.");
      const bytes = toBytes(result.value.content);
      const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (
        actual !== descriptor.digest ||
        bytes.byteLength !== descriptor.sizeBytes
      )
        throw new Error("Implementation artifact verification failed.");
      return bytes as TContent;
    },
  };
}

function storageKey(
  workspaceId: WorkspaceId,
  kind: string,
  digestHex: string,
): string {
  return `workspaces/${workspaceId}/asset-implementations/${kind}/${digestHex}`;
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return new TextEncoder().encode(value);
  throw new TypeError(
    "Implementation artifact content must be a string or Uint8Array.",
  );
}
