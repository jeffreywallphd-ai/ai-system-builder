import { describe, expect, it } from "../../../testing/node-test";

import {
  API_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
  createApiArtifactLocalizeFromRepoRequest,
} from "../artifact-localize-from-repo-api-contract";

describe("artifact localize-from-repo api contract", () => {
  it("normalizes artifact localize-from-repo request payload", () => {
    const request = createApiArtifactLocalizeFromRepoRequest({
      artifactId: " artifacts/abc123 ",
      source: " thin-client.artifact-browser ",
    });

    expect(API_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION).toBe("artifact.localize.from-repo");
    expect(request.payload).toEqual({
      artifactId: "artifacts/abc123",
      source: "thin-client.artifact-browser",
    });
  });
});
