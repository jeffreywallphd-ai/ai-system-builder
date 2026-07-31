import { describe, expect, it } from "../../testing/node-test";
import {
  normalizeDatasetVersionDigest,
  normalizeDatasetVersionPublicationRecord,
  normalizeDatasetVersionRecord,
  type DatasetVersionRecord,
} from ".";

const digest = (character: string) => `sha256:${character.repeat(64)}` as const;

function record(): DatasetVersionRecord {
  return {
    schemaVersion: "1.0",
    versionId: " dataset-v1 " as DatasetVersionRecord["versionId"],
    datasetId: " dataset " as DatasetVersionRecord["datasetId"],
    workspaceId: " workspace-a " as DatasetVersionRecord["workspaceId"],
    versionDigest: digest("A"),
    artifacts: [
      {
        role: "dataset",
        artifactKey: " datasets/data.jsonl ",
        digest: digest("b"),
        mediaType: " APPLICATION/JSONL ",
        sizeBytes: 1,
      },
    ],
    lineage: {
      sources: [
        {
          artifactKey: " sources/data.csv ",
          digest: digest("c"),
          mediaType: " TEXT/CSV ",
        },
      ],
      recipe: {
        artifactKey: " recipes/dataset.json ",
        digest: digest("d"),
        implementationId: " builtin.prepare ",
        implementationVersion: " 1.0.0 ",
      },
      quality: {
        policyId: " recommended ",
        policyVersion: " 1 ",
        policyFingerprint: digest("e"),
        reportFingerprint: digest("f"),
      },
    },
    documentation: {
      name: " Dataset ",
      summary: " Training rows. ",
      intendedUses: [" Training. "],
      limitations: [" English only. "],
    },
    totalRows: 1,
    createdAt: "2026-07-29T12:00:00.000Z",
    createdBy: " person-1 ",
  };
}

describe("dataset version contracts", () => {
  it("normalizes complete bounded version metadata", () => {
    expect(normalizeDatasetVersionRecord(record())).toMatchObject({
      versionId: "dataset-v1",
      datasetId: "dataset",
      workspaceId: "workspace-a",
      versionDigest: digest("a"),
      artifacts: [
        {
          artifactKey: "datasets/data.jsonl",
          mediaType: "application/jsonl",
        },
      ],
      documentation: {
        name: "Dataset",
        intendedUses: ["Training."],
      },
      createdBy: "person-1",
    });
  });

  it("rejects partial, duplicate, malformed, and unbounded records", () => {
    expect(() =>
      normalizeDatasetVersionRecord({ ...record(), artifacts: [] }),
    ).toThrow("complete dataset");
    expect(() =>
      normalizeDatasetVersionRecord({
        ...record(),
        lineage: {
          ...record().lineage,
          sources: [record().lineage.sources[0]!, record().lineage.sources[0]!],
        },
      }),
    ).toThrow("unique");
    expect(() => normalizeDatasetVersionDigest("sha256:short")).toThrow(
      "SHA-256",
    );
    expect(() =>
      normalizeDatasetVersionRecord({
        ...record(),
        documentation: {
          ...record().documentation,
          limitations: Array.from({ length: 101 }, () => "item"),
        },
      }),
    ).toThrow("at most 100");
  });

  it("accepts only explicit supported publication destinations", () => {
    expect(
      normalizeDatasetVersionPublicationRecord({
        schemaVersion: "1.0",
        publicationId: " publication-1 " as never,
        versionId: " dataset-v1 " as never,
        workspaceId: " workspace-a " as never,
        provider: "hugging-face",
        repositoryId: " example/dataset ",
        revision: " commit-1 ",
        visibility: "private",
        publishedAt: "2026-07-29T13:00:00.000Z",
        publishedBy: " person-1 ",
      }),
    ).toMatchObject({
      publicationId: "publication-1",
      versionId: "dataset-v1",
      repositoryId: "example/dataset",
      visibility: "private",
    });
    expect(() =>
      normalizeDatasetVersionPublicationRecord({
        schemaVersion: "1.0",
        publicationId: "publication-1" as never,
        versionId: "dataset-v1" as never,
        workspaceId: "workspace-a" as never,
        provider: "hugging-face",
        repositoryId: "not-namespaced",
        revision: "commit-1",
        visibility: "public",
        publishedAt: "2026-07-29T13:00:00.000Z",
        publishedBy: "person-1",
      }),
    ).toThrow("namespace/name");
  });
});
