import { describe, expect, it } from "../../../testing/node-test";

import {
  DESKTOP_ARTIFACT_SOURCE_VERIFY_OPERATION,
  DESKTOP_ARTIFACT_SOURCE_VERIFY_REQUEST_CHANNEL,
  createDesktopArtifactSourceVerifyRequest,
} from "../desktop-artifact-source-verify-contract";

describe("desktop artifact source-verify ipc contract", () => {
  it("normalizes request payload and operation/channel identity", () => {
    const request = createDesktopArtifactSourceVerifyRequest({
      artifactId: " artifacts/abc123 ",
      boundary: {
        host: "desktop",
        source: " desktop.renderer.artifact-browser ",
      },
    });

    expect(DESKTOP_ARTIFACT_SOURCE_VERIFY_OPERATION).toBe("artifact.source.verify");
    expect(DESKTOP_ARTIFACT_SOURCE_VERIFY_REQUEST_CHANNEL.value).toBe(
      "ipc.artifact.source.verify.request",
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
