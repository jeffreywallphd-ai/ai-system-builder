import { describe, expect, it } from "../../../testing/node-test";

import {
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL,
  createDesktopArtifactLocalizeFromRepoRequest,
} from "../desktop-artifact-localize-from-repo-contract";

describe("desktop artifact localize-from-repo ipc contract", () => {
  it("normalizes request payload and operation/channel identity", () => {
    const request = createDesktopArtifactLocalizeFromRepoRequest({
      artifactId: " artifacts/abc123 ",
      boundary: {
        host: "desktop",
        source: " desktop.renderer.artifact-browser ",
      },
    });

    expect(DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION).toBe("artifact.localize.from-repo");
    expect(DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL.value).toBe(
      "ipc.artifact.localize.from-repo.request",
    );
    expect(request.payload).toEqual({
      artifactId: "artifacts/abc123",
      boundary: {
        host: "desktop",
        source: "desktop.renderer.artifact-browser",
      },
    });
  });
});
