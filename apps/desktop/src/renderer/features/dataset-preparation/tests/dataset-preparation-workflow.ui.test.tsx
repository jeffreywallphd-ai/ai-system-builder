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
    expect(markup).toContain(
      'aria-label="Dataset preparation workflow"',
    );
    expect((markup.match(/role="listitem"/g) ?? [])).toHaveLength(4);
    expect(markup).toContain("Add data");
    expect(markup).toContain("Check data");
    expect(markup).toContain("Prepare dataset");
    expect(markup).toContain("Review and create");
    expect(markup).toContain("Advanced settings");
    expect(markup).toContain("Data checks");
    expect(markup).toContain("Recommended");
    expect(markup).toContain("Advanced data rules");
    expect(markup).toContain("Run checks and prepare");
    expect(markup).toContain("80/10/10");
  });
});
