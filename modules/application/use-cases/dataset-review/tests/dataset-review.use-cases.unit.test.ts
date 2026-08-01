import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { DatasetVersionRecord } from "../../../../contracts/dataset";
import {
  ListDatasetReviewTargetsUseCase,
  ReadDatasetReviewPageUseCase,
  EditDatasetReviewRowUseCase,
  RejectDatasetReviewRowUseCase,
} from "../dataset-review.use-cases";

const workspaceId = createWorkspaceId("workspace-a");
const fingerprint = ("sha256:" + "b".repeat(64)) as `sha256:${string}`;

function record(id: string, parent?: string): DatasetVersionRecord {
  return {
    schemaVersion: "1.0",
    versionId: id,
    datasetId: "training-data",
    workspaceId,
    versionDigest: "sha256:" + "a".repeat(64),
    artifacts: [
      {
        role: "dataset",
        artifactKey: parent ? "reviewed.parquet" : "source.parquet",
        digest: "sha256:" + "a".repeat(64),
        mediaType: "application/vnd.apache.parquet",
        sizeBytes: 4,
      },
    ],
    lineage: {
      sources: [
        {
          sourceArtifactId: "source.parquet",
          artifactKey: "source.parquet",
          digest: "sha256:" + "a".repeat(64),
          mediaType: "application/vnd.apache.parquet",
        },
      ],
      recipe: {
        artifactKey: "recipe.json",
        digest: "sha256:" + "a".repeat(64),
        implementationId: "fixture",
        implementationVersion: "1",
      },
      quality: {
        policyId: "fixture",
        policyVersion: "1",
        policyFingerprint: "sha256:" + "a".repeat(64),
        reportFingerprint: "sha256:" + "a".repeat(64),
      },
      ...(parent ? { parentVersionId: parent } : {}),
    },
    documentation: {
      name: "Training data",
      summary: "Fixture",
      intendedUses: ["Testing"],
      limitations: ["Fixture"],
    },
    totalRows: parent ? 1 : 2,
    createdAt: parent ? "2026-01-02T00:00:00.000Z" : "2026-01-01T00:00:00.000Z",
    createdBy: "person-1",
  } as unknown as DatasetVersionRecord;
}

function dependencies() {
  const versions: DatasetVersionRecord[] = [];
  const finalize = testDouble.fn(async (input: any) => {
    const next = input.parentVersionId
      ? record("training-data:child", String(input.parentVersionId))
      : record("training-data:root");
    if (!versions.some((item) => item.versionId === next.versionId))
      versions.push(next);
    return { version: next, created: true };
  });
  return {
    versions,
    finalize,
    value: {
      repository: {
        createVersion: testDouble.fn(),
        readVersion: testDouble.fn(async () => undefined),
        listVersions: testDouble.fn(async () => versions),
        recordPublication: testDouble.fn(),
        readPublication: testDouble.fn(),
        listPublications: testDouble.fn(),
      },
      catalog: {
        browseArtifactCatalogRecords: testDouble.fn(async () => ({
          ok: true,
          value: { records: [] },
        })),
        readArtifactCatalogRecord: testDouble.fn(async () => ({
          ok: true,
          value: {
            record: {
              workspaceId,
              storageKey: "source.parquet",
              originalName: "Training data.parquet",
              artifactFamily: "structured-text",
              mediaType: "application/vnd.apache.parquet",
            },
          },
        })),
      },
      artifacts: {
        retrieveArtifact: testDouble.fn(async () => ({
          ok: true,
          value: {
            content: new Uint8Array([1, 2, 3, 4]),
            descriptor: { key: "source.parquet" },
          },
        })),
        hasArtifact: testDouble.fn(async () => ({
          ok: true,
          value: { exists: false },
        })),
        storeArtifact: testDouble.fn(async (request: any) => ({
          ok: true,
          value: request.descriptor,
        })),
        deleteArtifact: testDouble.fn(async () => ({
          ok: true,
          value: { deleted: true },
        })),
      },
      parquet: {
        readPage: testDouble.fn(async () => ({
          totalRows: 2,
          rows: [
            {
              rowIndex: 0,
              rowFingerprint: fingerprint,
              values: { instruction: "hello" },
            },
          ],
        })),
        rejectRow: testDouble.fn(async () => ({
          content: new Uint8Array([5, 6, 7]),
          totalRows: 1,
        })),
        replaceRow: testDouble.fn(async () => ({
          content: new Uint8Array([8, 9, 10]),
          totalRows: 2,
        })),
      },
      finalizer: { finalize },
      hasher: { digest: testDouble.fn(() => "sha256:" + "a".repeat(64)) },
      now: testDouble.fn(() => "2026-01-02T00:00:00.000Z"),
    } as any,
  };
}

describe("dataset review use cases", () => {
  it("lists only locally readable Parquet records and labels the original 1.0", async () => {
    const fixture = dependencies();
    fixture.value.catalog.browseArtifactCatalogRecords = testDouble.fn(
      async () => ({
        ok: true,
        value: {
          records: [
            {
              workspaceId,
              storageKey: "source.parquet",
              originalName: "Training data.parquet",
              artifactFamily: "structured-text",
              mediaType: "application/vnd.apache.parquet",
            },
          ],
        },
      }),
    );
    const list = new ListDatasetReviewTargetsUseCase(fixture.value);
    expect(await list.execute({ workspaceId }, { workspaceId })).toEqual([]);
    fixture.value.artifacts.hasArtifact = testDouble.fn(async () => ({
      ok: true,
      value: { exists: true },
    }));
    const groups = await list.execute({ workspaceId }, { workspaceId });
    expect(groups[0]?.versions[0]?.label).toBe("1.0");
    expect(groups[0]?.versions[0]?.artifactKey).toBe("source.parquet");
  });

  it("excludes immutable version cards whose Parquet bytes are no longer local", async () => {
    const fixture = dependencies();
    fixture.versions.push(record("training-data:root"));
    const list = new ListDatasetReviewTargetsUseCase(fixture.value);

    await expect(
      list.execute({ workspaceId }, { workspaceId }),
    ).resolves.toEqual([]);
    fixture.value.artifacts.hasArtifact = testDouble.fn(async () => ({
      ok: true,
      value: { exists: true },
    }));
    const groups = await list.execute({ workspaceId }, { workspaceId });
    expect(groups.length).toBe(1);
    expect(groups[0]?.versions[0]).toMatchObject({
      versionId: "training-data:root",
      artifactKey: "source.parquet",
      label: "1.0",
    });
  });

  it("creates an imported 1.0 baseline and a 1.1 child for the first rejection", async () => {
    const fixture = dependencies();
    const useCase = new RejectDatasetReviewRowUseCase(fixture.value);
    const result = await useCase.execute(
      {
        workspaceId,
        artifactKey: "source.parquet",
        rowIndex: 0,
        rowFingerprint: fingerprint,
      },
      {
        workspaceId,
        principalId: "person-1",
      },
    );
    expect(result.versionLabel).toBe("1.1");
    expect(fixture.finalize).toHaveBeenCalledTimes(2);
    expect(fixture.finalize.mock.calls[1]?.[0]).toMatchObject({
      parentVersionId: "training-data:root",
      totalRows: 1,
    });
  });

  it("replaces the exact reviewed row and creates an immutable 1.1 child", async () => {
    const fixture = dependencies();
    const useCase = new EditDatasetReviewRowUseCase(fixture.value);
    const values = { instruction: "Answer clearly." };
    const result = await useCase.execute(
      {
        workspaceId,
        artifactKey: "source.parquet",
        rowIndex: 0,
        rowFingerprint: fingerprint,
        values,
      },
      { workspaceId, principalId: "person-1" },
    );

    expect(result.versionLabel).toBe("1.1");
    expect(fixture.value.parquet.replaceRow).toHaveBeenCalledWith({
      workspaceId,
      content: new Uint8Array([1, 2, 3, 4]),
      rowIndex: 0,
      rowFingerprint: fingerprint,
      values,
    });
    expect(fixture.finalize).toHaveBeenCalledTimes(2);
    expect(fixture.finalize.mock.calls[1]?.[0]).toMatchObject({
      parentVersionId: "training-data:root",
      totalRows: 2,
      recipeSnapshot: {
        operation: "dataset-row-edit",
        rowIndex: 0,
        originalRowFingerprint: fingerprint,
      },
    });
    expect(
      JSON.stringify(fixture.finalize.mock.calls[1]?.[0].recipeSnapshot),
    ).not.toContain("Answer clearly.");
  });

  it("rejects oversized edits before reading or changing protected dataset bytes", async () => {
    const fixture = dependencies();
    const useCase = new EditDatasetReviewRowUseCase(fixture.value);
    await expect(
      useCase.execute(
        {
          workspaceId,
          artifactKey: "source.parquet",
          rowIndex: 0,
          rowFingerprint: fingerprint,
          values: { instruction: "x".repeat(33 * 1024) },
        },
        { workspaceId, principalId: "person-1" },
      ),
    ).rejects.toThrow("too large");
    expect(fixture.value.artifacts.retrieveArtifact).not.toHaveBeenCalled();
    expect(fixture.value.parquet.replaceRow).not.toHaveBeenCalled();
  });

  it("fails closed when a version id and artifact key do not identify the same immutable version", async () => {
    const fixture = dependencies();
    fixture.value.repository.readVersion = testDouble.fn(async () =>
      record("training-data:root"),
    );
    const useCase = new ReadDatasetReviewPageUseCase(fixture.value);
    await expect(
      useCase.execute(
        {
          workspaceId,
          versionId: "training-data:root",
          artifactKey: "different.parquet",
          page: 0,
          pageSize: 10,
        },
        { workspaceId, principalId: "person-1" },
      ),
    ).rejects.toThrow("not found");
    expect(fixture.value.artifacts.retrieveArtifact).not.toHaveBeenCalled();
  });

  it("denies cross-workspace reads before artifact access", async () => {
    const fixture = dependencies();
    const useCase = new ReadDatasetReviewPageUseCase(fixture.value);
    await expect(
      useCase.execute(
        {
          workspaceId,
          artifactKey: "source.parquet",
          page: 0,
          pageSize: 10,
        },
        {
          workspaceId: createWorkspaceId("workspace-b"),
          principalId: "person-1",
        },
      ),
    ).rejects.toThrow("not available");
    expect(
      fixture.value.catalog.readArtifactCatalogRecord,
    ).not.toHaveBeenCalled();
  });

  it("gives a corrective local-storage message when bytes disappear after listing", async () => {
    const fixture = dependencies();
    fixture.value.artifacts.retrieveArtifact = testDouble.fn(async () => ({
      ok: false,
      error: {
        code: "not-found",
        message: "Failed to retrieve artifact bytes.",
      },
    }));
    const useCase = new ReadDatasetReviewPageUseCase(fixture.value);

    await expect(
      useCase.execute(
        {
          workspaceId,
          artifactKey: "source.parquet",
          page: 0,
          pageSize: 10,
        },
        {
          workspaceId,
          principalId: "person-1",
        },
      ),
    ).rejects.toThrow("Localize or import it again");
    expect(fixture.value.parquet.readPage).not.toHaveBeenCalled();
  });
});
