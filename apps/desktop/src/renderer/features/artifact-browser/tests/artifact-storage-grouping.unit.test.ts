import { describe, expect, it } from "vitest";

import { isGeneratedArtifact, isUploadedArtifact } from "../helpers/artifactStorageGrouping";

describe("artifact storage grouping", () => {
  it("treats workspace-prefixed uploaded markdown artifacts as uploaded items", () => {
    const item = {
      artifactId: "workspaces/workspace.d64c780b4ce34f62a65fb0b0ae4f80ca/artifacts/files/uploads/20260605133238388-9976fe6a4c5b4f4784aad3df0c5b37bd.md",
      storageKey: "workspaces/workspace.d64c780b4ce34f62a65fb0b0ae4f80ca/artifacts/files/uploads/20260605133238388-9976fe6a4c5b4f4784aad3df0c5b37bd.md",
      originalName: "host-model.md",
      artifactFamily: "text" as const,
      mediaType: "text/markdown",
      sourceKind: "upload" as const,
      sizeBytes: 20908,
    };

    expect(isUploadedArtifact(item)).toBe(true);
    expect(isGeneratedArtifact(item)).toBe(false);
  });
});
