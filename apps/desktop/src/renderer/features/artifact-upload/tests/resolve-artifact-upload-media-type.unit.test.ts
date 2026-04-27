import { describe, expect, it } from "vitest";

import { resolveArtifactUploadMediaType } from "../hooks/resolveArtifactUploadMediaType";

describe("resolveArtifactUploadMediaType", () => {
  it("falls back to extension when browser media type is empty", () => {
    expect(resolveArtifactUploadMediaType({
      fileName: "architecture-document-scope-boundaries.md",
      browserMediaType: "",
    })).toBe("text/markdown");
    expect(resolveArtifactUploadMediaType({
      fileName: "schema.json",
      browserMediaType: "",
    })).toBe("application/json");
  });

  it("returns browser-provided media type when present", () => {
    expect(resolveArtifactUploadMediaType({
      fileName: "table.csv",
      browserMediaType: " text/csv ",
    })).toBe("text/csv");
  });

  it("uses octet-stream for unknown extensions without browser metadata", () => {
    expect(resolveArtifactUploadMediaType({
      fileName: "blob.unknown",
      browserMediaType: "",
    })).toBe("application/octet-stream");
  });
});
