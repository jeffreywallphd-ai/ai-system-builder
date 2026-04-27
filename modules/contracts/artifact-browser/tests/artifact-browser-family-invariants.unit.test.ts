import { describe, expect, it } from "../../../testing/node-test";

import * as artifactBrowserContracts from "..";

describe("artifact-browser family invariants", () => {
  it("exports only artifact-browser-family surfaces from the family barrel", () => {
    expect(Object.keys(artifactBrowserContracts).sort()).toEqual([
      "ARTIFACT_CONTENT_AVAILABILITIES",
      "ARTIFACT_CONTENT_RETRIEVAL_KINDS",
      "ARTIFACT_BROWSE_OPERATION",
      "ARTIFACT_CONTENT_READ_OPERATION",
      "ARTIFACT_READ_OPERATION",
      "createArtifactBrowserLocator",
      "normalizeArtifactBrowseItem",
      "normalizeArtifactBrowseSuccessValue",
      "normalizeArtifactBrowserLocator",
      "normalizeArtifactContentReadModel",
      "normalizeArtifactContentReadSuccessValue",
      "normalizeArtifactDetailReadModel",
      "normalizeArtifactReadSuccessValue",
      "normalizeUnregisteredArtifactBrowseSuccessValue",
    ].sort());
  });

  it("keeps locator fields storage-key based and path-agnostic across read operations", () => {
    const locator = artifactBrowserContracts.createArtifactBrowserLocator(
      " staged/images/artifact-11 ",
    );
    const detail = artifactBrowserContracts.normalizeArtifactReadSuccessValue({
      artifact: {
        locator,
        artifactFamily: "image",
      },
    });
    const content = artifactBrowserContracts.normalizeArtifactContentReadSuccessValue({
      content: {
        locator,
        sizeBytes: 3,
        availability: "available",
        retrieval: "deferred",
      },
    });

    expect(detail.artifact.locator.storageKey).toBe("staged/images/artifact-11");
    expect(content.content.locator.storageKey).toBe("staged/images/artifact-11");
    expect("path" in detail.artifact.locator).toBe(false);
    expect("path" in content.content.locator).toBe(false);
    expect("bytes" in content.content).toBe(false);
  });
});
