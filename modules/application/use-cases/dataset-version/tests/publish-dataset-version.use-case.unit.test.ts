import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { createStructuredDatasetVersionRepository } from "../../../../adapters/persistence/dataset-version";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createSha256DatasetVersionHasher } from "../../../../adapters/storage/dataset-version";
import type { ArtifactObjectStoragePort } from "../../../ports/storage";
import type { DatasetVersionPublisherPort } from "../../../ports/dataset-version";
import { createFailureResult, createSuccessResult, createContractError } from "../../../../contracts/shared";
import { createRetrieveArtifactFailureResult, createRetrieveArtifactSuccessResult } from "../../../../contracts/storage";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { DatasetVersionRecord } from "../../../../contracts/dataset";
import { PublishDatasetVersionUseCase } from "../publish-dataset-version.use-case";

const hasher = createSha256DatasetVersionHasher();

function fixtureVersion(): { version: DatasetVersionRecord; contents: Map<string, Uint8Array> } {
  const contents = new Map([
    ["prepared/data.jsonl", new TextEncoder().encode("{}\n")],
    ["documentation/README.md", new TextEncoder().encode("# Dataset\n")],
    ["documentation/croissant.json", new TextEncoder().encode("{}\n")],
  ]);
  const artifacts = [
    { role: "dataset" as const, artifactKey: "prepared/data.jsonl", mediaType: "application/jsonl" },
    { role: "dataset-card" as const, artifactKey: "documentation/README.md", mediaType: "text/markdown" },
    { role: "croissant" as const, artifactKey: "documentation/croissant.json", mediaType: "application/ld+json" },
  ].map((artifact) => ({ ...artifact, digest: hasher.digest(contents.get(artifact.artifactKey)!), sizeBytes: contents.get(artifact.artifactKey)!.byteLength }));
  return {
    contents,
    version: {
      schemaVersion: "1.0", versionId: "dataset:v1" as never, datasetId: "dataset" as never, workspaceId: createWorkspaceId("workspace-a"),
      versionDigest: hasher.digest("version"), artifacts,
      lineage: { sources: [{ artifactKey: "source.csv", digest: hasher.digest("source"), mediaType: "text/csv" }], recipe: { artifactKey: "recipe.json", digest: hasher.digest("recipe"), implementationId: "prepare", implementationVersion: "1" }, quality: { policyId: "recommended", policyVersion: "1", policyFingerprint: hasher.digest("policy"), reportFingerprint: hasher.digest("report") } },
      documentation: { name: "Dataset", summary: "Summary", intendedUses: ["Training"], limitations: ["Fixture"] }, totalRows: 1,
      createdAt: "2026-07-29T16:00:00.000Z", createdBy: "person-1",
    },
  };
}

function storage(contents: Map<string, Uint8Array>): ArtifactObjectStoragePort {
  return {
    storeArtifact: testDouble.fn(),
    retrieveArtifact: (async (request: any, context?: any) => {
      const content = contents.get(request.key);
      return content
        ? createRetrieveArtifactSuccessResult({ key: request.key, sizeBytes: content.byteLength }, content, context)
        : createRetrieveArtifactFailureResult(createContractError("not-found", "missing"), context);
    }) as ArtifactObjectStoragePort["retrieveArtifact"],
    hasArtifact: testDouble.fn(),
    deleteArtifact: testDouble.fn(),
  };
}

describe("publish dataset version use case", () => {
  it("defaults to a confirmed private destination, publishes once, and records immutable evidence", async () => {
    const fixture = fixtureVersion();
    const repository = createStructuredDatasetVersionRepository(createInMemoryStructuredDocumentStore());
    await repository.createVersion(fixture.version);
    const publishDatasetVersion = testDouble.fn<DatasetVersionPublisherPort["publishDatasetVersion"]>(async (request, context) =>
      createSuccessResult({ provider: "hugging-face", repositoryId: request.repositoryId, revision: "a".repeat(40) }, context),
    );
    const useCase = new PublishDatasetVersionUseCase({ repository, artifacts: storage(fixture.contents), publisher: { publishDatasetVersion }, hasher, now: () => "2026-07-29T17:00:00.000Z" });
    const command = { workspaceId: "workspace-a", versionId: "dataset:v1", repositoryId: "example/dataset", confirmation: { approved: true as const, visibility: "private" as const } };
    const first = await useCase.execute(command, { workspaceId: "workspace-a", principalId: "person-1" });
    const retry = await useCase.execute(command, { workspaceId: "workspace-a", principalId: "person-1" });
    expect(first.ok).toBe(true);
    expect(retry.ok).toBe(true);
    expect(publishDatasetVersion).toHaveBeenCalledTimes(1);
    const request = publishDatasetVersion.mock.calls[0]?.[0]!;
    expect(request.visibility).toBe("private");
    expect(request.files.map((file) => file.path).sort()).toEqual(["README.md", "croissant.json", "data/dataset.jsonl"]);
    const publications = await repository.listPublications(createWorkspaceId("workspace-a"));
    expect(publications).toMatchObject([{ repositoryId: "example/dataset", revision: "a".repeat(40), visibility: "private" }]);
  });

  it("requires a separate public-access confirmation before provider work", async () => {
    const fixture = fixtureVersion();
    const repository = createStructuredDatasetVersionRepository(createInMemoryStructuredDocumentStore());
    await repository.createVersion(fixture.version);
    const publishDatasetVersion = testDouble.fn<DatasetVersionPublisherPort["publishDatasetVersion"]>();
    const useCase = new PublishDatasetVersionUseCase({ repository, artifacts: storage(fixture.contents), publisher: { publishDatasetVersion }, hasher });
    const result = await useCase.execute({ workspaceId: "workspace-a", versionId: "dataset:v1", repositoryId: "example/dataset", visibility: "public", confirmation: { approved: true, visibility: "public" } }, { workspaceId: "workspace-a" });
    expect(result.ok).toBe(false);
    expect(publishDatasetVersion).not.toHaveBeenCalled();
  });

  it("keeps the local version recoverable when provider publication fails", async () => {
    const fixture = fixtureVersion();
    const repository = createStructuredDatasetVersionRepository(createInMemoryStructuredDocumentStore());
    await repository.createVersion(fixture.version);
    const useCase = new PublishDatasetVersionUseCase({
      repository, artifacts: storage(fixture.contents), hasher,
      publisher: { publishDatasetVersion: testDouble.fn(async (_request, context) => createFailureResult(createContractError("unavailable", "provider unavailable"), context)) },
    });
    const result = await useCase.execute({ workspaceId: "workspace-a", versionId: "dataset:v1", repositoryId: "example/dataset", confirmation: { approved: true, visibility: "private" } }, { workspaceId: "workspace-a" });
    expect(result.ok).toBe(false);
    expect(await repository.readVersion(createWorkspaceId("workspace-a"), "dataset:v1" as never)).toEqual(fixture.version);
    expect(await repository.listPublications(createWorkspaceId("workspace-a"))).toEqual([]);
  });

  it("denies publication when authoritative workspace authorization rejects it", async () => {
    const fixture = fixtureVersion();
    const repository = createStructuredDatasetVersionRepository(createInMemoryStructuredDocumentStore());
    await repository.createVersion(fixture.version);
    const publishDatasetVersion = testDouble.fn<DatasetVersionPublisherPort["publishDatasetVersion"]>();
    const authorizeWorkspaceOperation = testDouble.fn(async () => {
      throw new Error("denied");
    });
    const useCase = new PublishDatasetVersionUseCase({
      repository,
      artifacts: storage(fixture.contents),
      publisher: { publishDatasetVersion },
      hasher,
      workspaceRepository: {
        readWorkspace: testDouble.fn(async () => ({
          workspaceId: createWorkspaceId("workspace-a"),
          displayName: "Workspace",
          status: "active" as const,
          createdAt: "2026-07-29T10:00:00.000Z",
          updatedAt: "2026-07-29T10:00:00.000Z",
        })),
      },
      workspaceAuthorization: { authorizeWorkspaceOperation },
    });
    const result = await useCase.execute(
      {
        workspaceId: "workspace-a",
        versionId: "dataset:v1",
        repositoryId: "example/dataset",
        createRepository: true,
        confirmation: { approved: true, visibility: "private" },
      },
      { workspaceId: "workspace-a" },
    );
    expect(result.ok).toBe(false);
    expect(publishDatasetVersion).not.toHaveBeenCalled();
    expect(authorizeWorkspaceOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "dataset-version.publish",
        requiredScopes: [
          "artifact:write",
          "provider-credential:use",
          "provider-repository:create",
        ],
      }),
    );
  });
});
