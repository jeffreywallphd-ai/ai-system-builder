import { describe, expect, it } from "../../../testing/node-test";

import {
  API_ARTIFACT_REGISTER_FROM_REPO_OPERATION,
  createApiArtifactRegisterFromRepoRequest,
} from "../artifact-register-from-repo-api-contract";

describe("artifact register-from-repo api contract", () => {
  it("normalizes artifact register-from-repo request payload", () => {
    const request = createApiArtifactRegisterFromRepoRequest({
      target: {
        provider: " huggingface ",
        repository: " openai/demo ",
        path: " images/cat.png ",
        revision: " main ",
      },
      source: " thin-client.artifact-browser ",
    });

    expect(API_ARTIFACT_REGISTER_FROM_REPO_OPERATION).toBe("artifact.register.from-repo");
    expect(request.payload).toEqual({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
        revision: "main",
      },
      artifactFamily: undefined,
      mediaType: undefined,
      source: "thin-client.artifact-browser",
    });
  });
});
