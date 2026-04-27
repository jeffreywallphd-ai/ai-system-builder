import { describe, expect, it } from "../../../testing/node-test";

import {
  API_ARTIFACT_SOURCE_VERIFY_OPERATION,
  createApiArtifactSourceVerifyRequest,
} from "../artifact-source-verify-api-contract";

describe("artifact source-verify api contract", () => {
  it("normalizes artifact source-verify request payload", () => {
    const request = createApiArtifactSourceVerifyRequest({
      artifactId: " artifacts/abc123 ",
      source: " thin-client.artifact-browser ",
    });

    expect(API_ARTIFACT_SOURCE_VERIFY_OPERATION).toBe("artifact.source.verify");
    expect(request.payload).toEqual({
      artifactId: "artifacts/abc123",
      source: "thin-client.artifact-browser",
    });
  });
});
