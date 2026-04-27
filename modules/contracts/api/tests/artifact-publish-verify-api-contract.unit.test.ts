import { describe, expect, it } from "../../../testing/node-test";

import {
  API_ARTIFACT_PUBLISH_VERIFY_OPERATION,
  createApiArtifactPublishVerifyRequest,
  createApiArtifactPublishVerifySuccessResponse,
} from "..";

describe("artifact publish verify api contract", () => {
  it("normalizes artifact publish verify request payload", () => {
    const request = createApiArtifactPublishVerifyRequest({
      artifactId: " uploads/a.png ",
      source: " thin-client.artifact-browser ",
    });

    expect(API_ARTIFACT_PUBLISH_VERIFY_OPERATION).toBe("artifact.publish.verify");
    expect(request.payload).toEqual({
      artifactId: "uploads/a.png",
      source: "thin-client.artifact-browser",
    });
  });

  it("maps success response through the shared API envelope", () => {
    const response = createApiArtifactPublishVerifySuccessResponse({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/a.png",
        revision: "main",
        locator: "openai/demo/images/a.png",
      },
      verification: {
        exists: true,
      },
    });

    expect(response).toMatchObject({
      ok: true,
      operation: "artifact.publish.verify",
      value: {
        verification: {
          exists: true,
        },
      },
    });
  });
});
