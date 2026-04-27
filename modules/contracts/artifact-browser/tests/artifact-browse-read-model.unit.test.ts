import { describe, expect, it } from "../../../testing/node-test";

import { normalizeArtifactBrowseSuccessValue } from "../artifact-browse-read-model";

describe("artifact browse read model", () => {
  it("normalizes artifactId and storageKey for browse items", () => {
    const normalized = normalizeArtifactBrowseSuccessValue({
      items: [
        {
          artifactId: " uploads/cat.png ",
          storageKey: " uploads/cat.png ",
          artifactFamily: "image",
          mediaType: " image/png ",
        },
      ],
    });

    expect(normalized.items).toEqual([
      {
        artifactId: "uploads/cat.png",
        storageKey: "uploads/cat.png",
        artifactFamily: "image",
        mediaType: "image/png",
        sourceKind: undefined,
        originalName: undefined,
        createdAt: undefined,
      },
    ]);
  });
});
