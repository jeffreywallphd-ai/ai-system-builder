import { describe, expect, it } from "../../../../testing/node-test";
import {
  countArtifacts,
  countAssetsUsed,
  countModels,
  countSystems,
  loadPageDashboardMetrics,
  type PageDashboardDataSource,
} from "../dashboardMetrics";

describe("page dashboard metrics", () => {
  it("counts only active composed systems with published releases", () => {
    expect(
      countSystems(
        [{ systemId: "one" }, { systemId: "two" }, { systemId: "three" }],
        [
          {
            systemId: "one",
            approvedAt: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
            assetCount: 2,
          },
          {
            systemId: "retired",
            approvedAt: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
            assetCount: 1,
          },
        ],
      ),
    ).toEqual({ composed: 3, published: 1, unpublished: 2 });
  });

  it("counts a system once when it has multiple published releases", () => {
    expect(
      countSystems(
        [{ systemId: "one" }, { systemId: "two" }],
        [
          {
            systemId: "one",
            approvedAt: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
            assetCount: 1,
          },
          {
            systemId: "one",
            approvedAt: "2026-02-01T00:00:00.000Z",
            createdAt: "2026-02-01T00:00:00.000Z",
            assetCount: 2,
          },
        ],
      ),
    ).toEqual({ composed: 2, published: 1, unpublished: 1 });
  });

  it("separates installed inventory from trained models", () => {
    expect(
      countModels([
        { source: "huggingface", localFilesAvailable: true },
        { source: "local", localFilesAvailable: false },
        { source: "generated", localFilesAvailable: true },
      ]),
    ).toEqual({ installed: 1, trained: 1 });
  });

  it("counts uploaded artifacts and generated images", () => {
    expect(
      countArtifacts([
        {
          artifactFamily: "document",
          sourceKind: "upload",
          storageKey: "workspaces/w/uploads/a.txt",
        },
        {
          artifactFamily: "document",
          storageKey: "workspaces/w/uploads/legacy.txt",
        },
        {
          artifactFamily: "image",
          sourceKind: "generated",
          storageKey: "workspaces/w/generated/images/a.png",
        },
        {
          artifactFamily: "image",
          storageKey: "workspaces/w/generated/images/legacy.png",
        },
        {
          artifactFamily: "structured-text",
          sourceKind: "upload",
          storageKey: "workspaces/w/uploads/a.metadata+json",
        },
        {
          artifactFamily: "document",
          sourceKind: "upload",
          storageKey: "workspaces/w/system-builds/build-a/uploads/input.txt",
        },
      ]),
    ).toEqual({ uploaded: 2, imagesGenerated: 2 });
  });

  it("uses only the latest published release for each system's asset count", () => {
    expect(
      countAssetsUsed([
        {
          systemId: "one",
          approvedAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          assetCount: 2,
        },
        {
          systemId: "one",
          approvedAt: "2026-02-01T00:00:00.000Z",
          createdAt: "2026-02-01T00:00:00.000Z",
          assetCount: 4,
        },
        {
          systemId: "two",
          approvedAt: "2026-01-15T00:00:00.000Z",
          createdAt: "2026-01-15T00:00:00.000Z",
          assetCount: 3,
        },
      ]),
    ).toBe(7);
  });

  it("builds the requested home summary and deduplicates active ids", async () => {
    const source: PageDashboardDataSource = {
      listSystems: async () => [{ systemId: "one" }],
      listReleases: async () => [
        {
          systemId: "one",
          approvedAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          assetCount: 1,
        },
      ],
      listDatasetIds: async () => ["dataset-a", "dataset-a", "dataset-b"],
      listArtifacts: async () => [],
      listModels: async () => [{ source: "generated" }],
      listCustomAssetIds: async () => ["asset-a", "asset-a", "asset-b"],
      readSettingsDefaults: async () => ({
        runtimeDevice: "cuda",
        globalModel: "model/default",
      }),
    };

    await expect(
      loadPageDashboardMetrics("home", source, "workspace-one"),
    ).resolves.toEqual([
      { label: "Systems Published", value: 1 },
      { label: "Training Datasets Created", value: 2 },
      { label: "Custom Models Trained", value: 1 },
      { label: "Custom Assets Created", value: 2 },
    ]);
  });
});
