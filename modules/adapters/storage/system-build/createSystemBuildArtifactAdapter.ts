import { createHash } from "node:crypto";
import type { SystemBuildArtifactPort, SystemBuildHasherPort } from "../../../application/ports/system-build";
import type { ArtifactObjectStoragePort } from "../../../application/ports/storage";
import { normalizeSystemBuildArtifactId, normalizeSystemBuildArtifactKind, normalizeSystemBuildDigest, type SystemBuildArtifactDescriptor } from "../../../contracts/system-build";
import { createRetrieveArtifactRequest, createStoreArtifactRequest } from "../../../contracts/storage";
import type { WorkspaceId } from "../../../contracts/workspace";

export function createSha256SystemBuildHasher(): SystemBuildHasherPort {
  return { digest: (content) => normalizeSystemBuildDigest(`sha256:${createHash("sha256").update(toBytes(content)).digest("hex")}`) };
}

export function createSystemBuildArtifactAdapter(storage: ArtifactObjectStoragePort): SystemBuildArtifactPort {
  return {
    async putImmutable(request) {
      const bytes = toBytes(request.content);
      const hex = createHash("sha256").update(bytes).digest("hex");
      const digest = normalizeSystemBuildDigest(`sha256:${hex}`);
      if (request.expectedDigest && normalizeSystemBuildDigest(request.expectedDigest) !== digest) throw new Error("System build artifact digest does not match expected content.");
      const kind = normalizeSystemBuildArtifactKind(request.kind);
      const artifactId = normalizeSystemBuildArtifactId(`system-artifact:${kind}:${hex}`);
      const key = storageKey(request.workspaceId, kind, hex);
      const result = await storage.storeArtifact(createStoreArtifactRequest(bytes, { descriptor: { key, mediaType: request.mediaType, sizeBytes: bytes.byteLength, checksum: { algorithm: "sha256", value: hex } }, overwrite: false }), { workspaceId: request.workspaceId });
      if (!result.ok && result.error.code !== "conflict") throw new Error("System build artifact storage failed.");
      return { artifactId, kind, digest, mediaType: request.mediaType, sizeBytes: bytes.byteLength };
    },
    async readVerified<TContent>(workspaceId: WorkspaceId, descriptor: SystemBuildArtifactDescriptor): Promise<TContent> {
      const hex = descriptor.digest.slice("sha256:".length);
      const result = await storage.retrieveArtifact<Uint8Array>(createRetrieveArtifactRequest(storageKey(workspaceId, descriptor.kind, hex)), { workspaceId });
      if (!result.ok) throw new Error("System build artifact was not found.");
      const bytes = toBytes(result.value.content);
      const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (actual !== descriptor.digest || bytes.byteLength !== descriptor.sizeBytes) throw new Error("System build artifact verification failed.");
      return bytes as TContent;
    },
  };
}

const storageKey = (workspaceId: WorkspaceId, kind: string, hex: string) => `workspaces/${workspaceId}/system-builds/${kind}/${hex}`;
function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return new TextEncoder().encode(value);
  throw new TypeError("System build artifact content must be a string or Uint8Array.");
}
