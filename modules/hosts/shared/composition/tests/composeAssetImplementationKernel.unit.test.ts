import { createHash } from "node:crypto";

import { describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { normalizeAssetId } from "../../../../contracts/asset";
import {
  SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS,
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V3_MANIFEST,
  SYSTEM_FOUNDATION_V2_FUNCTIONAL_DEFAULTS,
  SYSTEM_FOUNDATION_V3_FUNCTIONAL_DEFAULTS,
} from "../../../../application/services/asset-packs";
import type { AssetDefinitionRepositoryPort } from "../../../../application/ports/asset";
import type { AssetImplementationArtifactPort } from "../../../../application/ports/asset-implementation";
import {
  normalizeAssetImplementationArtifactId,
  normalizeSha256Digest,
} from "../../../../contracts/asset-implementation";
import {
  composeAssetImplementationKernel,
  DEFAULT_TRUSTED_ASSET_IMPLEMENTATION_SEEDS,
  SYSTEM_FOUNDATION_BACKING_RESOURCE_WORKSPACE_ID,
} from "../composeAssetImplementationKernel";

const definitionRef = {
  kind: "asset-definition-version",
  id: normalizeAssetId("builtin.feature"),
  version: "1.0.0",
} as const;

const definitions: AssetDefinitionRepositoryPort = {
  async saveDefinition(definition) {
    return definition;
  },
  async getDefinition(reference) {
    if (
      reference.id !== definitionRef.id ||
      reference.version !== definitionRef.version
    )
      return undefined;
    return {
      definitionId: definitionRef.id,
      assetType: "feature",
      assetFamily: "structural",
      version: "1.0.0" as never,
      displayName: "Feature",
      description: "Reusable feature.",
      lifecycleStatus: "published",
      provenance: {
        sourceKind: "system-generated",
        createdAt: "2026-07-17T12:00:00.000Z",
      },
    };
  },
  async listDefinitions() {
    return { definitions: [] };
  },
};

function createArtifacts(): AssetImplementationArtifactPort {
  const values = new Map<string, Uint8Array>();
  return {
    async putImmutable(request) {
      const bytes =
        request.content instanceof Uint8Array
          ? request.content
          : new TextEncoder().encode(String(request.content));
      const hex = createHash("sha256").update(bytes).digest("hex");
      const digest = normalizeSha256Digest(`sha256:${hex}`);
      values.set(`${request.workspaceId}:${digest}`, bytes);
      return {
        artifactId: normalizeAssetImplementationArtifactId(
          `implementation-artifact.source.${hex}`,
        ),
        kind: request.kind,
        digest,
        mediaType: request.mediaType,
        sizeBytes: bytes.byteLength,
      };
    },
    async readVerified(workspaceId, descriptor) {
      const value = values.get(`${workspaceId}:${descriptor.digest}`);
      if (!value) throw new Error("Artifact not found.");
      return value as never;
    },
  };
}

describe("asset implementation host composition", () => {
  it("resolves one trusted built-in release in desktop and server deployment profiles", async () => {
    for (const profile of ["local-desktop", "campus-server"] as const) {
      const composition = composeAssetImplementationKernel({
        documents: createInMemoryStructuredDocumentStore(),
        definitions,
        trustedSeeds: [
          {
            definitionRef,
            releaseId: "implementation-release.builtin-feature.1" as never,
            bindingId: "implementation-binding.builtin-feature.1" as never,
            version: "1.0.0",
            entryKey: "foundation.feature",
            facetKind: "ui",
            runtimeKind: "trusted-built-in",
            deploymentProfiles: ["local-desktop", "campus-server"],
            packageDigest: `sha256:${"c".repeat(64)}`,
          },
        ],
        now: () => "2026-07-17T12:00:00.000Z",
      });
      await composition.ensureTrustedBuiltIns();
      await composition.ensureTrustedBuiltIns();
      const result = await composition.resolveTrustedBuiltIn(
        createWorkspaceId("workspace-a"),
        profile,
        definitionRef,
      );
      expect(result.status).toBe("ready");
      expect(result.selectedFacets[0]?.entryKey).toBe("foundation.feature");
    }
  });

  it("keeps unimplemented definitions visible as unavailable", async () => {
    const composition = composeAssetImplementationKernel({
      documents: createInMemoryStructuredDocumentStore(),
      definitions,
    });
    const result = await composition.resolveTrustedBuiltIn(
      createWorkspaceId("workspace-a"),
      "local-desktop",
      {
        kind: "asset-definition-version",
        id: normalizeAssetId("workspace.unimplemented"),
        version: "1.0.0",
      },
    );
    expect(result.status).toBe("unimplemented");
  });

  it("resolves every foundation default on every supported deployment profile", async () => {
    const byReference = new Map(
      [
        ...SYSTEM_FOUNDATION_PACK_MANIFEST.assets,
        ...SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets,
        ...SYSTEM_FOUNDATION_PACK_V3_MANIFEST.assets,
      ].map((entry) => [
        `${entry.definition.definitionId}@${entry.definition.version}`,
        entry.definition,
      ]),
    );
    const foundationDefinitions: AssetDefinitionRepositoryPort = {
      saveDefinition: async (definition) => definition,
      getDefinition: async (reference) =>
        byReference.get(`${reference.id}@${reference.version}`),
      listDefinitions: async () => ({ definitions: [...byReference.values()] }),
    };
    const composition = composeAssetImplementationKernel({
      documents: createInMemoryStructuredDocumentStore(),
      definitions: foundationDefinitions,
      artifacts: createArtifacts(),
      trustedSeeds: DEFAULT_TRUSTED_ASSET_IMPLEMENTATION_SEEDS,
      now: () => "2026-07-17T12:00:00.000Z",
    });
    await composition.ensureTrustedBuiltIns();
    await composition.ensureTrustedBuiltIns();

    const backingResources = await composition.backingResources.list(
      createWorkspaceId("workspace-a"),
    );
    expect(backingResources.length).toBe(
      SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS.length +
        SYSTEM_FOUNDATION_V2_FUNCTIONAL_DEFAULTS.length +
        SYSTEM_FOUNDATION_V3_FUNCTIONAL_DEFAULTS.length,
    );
    expect(
      backingResources.every(
        (record) =>
          record.scope === "system" &&
          record.artifactWorkspaceId ===
            SYSTEM_FOUNDATION_BACKING_RESOURCE_WORKSPACE_ID &&
          record.files.length > 0,
      ),
    ).toBe(true);

    expect(
      backingResources.some(
        (record) =>
          record.backingResourceId ===
          "implementation-backing.builtin.system.system.1",
      ),
    ).toBe(true);
    expect(
      backingResources.some(
        (record) =>
          record.backingResourceId ===
          "implementation-backing.builtin.system.system.3",
      ),
    ).toBe(true);
    expect(
      backingResources.some(
        (record) =>
          record.backingResourceId ===
          "implementation-backing.builtin.system.system.2",
      ),
    ).toBe(true);

    for (const descriptor of [
      ...SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS,
      ...SYSTEM_FOUNDATION_V2_FUNCTIONAL_DEFAULTS,
      ...SYSTEM_FOUNDATION_V3_FUNCTIONAL_DEFAULTS,
    ]) {
      for (const profile of descriptor.deploymentProfiles) {
        const result = await composition.resolveFoundationDefault(
          createWorkspaceId("workspace-a"),
          profile,
          {
            kind: "asset-definition-version",
            id: normalizeAssetId(descriptor.definitionId),
            version: descriptor.definitionVersion,
          },
          descriptor.facetKind,
        );
        expect(result.status).toBe("ready");
        expect(result.selectedFacets[0]?.entryKey).toBe(descriptor.entryKey);
      }
    }
  });
});
