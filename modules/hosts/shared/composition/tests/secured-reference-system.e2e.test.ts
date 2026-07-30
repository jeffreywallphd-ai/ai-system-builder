import { describe, expect, it } from "../../../../testing/node-test";
import type { AssetImplementationFacetKind } from "../../../../contracts/asset-implementation";
import {
  normalizeAssetImplementationFacetId,
  normalizeAssetImplementationReleaseId,
} from "../../../../contracts/asset-implementation";
import {
  normalizeSystemBuildArtifactId,
  normalizeSystemBuildId,
  type SystemBuildArtifactDescriptor,
} from "../../../../contracts/system-build";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createSha256SystemBuildHasher } from "../../../../adapters/storage/system-build";
import { SYSTEM_FOUNDATION_PACK_MANIFEST } from "../../../../application/services/asset-packs/system-packs/system-foundation-pack.manifest";
import type {
  SystemBuildArtifactPort,
  SystemBuildImplementationResolverPort,
} from "../../../../application/ports/system-build";
import { composeSystemBuild } from "../composeSystemBuild";
import { composeSystemBuilder } from "../composeSystemBuilder";
import { composeSystemData } from "../composeSystemData";

const workspaceId = createWorkspaceId("workspace-secured-reference");
const timestamp = "2026-07-17T12:00:00.000Z";

describe("secured data-entry reference system", () => {
  it("creates, builds, approves, and runs the release with policy, masking, migration, and audit evidence", async () => {
    const documents = createInMemoryStructuredDocumentStore();
    const definitions = new Map(
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.map((entry) => [
        `${entry.definition.definitionId}@${entry.definition.version}`,
        entry.definition,
      ]),
    );
    const builder = composeSystemBuilder({
      documents,
      definitions: {
        async readExactDefinition(reference) {
          return definitions.get(`${reference.id}@${reference.version}`);
        },
      },
      assetRegistryRead: {
        listDefinitionCards: async () => ({ items: [] }),
        readDefinitionDetail: async () => undefined,
      },
      generateSystemId: () => "system.secured-reference",
      now: () => timestamp,
    });

    const templates = await builder.useCases.listTemplates.execute();
    expect(templates.map((template) => template.templateId)).toContain(
      "reference.secured-data-entry@1.0.0",
    );
    const created = await builder.useCases.createFromTemplate.execute({
      workspaceId,
      templateId: "reference.secured-data-entry@1.0.0",
      name: "Secured service requests",
      actorId: "owner-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok)
      throw new Error("Expected the reference system to be created.");
    expect(created.value.status).toBe("validated");
    const revision = await builder.repository.readRevision(
      workspaceId,
      created.value.systemId,
      created.value.currentRevisionId,
    );
    expect(revision?.instances.length).toBe(35);

    const hasher = createSha256SystemBuildHasher();
    const artifacts = createMemoryArtifactPort(hasher);
    const builds = composeSystemBuild({
      documents,
      systemBuilder: builder,
      resolver: createReferenceImplementationResolver(),
      artifacts,
      hasher,
      guidedProfile: {
        id: "local-desktop",
        label: "This computer",
        deploymentProfile: "local-desktop",
        availableCapabilities: [],
        permittedTrustLevels: ["system-trusted"],
        hostApiVersion: "1.0.0",
        toolchainProfile: "system-builder/1.0.0",
      },
      now: () => timestamp,
    });
    const built = await builds.useCases.request.execute({
      buildId: normalizeSystemBuildId("build.secured-reference"),
      workspaceId,
      systemId: created.value.systemId,
      systemRevisionId: created.value.currentRevisionId,
      deploymentProfile: "local-desktop",
      availableCapabilities: [],
      permittedTrustLevels: ["system-trusted"],
      hostApiVersion: "1.0.0",
      toolchainProfile: "system-builder/1.0.0",
      actorId: "owner-1",
    });
    expect(built.ok && built.value.status).toBe("succeeded");
    if (!built.ok || !built.value.lockDigest)
      throw new Error("Expected a successful build.");
    expect(
      built.value.outputArtifacts.map((artifact) => artifact.kind),
    ).toContain("migration-plan");

    const approved = await builds.useCases.approve.execute({
      workspaceId,
      buildId: built.value.buildId,
      expectedLockDigest: built.value.lockDigest,
      actorId: "approver-1",
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error("Expected an approved release.");

    let auditSequence = 0;
    const data = composeSystemData({
      documents,
      builds: builds.repository,
      artifacts,
      generateAuditId: () => `audit.${++auditSequence}`,
      now: () => timestamp,
    });
    const owner = { actorId: "owner-1", roles: ["owner"], authenticated: true };
    const viewer = {
      actorId: "viewer-1",
      roles: ["viewer"],
      authenticated: true,
    };
    const context = {
      workspaceId,
      releaseId: approved.value.releaseId,
      entityType: "service-request",
    };

    const described = await data.runtime.describe({
      ...context,
      principal: owner,
    });
    expect(described.ok && described.value.fields.length).toBe(6);
    const inserted = await data.runtime.create({
      ...context,
      principal: owner,
      recordId: "request-1",
      values: {
        title: "Replace access badge",
        amount: 25,
        status: "submitted",
        dueDate: "2026-07-31",
        confidentialNotes: "Security desk only",
      },
    });
    expect(inserted.ok).toBe(true);

    const masked = await data.runtime.read({
      ...context,
      principal: viewer,
      recordId: "request-1",
    });
    expect(masked.ok).toBe(true);
    if (!masked.ok)
      throw new Error("Expected the viewer to read a masked record.");
    expect(masked.value.values.title).toBe("Replace access badge");
    expect(masked.value.values.confidentialNotes).toBeUndefined();

    const deniedWrite = await data.runtime.create({
      ...context,
      principal: viewer,
      recordId: "request-denied",
      values: {
        title: "Denied",
        amount: 1,
        status: "draft",
        dueDate: "2026-07-31",
      },
    });
    expect(deniedWrite).toMatchObject({
      ok: false,
      error: { code: "system-data.forbidden" },
    });

    const audit = await data.runtime.listAudit({
      ...context,
      principal: owner,
      limit: 20,
    });
    expect(audit.ok).toBe(true);
    if (!audit.ok) throw new Error("Expected safe audit evidence.");
    expect(
      audit.value.some(
        (entry) => entry.action === "create" && entry.outcome === "allowed",
      ),
    ).toBe(true);
    expect(
      audit.value.some(
        (entry) => entry.action === "create" && entry.outcome === "denied",
      ),
    ).toBe(true);
    expect(JSON.stringify(audit.value)).not.toContain("Security desk only");

    const otherWorkspace = createWorkspaceId("workspace-other");
    const isolated = await data.runtime.describe({
      ...context,
      workspaceId: otherWorkspace,
      principal: owner,
    });
    expect(isolated).toMatchObject({
      ok: false,
      error: { code: "system-data.release-unavailable" },
    });
  });

  it("creates, builds, and approves the controlled chatbot without exposing protected instructions", async () => {
    const documents = createInMemoryStructuredDocumentStore();
    const definitions = new Map(
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.map((entry) => [
        `${entry.definition.definitionId}@${entry.definition.version}`,
        entry.definition,
      ]),
    );
    const builder = composeSystemBuilder({
      documents,
      definitions: {
        async readExactDefinition(reference) {
          return definitions.get(`${reference.id}@${reference.version}`);
        },
      },
      assetRegistryRead: {
        listDefinitionCards: async () => ({ items: [] }),
        readDefinitionDetail: async () => undefined,
      },
      generateSystemId: () => "system.controlled-chatbot-reference",
      now: () => timestamp,
    });

    const created = await builder.useCases.createFromTemplate.execute({
      workspaceId,
      templateId: "reference.controlled-chatbot@1.0.0",
      name: "Controlled support assistant",
      actorId: "owner-1",
    });
    expect(created.ok).toBe(true);
    if (!created.ok)
      throw new Error("Expected the controlled chatbot to be created.");
    expect(created.value.status).toBe("validated");
    const revision = await builder.repository.readRevision(
      workspaceId,
      created.value.systemId,
      created.value.currentRevisionId,
    );
    expect(revision?.instances.length).toBe(31);
    const instruction = revision?.instances.find(
      (item) =>
        String(item.definitionRef.id) === "builtin.ai.instruction-template",
    );
    expect(instruction?.metadata?.protectedConfiguration).toBe(true);

    const hasher = createSha256SystemBuildHasher();
    const artifacts = createMemoryArtifactPort(hasher);
    const builds = composeSystemBuild({
      documents,
      systemBuilder: builder,
      resolver: createAnyFacetImplementationResolver(),
      artifacts,
      hasher,
      guidedProfile: {
        id: "local-desktop",
        label: "This computer",
        deploymentProfile: "local-desktop",
        availableCapabilities: [],
        permittedTrustLevels: ["system-trusted"],
        hostApiVersion: "1.0.0",
        toolchainProfile: "system-builder/1.0.0",
      },
      now: () => timestamp,
    });
    const built = await builds.useCases.request.execute({
      buildId: normalizeSystemBuildId("build.controlled-chatbot-reference"),
      workspaceId,
      systemId: created.value.systemId,
      systemRevisionId: created.value.currentRevisionId,
      deploymentProfile: "local-desktop",
      availableCapabilities: [],
      permittedTrustLevels: ["system-trusted"],
      hostApiVersion: "1.0.0",
      toolchainProfile: "system-builder/1.0.0",
      actorId: "owner-1",
    });
    expect(built.ok && built.value.status).toBe("succeeded");
    if (!built.ok || !built.value.lockDigest)
      throw new Error("Expected a successful chatbot build.");
    const approved = await builds.useCases.approve.execute({
      workspaceId,
      buildId: built.value.buildId,
      expectedLockDigest: built.value.lockDigest,
      actorId: "approver-1",
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error("Expected an approved chatbot release.");
    expect(approved.value.releaseId).toBeDefined();
    expect(
      JSON.stringify({
        created: created.value,
        built: built.value,
        approved: approved.value,
      }),
    ).not.toContain("Answer clearly, use only approved context");
  });
});

function createAnyFacetImplementationResolver(): SystemBuildImplementationResolverPort {
  return {
    async resolve(request) {
      const facet = request.requiredFacets[0];
      if (!facet) {
        return {
          status: "unimplemented",
          definitionRef: request.definitionRef,
          selectedFacets: [],
          diagnostics: [
            {
              severity: "error",
              code: "facet.missing",
              message: "A build facet is required.",
            },
          ],
        };
      }
      const safeId = String(request.definitionRef.id).replace(
        /[^a-zA-Z0-9.-]/g,
        "-",
      );
      return {
        status: "ready",
        definitionRef: request.definitionRef,
        selectedRelease: {
          releaseId: normalizeAssetImplementationReleaseId(
            `implementation.${safeId}.1`,
          ),
          definitionRef: request.definitionRef,
          version: "1.0.0",
          status: "published",
          trustLevel: "system-trusted",
          facetKinds: [facet],
          packageDigest: `sha256:${"c".repeat(64)}`,
          publishedAt: timestamp,
          revoked: false,
        },
        selectedFacets: [
          {
            facetId: normalizeAssetImplementationFacetId(
              `facet.${safeId}.${facet}`,
            ),
            kind: facet,
            runtimeKind: "trusted-built-in",
            entryKey: `reference.${safeId}`,
            requiredCapabilities: [],
            compatibility: {
              definitionVersion: String(request.definitionRef.version),
              hostApiRange: ">=1.0.0 <2.0.0",
              deploymentProfiles: ["local-desktop"],
            },
          },
        ],
        diagnostics: [],
      };
    },
  };
}

function createReferenceImplementationResolver(): SystemBuildImplementationResolverPort {
  return {
    async resolve(request) {
      const id = String(request.definitionRef.id);
      const facet: AssetImplementationFacetKind = id.startsWith(
        "builtin.security.",
      )
        ? "policy"
        : id.startsWith("builtin.workflow.")
          ? "workflow"
          : id.startsWith("builtin.data.")
            ? "data"
            : "ui";
      if (request.requiredFacets[0] !== facet) {
        return {
          status: "unimplemented",
          definitionRef: request.definitionRef,
          selectedFacets: [],
          diagnostics: [
            {
              severity: "error",
              code: "facet.not-selected",
              message: "This implementation uses another supported facet.",
            },
          ],
        };
      }
      const safeId = id.replace(/[^a-zA-Z0-9.-]/g, "-");
      return {
        status: "ready",
        definitionRef: request.definitionRef,
        selectedRelease: {
          releaseId: normalizeAssetImplementationReleaseId(
            `implementation.${safeId}.1`,
          ),
          definitionRef: request.definitionRef,
          version: "1.0.0",
          status: "published",
          trustLevel: "system-trusted",
          facetKinds: [facet],
          packageDigest: `sha256:${"b".repeat(64)}`,
          publishedAt: timestamp,
          revoked: false,
        },
        selectedFacets: [
          {
            facetId: normalizeAssetImplementationFacetId(
              `facet.${safeId}.${facet}`,
            ),
            kind: facet,
            runtimeKind: "trusted-built-in",
            entryKey: `reference.${safeId}`,
            requiredCapabilities: [],
            compatibility: {
              definitionVersion: String(request.definitionRef.version),
              hostApiRange: ">=1.0.0 <2.0.0",
              deploymentProfiles: ["local-desktop"],
            },
          },
        ],
        diagnostics: [],
      };
    },
  };
}

function createMemoryArtifactPort(
  hasher: ReturnType<typeof createSha256SystemBuildHasher>,
): SystemBuildArtifactPort {
  const contentById = new Map<string, Uint8Array>();
  return {
    async putImmutable(request) {
      const bytes =
        typeof request.content === "string"
          ? new TextEncoder().encode(request.content)
          : (request.content as Uint8Array);
      const digest = hasher.digest(bytes);
      const artifactId = normalizeSystemBuildArtifactId(
        `artifact:${request.kind}:${digest.slice("sha256:".length)}`,
      );
      contentById.set(String(artifactId), bytes);
      return {
        artifactId,
        kind: request.kind,
        digest,
        mediaType: request.mediaType,
        sizeBytes: bytes.byteLength,
      };
    },
    async readVerified<TContent>(
      _workspace,
      descriptor: SystemBuildArtifactDescriptor,
    ) {
      const bytes = contentById.get(String(descriptor.artifactId));
      if (
        !bytes ||
        hasher.digest(bytes) !== descriptor.digest ||
        bytes.byteLength !== descriptor.sizeBytes
      ) {
        throw new Error("Artifact integrity verification failed.");
      }
      return bytes as TContent;
    },
  };
}
