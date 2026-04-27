import { describe, expect, it } from "../../../testing/node-test";

import { normalizeArtifactFamily } from "../ArtifactFamily";

describe("ArtifactFamily", () => {
  it("normalizes and validates family values", () => {
    expect(normalizeArtifactFamily(" image ")).toBe("image");
    expect(() => normalizeArtifactFamily("unknown")).toThrow();
  });
});
