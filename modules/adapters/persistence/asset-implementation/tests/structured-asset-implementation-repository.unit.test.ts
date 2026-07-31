import { describe, expect, it } from "../../../../testing/node-test";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { AssetImplementationRelease } from "../../../../contracts/asset-implementation";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import { createStructuredAssetImplementationRepository } from "../createStructuredAssetImplementationRepository";

const definitionRef = {
  kind: "asset-definition-version",
  id: "system.text-input",
  version: "1.0.0",
} as const;

function release(
  workspaceId = createWorkspaceId("workspace-a"),
  version = "1.0.0",
): AssetImplementationRelease {
  return {
    releaseId: "release.text-input" as never,
    workspaceId,
    definitionRef: definitionRef as never,
    version,
    status: "published",
    trustLevel: "workspace-approved",
    sourceSnapshotId: "snapshot.1" as never,
    sourceBuildId: "build.1" as never,
    facets: [
      {
        facetId: "facet.ui" as never,
        kind: "ui",
        runtimeKind: "sandboxed-browser",
        entryKey: "main",
        artifact: {
          artifactId: "implementation-artifact:bundle:aaaaaaaa" as never,
          kind: "bundle",
          digest: `sha256:${"a".repeat(64)}`,
          mediaType: "application/javascript",
          sizeBytes: 10,
        },
        requiredCapabilities: [],
        compatibility: {
          definitionVersion: "1.0.0",
          hostApiRange: ">=1.0.0 <2.0.0",
          deploymentProfiles: ["local-desktop"],
        },
      },
    ],
    packageDigest: `sha256:${"b".repeat(64)}`,
    evidenceArtifacts: [],
    createdAt: "2026-07-17T12:00:00.000Z",
    publishedAt: "2026-07-17T12:00:00.000Z",
    publishedBy: "user-a",
  };
}

describe("structured asset implementation repository", () => {
  it("preserves immutable releases and workspace visibility", async () => {
    const root = createInMemoryStructuredDocumentStore();
    const repository = createStructuredAssetImplementationRepository(
      root.forOrganization(createOrganizationId("org-a")),
    );
    await repository.saveRelease(release());
    expect(
      (await repository.listReleases(createWorkspaceId("workspace-a"))).length,
    ).toBe(1);
    expect(
      (await repository.listReleases(createWorkspaceId("workspace-b"))).length,
    ).toBe(0);
    await expect(
      repository.saveRelease(
        release(createWorkspaceId("workspace-a"), "1.1.0"),
      ),
    ).rejects.toThrow(/conflict/i);
  });

  it("isolates identical record identities by organization and enforces optimistic binding revisions", async () => {
    const root = createInMemoryStructuredDocumentStore();
    const a = createStructuredAssetImplementationRepository(
      root.forOrganization(createOrganizationId("org-a")),
    );
    const b = createStructuredAssetImplementationRepository(
      root.forOrganization(createOrganizationId("org-b")),
    );
    await a.saveRelease(release());
    await b.saveRelease(release(createWorkspaceId("workspace-b")));
    expect(
      (await a.listReleases(createWorkspaceId("workspace-a"))).length,
    ).toBe(1);
    expect(
      (await b.listReleases(createWorkspaceId("workspace-b"))).length,
    ).toBe(1);

    const binding = {
      bindingId: "binding.text-input" as never,
      workspaceId: createWorkspaceId("workspace-a"),
      definitionRef: definitionRef as never,
      releaseId: "release.text-input" as never,
      status: "active" as const,
      priority: 100,
      revision: 1,
      createdAt: "2026-07-17T12:00:00.000Z",
      updatedAt: "2026-07-17T12:00:00.000Z",
      approvedBy: "user-a",
    };
    await a.createBinding(binding);
    await a.updateBinding({ ...binding, status: "disabled", revision: 2 }, 1);
    await expect(
      a.updateBinding({ ...binding, status: "disabled", revision: 2 }, 1),
    ).rejects.toThrow(/conflict/i);
  });
});
