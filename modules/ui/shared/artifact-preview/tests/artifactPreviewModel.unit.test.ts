import { describe, expect, it } from "../../../../testing/node-test";
import {
  ARTIFACT_PREVIEW_MAX_JSON_LINES,
  ARTIFACT_PREVIEW_MAX_LINES,
  createParquetArtifactPreview,
  createTextArtifactPreview,
  createUnsupportedArtifactPreview,
  describeArtifactPreview,
  isArtifactBrowserVisible,
} from "../index";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("artifact preview model", () => {
  it("classifies the first supported artifact preview types by media type and extension", () => {
    expect(
      describeArtifactPreview({
        storageKey: "uploads/a.pdf",
        mediaType: "application/pdf",
      }).kind,
    ).toBe("pdf");
    expect(describeArtifactPreview({ storageKey: "uploads/a.docx" }).kind).toBe(
      "office-document",
    );
    expect(describeArtifactPreview({ storageKey: "uploads/a.xlsx" }).kind).toBe(
      "office-spreadsheet",
    );
    expect(describeArtifactPreview({ storageKey: "uploads/a.csv" }).kind).toBe(
      "csv",
    );
    expect(describeArtifactPreview({ storageKey: "uploads/a.txt" }).kind).toBe(
      "text",
    );
    expect(describeArtifactPreview({ storageKey: "uploads/a.md" }).kind).toBe(
      "markdown",
    );
    expect(describeArtifactPreview({ storageKey: "uploads/a.json" }).kind).toBe(
      "json",
    );
    expect(
      describeArtifactPreview({
        storageKey: "evidence/system.build-evidence+json",
        mediaType: "application/vnd.ai-system-builder.build-evidence+json",
      }).kind,
    ).toBe("json");
    expect(
      describeArtifactPreview({
        storageKey: "generated/train.jsonl",
        mediaType: "application/x-ndjson",
      }).kind,
    ).toBe("jsonl");
    expect(
      describeArtifactPreview({ storageKey: "generated/a.parquet" }).kind,
    ).toBe("parquet");
    expect(
      describeArtifactPreview({
        storageKey: "uploads/a.png",
        mediaType: "image/png",
      }).kind,
    ).toBe("image");
    expect(
      describeArtifactPreview({
        storageKey: "uploads/a.svg",
        mediaType: "image/svg+xml",
      }).kind,
    ).toBe("unsupported");
    expect(
      describeArtifactPreview({
        storageKey: "uploads/a.mp4",
        mediaType: "video/mp4",
      }).kind,
    ).toBe("video");
  });

  it("keeps internal build metadata out of the user-facing Artifact Browser", () => {
    expect(
      isArtifactBrowserVisible({
        storageKey: "workspaces/workspace-a/system-builds/evidence/digest",
        mediaType: "application/vnd.ai-system-builder.build-evidence+json",
      }),
    ).toBe(false);
    expect(
      isArtifactBrowserVisible({
        storageKey: "workspaces/workspace-a/system-builds/provenance/digest",
        mediaType: "application/vnd.in-toto+json",
      }),
    ).toBe(false);
    expect(
      isArtifactBrowserVisible({
        storageKey: "workspaces/workspace-a/system-builds/policy/digest",
        originalName: "system.policy+json",
        mediaType: "application/vnd.ai-system-builder.policy+json",
      }),
    ).toBe(false);
    expect(
      isArtifactBrowserVisible({
        storageKey: "legacy/system.workflow+json",
        mediaType: "application/vnd.ai-system-builder.workflow+json",
      }),
    ).toBe(false);
    expect(
      isArtifactBrowserVisible({
        storageKey: "workspaces/workspace-a/system-builds/future-internal-kind/digest",
        mediaType: "application/octet-stream",
      }),
    ).toBe(false);
    expect(
      isArtifactBrowserVisible({
        storageKey: "uploads/linked-data.json",
        mediaType: "application/ld+json",
      }),
    ).toBe(false);
    expect(
      isArtifactBrowserVisible({
        storageKey: "uploads/records.ndjson",
        mediaType: "application/x-ndjson",
      }),
    ).toBe(true);
    expect(
      isArtifactBrowserVisible({
        storageKey: "generated/customer-data.jsonl",
        mediaType: "application/x-ndjson",
      }),
    ).toBe(true);
    expect(
      isArtifactBrowserVisible({
        storageKey: "uploads/customer-data.json",
        mediaType: "application/json",
      }),
    ).toBe(true);
  });

  it("formats complete JSON previews and keeps the preview visibly limited", () => {
    const preview = createTextArtifactPreview(
      { storageKey: "uploads/config.json", mediaType: "application/json" },
      bytes('{"name":"demo","enabled":true}'),
    );

    expect(preview.title).toContain("JSON preview for uploads/config.json");
    expect(preview.text).toBe(
      '{\n  "name": "demo",\n  "enabled": true\n}',
    );
    expect(preview.table).toBeUndefined();
    expect(preview.truncated).toBe(false);
  });

  it("limits formatted JSON previews to the first 100 lines", () => {
    const preview = createTextArtifactPreview(
      { storageKey: "generated/large.json", mediaType: "application/json" },
      bytes(
        JSON.stringify(
          Object.fromEntries(
            Array.from({ length: 120 }, (_, index) => [
              `field-${index}`,
              index,
            ]),
          ),
        ),
      ),
    );

    expect(preview.text?.split("\n").length).toBe(
      ARTIFACT_PREVIEW_MAX_JSON_LINES,
    );
    expect(preview.truncated).toBe(true);
  });

  it("pretty-prints bounded JSON Lines previews", () => {
    const preview = createTextArtifactPreview(
      {
        storageKey: "generated/train.jsonl",
        mediaType: "application/x-ndjson",
      },
      bytes('{"instruction":"First"}\n{"instruction":"Second"}\n'),
    );

    expect(preview.status).toBe("ready");
    expect(preview.text).toContain('"instruction": "First"');
    expect(preview.text).toContain('"instruction": "Second"');
    expect(preview.table).toBeUndefined();
  });

  it("parses bounded CSV into inert native-table values", () => {
    const preview = createTextArtifactPreview(
      { storageKey: "uploads/data.csv", mediaType: "text/csv" },
      bytes("name,value\nalpha,=2+2\nbeta,@formula"),
    );

    expect(preview.table).toEqual({
      columns: ["name", "value"],
      rows: [
        ["alpha", "'=2+2"],
        ["beta", "'@formula"],
      ],
    });
  });

  it("limits Parquet previews to the first 10 rows", () => {
    const preview = createParquetArtifactPreview(
      { storageKey: "generated/train.parquet" },
      Array.from({ length: 12 }, (_, index) => ({
        instruction: `Instruction ${index + 1}`,
        score: index,
      })),
      12,
    );

    expect(preview.table?.columns).toEqual(["instruction", "score"]);
    expect(preview.table?.rows.length).toBe(10);
    expect(preview.message).toBe("Showing the first 10 of 12 rows.");
    expect(preview.truncated).toBe(true);
  });

  it("returns a safe malformed state without exposing parser details", () => {
    const preview = createTextArtifactPreview(
      { storageKey: "uploads/broken.json", mediaType: "application/json" },
      bytes('{"name":'),
    );

    expect(preview.status).toBe("error");
    expect(preview.message).toBe(
      "The artifact could not be safely parsed. Download it to inspect the original file.",
    );
    expect(preview.text).toBeUndefined();
  });

  it("truncates long text previews by line count", () => {
    const preview = createTextArtifactPreview(
      { storageKey: "uploads/notes.md", mediaType: "text/markdown" },
      bytes(
        Array.from(
          { length: ARTIFACT_PREVIEW_MAX_LINES + 10 },
          (_, index) => `line ${index}`,
        ).join("\n"),
      ),
    );

    expect(preview.text?.split("\n").length).toBe(ARTIFACT_PREVIEW_MAX_LINES);
    expect(preview.truncated).toBe(true);
  });

  it("uses a recognized placeholder for Office files until a safe parser is added", () => {
    const preview = createUnsupportedArtifactPreview({
      storageKey: "uploads/report.docx",
    });

    expect(preview.title).toContain("DOCX preview for uploads/report.docx");
    expect(preview.message).toContain("recognized");
    expect(preview.message).toContain("Download");
  });
});
