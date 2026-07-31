import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DatasetPreparationFeature } from "../components/DatasetPreparationFeature";
import { resetDatasetPreparationPageStateForTests } from "../hooks/useDatasetPreparationFeature";

describe("desktop dataset preparation workflow", () => {
  it("uses the shared four-step sequence and keeps technical tuning under Advanced settings", () => {
    resetDatasetPreparationPageStateForTests();
    const markup = renderToStaticMarkup(
      <DatasetPreparationFeature
        workspaceId="workspace-a"
        client={
          {
            browseSourceArtifacts: async () => [],
            startPrepareTrainingDataset: async () => ({
              error: { code: "unavailable", message: "Unavailable." },
            }),
            readPrepareTrainingDatasetTask: async () => ({
              ok: true,
              status: "unknown",
            }),
            cancelPrepareTrainingDatasetTask: async () => ({ ok: true }),
            approvePreparedTrainingDataset: async () => ({
              ok: false,
              error: { code: "unavailable", message: "Unavailable." },
            }),
          } as any
        }
      />,
    );

    expect(markup).toContain('role="list"');
    expect(markup).toContain('aria-label="Dataset preparation workflow"');
    expect(markup.match(/role="listitem"/g) ?? []).toHaveLength(4);
    expect(markup).toContain("Training settings");
    expect(markup).toContain("Save training settings");
    expect(markup).toContain("No saved settings yet");
    expect(markup.indexOf("Training settings")).toBeLessThan(
      markup.indexOf("Add data"),
    );
    expect(markup).toContain("Add data");
    expect(markup).toContain("Check data");
    expect(markup).toContain("Prepare dataset");
    expect(markup).toContain("Choose compatible sources first");
    expect(markup).toContain("Standard");
    expect(markup).toContain("Strict");
    expect(markup).not.toContain("Preparation style");
    expect(markup).toContain("Review and create");
    expect(markup).not.toContain("Task settings");
    expect(markup).not.toContain("Save and publish");
    expect(markup).toContain(
      "The prepared dataset is saved locally as a reusable version",
    );
    expect(markup).toContain(
      "Accepted text sources: .csv, .json, .jsonl/.ndjson",
    );
    expect(markup).toContain(
      "Convert legacy .doc files to .docx and Excel .xls/.xlsx files to .csv",
    );
    expect(markup).toContain("Advanced settings");
    expect(markup).toContain("Data checks");
    expect(markup).toContain("What these checks cover");
    expect(markup).toContain("Advanced data rules");
    expect(markup).toContain("Run checks and prepare");
    expect(markup).toContain("Every accepted training example");
    expect(markup).not.toContain(
      "Scanned-image text recognition is not included",
    );
    expect(markup).not.toContain(
      '<div class="dataset-preparation__actions ui-workflow__actions"></div>',
    );
  });
});
