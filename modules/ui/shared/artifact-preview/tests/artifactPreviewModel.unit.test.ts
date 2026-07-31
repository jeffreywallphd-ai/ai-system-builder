import { describe, expect, it } from "../../../../testing/node-test";
import {
  ARTIFACT_PREVIEW_MAX_LINES,
  createTextArtifactPreview,
  createUnsupportedArtifactPreview,
  describeArtifactPreview,
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

  it("formats complete JSON previews and keeps the preview visibly limited", () => {
    const preview = createTextArtifactPreview(
      { storageKey: "uploads/config.json", mediaType: "application/json" },
      bytes('{"name":"demo","enabled":true}'),
    );

    expect(preview.title).toContain("JSON preview for uploads/config.json");
    expect(preview.table).toEqual({
      columns: ["Field", "Value"],
      rows: [
        ["name", "demo"],
        ["enabled", "true"],
      ],
    });
    expect(preview.truncated).toBe(false);
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
