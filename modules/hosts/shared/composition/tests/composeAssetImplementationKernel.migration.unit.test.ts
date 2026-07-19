import { createHash } from "node:crypto";

import { describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import type { AssetDefinitionRepositoryPort } from "../../../../application/ports/asset";
import type { AssetImplementationArtifactPort } from "../../../../application/ports/asset-implementation";
import {
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
} from "../../../../application/services/asset-packs";
import {
  normalizeAssetImplementationArtifactId,
  ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
  normalizeAssetSourceSnapshotId,
  normalizeSha256Digest,
} from "../../../../contracts/asset-implementation";
import {
  composeAssetImplementationKernel,
  DEFAULT_TRUSTED_ASSET_IMPLEMENTATION_SEEDS,
  SYSTEM_FOUNDATION_BACKING_RESOURCE_WORKSPACE_ID,
} from "../composeAssetImplementationKernel";

describe("asset implementation built-in backing-resource migration", () => {
  it("preserves a valid immutable backing resource when current catalog content changes", async () => {
    const seed = DEFAULT_TRUSTED_ASSET_IMPLEMENTATION_SEEDS[0]!;
    const definition = [
      ...SYSTEM_FOUNDATION_PACK_MANIFEST.assets,
      ...SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets,
    ].find(
      (entry) =>
        entry.definition.definitionId === seed.definitionRef.id &&
        entry.definition.version === seed.definitionRef.version,
    )?.definition;
    expect(definition).toBeDefined();

    const definitions: AssetDefinitionRepositoryPort = {
      async saveDefinition(value) {
        return value;
      },
      async getDefinition(reference) {
        return reference.id === seed.definitionRef.id &&
          reference.version === seed.definitionRef.version
          ? definition
          : undefined;
      },
      async listDefinitions() {
        return { definitions: definition ? [definition] : [] };
      },
    };
    const documents = createInMemoryStructuredDocumentStore();
    const original = composeAssetImplementationKernel({
      documents,
      definitions,
      trustedSeeds: [seed],
      now: () => "2026-07-17T12:00:00.000Z",
    });
    await original.ensureTrustedBuiltIns();

    const legacyDigest = normalizeSha256Digest(`sha256:${"a".repeat(64)}`);
    await original.backingResources.save({
      backingResourceId: `implementation-backing.${seed.definitionRef.id}.legacy`,
      origin: "system-foundation",
      releaseId: seed.releaseId,
      definitionRef: seed.definitionRef,
      scope: "system",
      artifactWorkspaceId: SYSTEM_FOUNDATION_BACKING_RESOURCE_WORKSPACE_ID,
      sourceSnapshotId: normalizeAssetSourceSnapshotId(
        `source-snapshot.${seed.definitionRef.id}.legacy`,
      ),
      artifact: {
        artifactId: normalizeAssetImplementationArtifactId(
          `implementation-artifact:source:${"a".repeat(64)}`,
        ),
        kind: "source",
        digest: legacyDigest,
        mediaType: ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
        sizeBytes: 1,
      },
      files: [
        {
          path: "backend/legacy.ts",
          role: "backend-logic",
          mediaType: "text/typescript",
          sizeCharacters: 1,
          editable: true,
        },
      ],
      createdAt: "2026-07-17T12:00:00.000Z",
      createdBy: "system",
    });

    let artifactWrites = 0;
    const upgraded = composeAssetImplementationKernel({
      documents,
      definitions,
      artifacts: createArtifacts(() => {
        artifactWrites += 1;
      }),
      trustedSeeds: [seed],
      now: () => "2026-07-19T12:00:00.000Z",
    });
    await upgraded.ensureTrustedBuiltIns();

    const retained = await upgraded.backingResources.readByRelease(
      seed.releaseId,
    );
    expect(retained?.artifact.digest).toBe(legacyDigest);
    expect(retained?.files[0]?.path).toBe("backend/legacy.ts");
    expect(artifactWrites).toBe(0);
  });
});

function createArtifacts(onWrite: () => void): AssetImplementationArtifactPort {
  return {
    async putImmutable(request) {
      onWrite();
      const bytes = new TextEncoder().encode(String(request.content));
      const hex = createHash("sha256").update(bytes).digest("hex");
      return {
        artifactId: normalizeAssetImplementationArtifactId(
          `implementation-artifact:source:${hex}`,
        ),
        kind: request.kind,
        digest: normalizeSha256Digest(`sha256:${hex}`),
        mediaType: request.mediaType,
        sizeBytes: bytes.byteLength,
      };
    },
    async readVerified() {
      throw new Error("Artifact reads are not used by this migration test.");
    },
  };
}
