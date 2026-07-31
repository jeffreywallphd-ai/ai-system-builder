import { describe, expect, it } from "../../../testing/node-test";
import {
  groupDatasetVersionsForDisplay,
  type DatasetVersionRecord,
} from "../index";

function version(input: {
  id: string;
  createdAt: string;
  parent?: string;
  datasetId?: string;
}): DatasetVersionRecord {
  return {
    versionId: input.id,
    datasetId: input.datasetId ?? "training-data",
    createdAt: input.createdAt,
    documentation: { name: "Training data" },
    lineage: input.parent ? { parentVersionId: input.parent } : {},
  } as DatasetVersionRecord;
}

describe("dataset version display grouping", () => {
  it("labels independent preparations as majors and row-review descendants as minors", () => {
    const grouped = groupDatasetVersionsForDisplay([
      version({ id: "root-1", createdAt: "2026-01-01T00:00:00.000Z" }),
      version({
        id: "minor-1",
        parent: "root-1",
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
      version({
        id: "minor-2",
        parent: "minor-1",
        createdAt: "2026-01-03T00:00:00.000Z",
      }),
      version({ id: "root-2", createdAt: "2026-02-01T00:00:00.000Z" }),
    ]);
    expect(grouped.length).toBe(1);
    expect(
      grouped[0]?.versions.map((entry) => [
        entry.version.versionId,
        entry.label,
        entry.latest,
      ]),
    ).toEqual([
      ["root-2", "2.0", true],
      ["minor-2", "1.2", false],
      ["minor-1", "1.1", false],
      ["root-1", "1.0", false],
    ]);
  });

  it("keeps distinct datasets in one card group each", () => {
    const grouped = groupDatasetVersionsForDisplay([
      version({
        id: "a",
        datasetId: "alpha",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
      version({
        id: "b",
        datasetId: "beta",
        createdAt: "2026-01-02T00:00:00.000Z",
      }),
    ]);
    expect(grouped.length).toBe(2);
    expect(grouped.map((group) => group.datasetId).sort()).toEqual([
      "alpha",
      "beta",
    ]);
  });
});
