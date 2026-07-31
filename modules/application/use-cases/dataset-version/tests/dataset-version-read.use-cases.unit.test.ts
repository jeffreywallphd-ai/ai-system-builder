import { describe, expect, it } from "../../../../testing/node-test";
import { createStructuredDatasetVersionRepository } from "../../../../adapters/persistence/dataset-version";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createSha256DatasetVersionHasher } from "../../../../adapters/storage/dataset-version";
import type { DatasetVersionRecord } from "../../../../contracts/dataset";
import type { ArtifactObjectStoragePort } from "../../../ports/storage";
import { createContractError } from "../../../../contracts/shared";
import { createRetrieveArtifactFailureResult, createRetrieveArtifactSuccessResult } from "../../../../contracts/storage";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { CompareDatasetVersionsUseCase, ListDatasetVersionsUseCase, ReadDatasetVersionReproductionUseCase } from "../dataset-version-read.use-cases";

const digest = (value: string) => `sha256:${value.repeat(64).slice(0, 64)}` as const;
const hasher = createSha256DatasetVersionHasher();
const recipeBytes = new TextEncoder().encode(JSON.stringify({ recipe: { task: { taskType: "llm-instruction" } }, split: { seed: 42 }, output: { format: "jsonl" } }));
function version(id: string, sourceDigest: string, rows: number): DatasetVersionRecord {
  return {
    schemaVersion: "1.0", versionId: id as never, datasetId: "dataset" as never, workspaceId: createWorkspaceId("workspace-a"), versionDigest: digest(id === "v1" ? "a" : "b"),
    artifacts: [{ role: "dataset", artifactKey: `prepared/${id}.jsonl`, digest: digest(id === "v1" ? "c" : "d"), mediaType: "application/jsonl", sizeBytes: 10, rowCount: rows }],
    lineage: { sources: [{ sourceArtifactId: "source-1", artifactKey: "sources/data.csv", digest: digest(sourceDigest), mediaType: "text/csv" }], recipe: { artifactKey: "recipes/r.json", digest: hasher.digest(recipeBytes), implementationId: "prepare", implementationVersion: "1" }, quality: { policyId: "recommended", policyVersion: "1", policyFingerprint: digest("f"), reportFingerprint: digest("1") } },
    documentation: { name: "Dataset", summary: "Summary", intendedUses: ["Training"], limitations: ["Fixture"] }, totalRows: rows, createdAt: id === "v1" ? "2026-07-29T10:00:00.000Z" : "2026-07-29T11:00:00.000Z", createdBy: "person-1",
  };
}

const artifacts = {
  retrieveArtifact: (async (request: { key: string }, context: object) => request.key === "recipes/r.json"
    ? createRetrieveArtifactSuccessResult({ key: request.key, mediaType: "application/json", sizeBytes: recipeBytes.byteLength }, recipeBytes, context)
    : createRetrieveArtifactFailureResult(createContractError("not-found", "Missing."), context)) as ArtifactObjectStoragePort["retrieveArtifact"],
} as ArtifactObjectStoragePort;

describe("dataset version read use cases", () => {
  it("derives bounded deterministic comparison and reproduction lineage", async () => {
    const repository = createStructuredDatasetVersionRepository(createInMemoryStructuredDocumentStore());
    await repository.createVersion(version("v1", "2", 10));
    await repository.createVersion(version("v2", "3", 14));
    const comparison = await new CompareDatasetVersionsUseCase(repository).execute({ workspaceId: createWorkspaceId("workspace-a"), fromVersionId: "v1" as never, toVersionId: "v2" as never });
    expect(comparison).toMatchObject({ identical: false, rowDelta: 4, sources: { added: 0, removed: 0, changed: 1 }, changedArtifactRoles: ["dataset"] });
    expect((await new ListDatasetVersionsUseCase(repository).execute({ workspaceId: createWorkspaceId("workspace-a"), datasetId: "dataset" })).length).toBe(2);
    expect(await new ReadDatasetVersionReproductionUseCase({ repository, artifacts, hasher }).execute({ workspaceId: createWorkspaceId("workspace-a"), versionId: "v2" as never }, { workspaceId: createWorkspaceId("workspace-a") })).toMatchObject({
      versionId: "v2",
      sourceArtifactIds: ["source-1"],
      recipeSnapshot: { split: { seed: 42 }, output: { format: "jsonl" } },
    });
  });

  it("does not compare different datasets or inaccessible versions", async () => {
    const repository = createStructuredDatasetVersionRepository(createInMemoryStructuredDocumentStore());
    await repository.createVersion(version("v1", "2", 10));
    expect(await new CompareDatasetVersionsUseCase(repository).execute({ workspaceId: createWorkspaceId("workspace-b"), fromVersionId: "v1" as never, toVersionId: "v2" as never })).toBeUndefined();
  });

  it("fails closed when workspace authorization denies version history", async () => {
    const repository = createStructuredDatasetVersionRepository(createInMemoryStructuredDocumentStore());
    await repository.createVersion(version("v1", "2", 10));
    const denied = new ListDatasetVersionsUseCase({
      repository,
      workspaceRepository: { readWorkspace: async () => ({ workspaceId: createWorkspaceId("workspace-a"), displayName: "A", status: "active", createdAt: "2026-07-29T10:00:00.000Z" } as any) },
      workspaceAuthorization: { authorizeWorkspaceOperation: async () => { throw new Error("denied"); } },
    });
    expect(await denied.execute({ workspaceId: createWorkspaceId("workspace-a") }, { workspaceId: createWorkspaceId("workspace-a"), principalId: "person-2" })).toEqual([]);
  });
});
