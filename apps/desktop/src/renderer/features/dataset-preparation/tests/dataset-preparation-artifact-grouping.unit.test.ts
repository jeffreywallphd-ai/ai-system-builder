import { describe, expect, it } from "vitest";

import {
  filterGeneratedDatasetPreparationArtifacts,
  filterTaskRelevantDatasetPreparationArtifacts,
  filterUploadedDatasetPreparationArtifacts,
  type DatasetPreparationSourceArtifact,
} from "../helpers/datasetPreparationArtifactGrouping";

describe("dataset preparation artifact grouping", () => {
  it("shows workspace-prefixed uploaded artifacts in the uploaded source list", () => {
    const artifacts: DatasetPreparationSourceArtifact[] = [
      {
        artifactId: "uploaded-md",
        label: "host-model.md",
        storageKey:
          "workspaces/workspace.d64c780b4ce34f62a65fb0b0ae4f80ca/artifacts/files/uploads/20260605133238388-9976fe6a4c5b4f4784aad3df0c5b37bd.md",
      },
    ];

    expect(filterUploadedDatasetPreparationArtifacts(artifacts)).toEqual(
      artifacts,
    );
    expect(filterGeneratedDatasetPreparationArtifacts(artifacts)).toEqual([]);
  });

  it("shows workspace-prefixed generated artifacts in the generated source list", () => {
    const artifacts: DatasetPreparationSourceArtifact[] = [
      {
        artifactId: "generated-json",
        label: "training-examples.jsonl",
        storageKey:
          "workspaces/workspace.d64c780b4ce34f62a65fb0b0ae4f80ca/artifacts/files/generated/training-examples.jsonl",
      },
    ];

    expect(filterGeneratedDatasetPreparationArtifacts(artifacts)).toEqual(
      artifacts,
    );
    expect(filterUploadedDatasetPreparationArtifacts(artifacts)).toEqual([]);
  });

  it("keeps image artifacts out of LLM source lists", () => {
    const artifacts: DatasetPreparationSourceArtifact[] = [
      {
        artifactId: "uploaded-md",
        label: "host-model.md",
        storageKey:
          "workspaces/workspace-1/artifacts/files/uploads/host-model.md",
        mediaType: "text/markdown",
      },
      {
        artifactId: "uploaded-image",
        label: "product.png",
        storageKey:
          "workspaces/workspace-1/artifacts/files/uploads/product.png",
        mediaType: "image/png",
      },
    ];

    expect(
      filterTaskRelevantDatasetPreparationArtifacts(
        artifacts,
        "llm-instruction",
      ).map((artifact) => artifact.artifactId),
    ).toEqual(["uploaded-md"]);
  });

  it("keeps text documents out of vision source lists while allowing image manifests", () => {
    const artifacts: DatasetPreparationSourceArtifact[] = [
      {
        artifactId: "uploaded-md",
        label: "host-model.md",
        storageKey:
          "workspaces/workspace-1/artifacts/files/uploads/host-model.md",
        mediaType: "text/markdown",
      },
      {
        artifactId: "uploaded-image",
        label: "product.png",
        storageKey:
          "workspaces/workspace-1/artifacts/files/uploads/product.png",
        mediaType: "image/png",
      },
      {
        artifactId: "uploaded-manifest",
        label: "labels.jsonl",
        storageKey:
          "workspaces/workspace-1/artifacts/files/uploads/labels.jsonl",
        mediaType: "application/x-ndjson",
      },
    ];

    expect(
      filterTaskRelevantDatasetPreparationArtifacts(
        artifacts,
        "vision-classification",
      ).map((artifact) => artifact.artifactId),
    ).toEqual(["uploaded-image", "uploaded-manifest"]);
  });

  it("does not offer formats that the preparation runtime cannot read", () => {
    const artifacts: DatasetPreparationSourceArtifact[] = [
      {
        artifactId: "legacy-word",
        label: "notes.doc",
        storageKey: "uploads/notes.doc",
      },
      {
        artifactId: "spreadsheet",
        label: "rows.xlsx",
        storageKey: "uploads/rows.xlsx",
      },
      {
        artifactId: "table",
        label: "rows.parquet",
        storageKey: "uploads/rows.parquet",
      },
    ];

    expect(
      filterTaskRelevantDatasetPreparationArtifacts(
        artifacts,
        "llm-classification",
      ).map((artifact) => artifact.artifactId),
    ).toEqual(["table"]);
  });
});
