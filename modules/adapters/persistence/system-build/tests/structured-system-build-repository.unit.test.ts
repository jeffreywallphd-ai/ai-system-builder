import { describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import { createStructuredSystemBuildRepository } from "../createStructuredSystemBuildRepository";

const build = (workspaceId: string, buildId: string) => ({
  buildId,
  targetWorkspaceId: workspaceId,
  systemId: "system-1",
  systemRevisionId: "revision-1",
  status: "queued",
  revision: 0,
  outputArtifacts: [],
  evidenceArtifacts: [],
  diagnostics: [],
  assurance: "not-verified",
  cancellationRequested: false,
  createdAt: "2026-07-17T00:00:00.000Z",
  requestedBy: "person-1",
}) as any;

const release = (workspaceId: string, releaseId: string) => ({
  releaseId,
  targetWorkspaceId: workspaceId,
  systemId: "system-1",
  systemRevisionId: "revision-1",
  sourceBuildId: "build-1",
  lockDigest: `sha256:${"a".repeat(64)}`,
  releaseDigest: `sha256:${"b".repeat(64)}`,
  lock: { schemaVersion: "1.0", systemId: "system-1", systemRevisionId: "revision-1", systemRevisionDigest: `sha256:${"c".repeat(64)}`, deploymentProfile: "local-desktop", hostApiVersion: "1.0.0", toolchainProfile: "builder/1", policyCompilerVersion: "1", workflowCompilerVersion: "1", schemaCompilerVersion: "1", resolvedImplementations: [] },
  artifacts: [],
  compatibility: { deploymentProfiles: ["local-desktop"], hostApiVersion: "1.0.0" },
  assurance: "repeatable",
  approvedAt: "2026-07-17T00:00:00.000Z",
  approvedBy: "person-2",
  createdAt: "2026-07-17T00:00:00.000Z",
}) as any;

describe("structured system build repository", () => {
  it("isolates workspaces and enforces optimistic build updates", async () => {
    const repository = createStructuredSystemBuildRepository(createInMemoryStructuredDocumentStore());
    await repository.createBuild(build("workspace-a", "build-1"));
    expect(await repository.readBuild("workspace-b" as any, "build-1" as any)).toBeUndefined();
    expect(await repository.listBuilds("workspace-b" as any)).toEqual([]);
    await expect(repository.updateBuild({ ...build("workspace-a", "build-1"), status: "running", revision: 1 } as any, 0)).resolves.toMatchObject({ status: "running", revision: 1 });
    await expect(repository.updateBuild({ ...build("workspace-a", "build-1"), status: "failed", revision: 1 } as any, 0)).rejects.toThrow();
  });

  it("keeps releases immutable while allowing idempotent storage", async () => {
    const repository = createStructuredSystemBuildRepository(createInMemoryStructuredDocumentStore());
    const value = release("workspace-a", "release-1");
    await repository.saveRelease(value);
    await expect(repository.saveRelease(value)).resolves.toEqual(value);
    await expect(repository.saveRelease({ ...value, approvedBy: "different-person" })).rejects.toThrow();
    expect(await repository.readRelease("workspace-b" as any, "release-1" as any)).toBeUndefined();
  });
});
