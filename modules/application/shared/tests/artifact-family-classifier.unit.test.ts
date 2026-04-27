import { describe, expect, it } from "../../../testing/node-test";

import { resolveArtifactFamily } from "../artifact-family-classifier";

describe("artifact-family-classifier", () => {
  it("resolves expected families by media type and extension", () => {
    expect(resolveArtifactFamily({ mediaType: "image/png" })).toBe("image");
    expect(resolveArtifactFamily({ mediaType: "application/pdf" })).toBe("document");
    expect(resolveArtifactFamily({ mediaType: "text/markdown" })).toBe("text");
    expect(resolveArtifactFamily({ mediaType: "application/json" })).toBe("structured-text");
    expect(resolveArtifactFamily({ mediaType: "application/x-parquet" })).toBe("tabular");
    expect(resolveArtifactFamily({ mediaType: "application/octet-stream" })).toBe("binary");
  });

  it("falls back to file-name/extension mapping when media type is absent", () => {
    expect(resolveArtifactFamily({ fileName: "notes.md" })).toBe("text");
    expect(resolveArtifactFamily({ extension: "json" })).toBe("structured-text");
    expect(resolveArtifactFamily({ fileName: "table.parquet" })).toBe("tabular");
    expect(resolveArtifactFamily({ fileName: "binary/blob.bin" })).toBe("binary");
  });
});
