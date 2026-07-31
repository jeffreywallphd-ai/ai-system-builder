import { describe, expect, it } from "../../../../testing/node-test";
import { createDatasetVersionDocumentationArtifacts } from "../dataset-version-documentation.service";

describe("dataset version documentation", () => {
  it("creates a readable dataset card and Croissant 1.1 JSON-LD with exact file digests", () => {
    const generated = createDatasetVersionDocumentationArtifacts({
      documentation: {
        name: "Support Answers",
        summary: "Curated answers for support training.",
        intendedUses: ["Train support assistants."],
        limitations: ["English only."],
        license: "apache-2.0",
        languages: ["en"],
        citation: "Synthetic fixture.",
      },
      artifacts: [
        {
          role: "dataset",
          artifactKey: "prepared/support.jsonl",
          digest: `sha256:${"a".repeat(64)}`,
          mediaType: "application/jsonl",
          sizeBytes: 100,
          rowCount: 4,
        },
        {
          role: "report",
          artifactKey: "reports/quality.json",
          digest: `sha256:${"b".repeat(64)}`,
          mediaType: "application/json",
          sizeBytes: 20,
        },
      ],
      totalRows: 4,
    });

    expect(generated.card).toContain("# Support Answers");
    expect(generated.card).toContain("## Important limitations");
    expect(generated.card).toContain('license: "apache-2.0"');
    const croissant = JSON.parse(generated.croissant);
    expect(croissant).toMatchObject({
      "@type": "sc:Dataset",
      "dct:conformsTo": "http://mlcommons.org/croissant/1.1",
      name: "Support Answers",
      distribution: [
        {
          "@type": "cr:FileObject",
          contentUrl: "data/dataset.jsonl",
          sha256: "a".repeat(64),
          encodingFormat: "application/jsonl",
        },
      ],
    });
    expect(generated.croissant).not.toContain("reports/quality.json");
  });
});
