import { describe, expect, it } from "../../../testing/node-test";

import {
  API_ARTIFACT_BROWSE_OPERATION,
  API_ARTIFACT_CONTENT_READ_OPERATION,
  API_ARTIFACT_READ_OPERATION,
  createApiArtifactBrowseRequest,
  createApiArtifactBrowseSuccessResponse,
  createApiArtifactContentReadRequest,
  createApiArtifactContentReadSuccessResponse,
  createApiArtifactReadRequest,
  createApiArtifactReadSuccessResponse,
} from "..";
import {
  ARTIFACT_BROWSE_OPERATION,
  ARTIFACT_CONTENT_READ_OPERATION,
  ARTIFACT_READ_OPERATION,
} from "../../artifact-browser";

describe("artifact-browser api contracts", () => {
  it("reuses canonical artifact-browser operation identity across api transport specialization", () => {
    expect(API_ARTIFACT_BROWSE_OPERATION).toBe(ARTIFACT_BROWSE_OPERATION);
    expect(API_ARTIFACT_READ_OPERATION).toBe(ARTIFACT_READ_OPERATION);
    expect(API_ARTIFACT_CONTENT_READ_OPERATION).toBe(ARTIFACT_CONTENT_READ_OPERATION);
  });

  it("keeps browse and detail responses metadata-oriented and content-read separate", () => {
    const browseResponse = createApiArtifactBrowseSuccessResponse({
      items: [
        {
          storageKey: " staged/images/artifact-21 ",
          artifactFamily: "image",
          mediaType: " image/png ",
        },
      ],
    });

    const readResponse = createApiArtifactReadSuccessResponse({
      artifact: {
        locator: {
          storageKey: " staged/images/artifact-21 ",
        },
        artifactFamily: "image",
        mediaType: " image/png ",
      },
    });

    const contentResponse = createApiArtifactContentReadSuccessResponse({
      content: {
        locator: {
          storageKey: " staged/images/artifact-21 ",
        },
        mediaType: " image/png ",
        sizeBytes: 4,
        availability: "available",
        retrieval: "inline",
      },
    });

    expect(browseResponse).toMatchObject({
      ok: true,
      operation: "artifact.browse",
      value: {
        items: [
          {
            storageKey: "staged/images/artifact-21",
            artifactFamily: "image",
            mediaType: "image/png",
          },
        ],
      },
    });
    if (!browseResponse.ok) {
      throw new Error("Expected browse response to be successful.");
    }
    expect("content" in browseResponse.value.items[0]).toBe(false);

    expect(readResponse).toMatchObject({
      ok: true,
      operation: "artifact.read",
      value: {
        artifact: {
          locator: {
            storageKey: "staged/images/artifact-21",
          },
          artifactFamily: "image",
          mediaType: "image/png",
        },
      },
    });
    if (!readResponse.ok) {
      throw new Error("Expected read response to be successful.");
    }
    expect("content" in readResponse.value.artifact).toBe(false);

    expect(contentResponse).toMatchObject({
      ok: true,
      operation: "artifact.content.read",
      value: {
        content: {
          locator: {
            storageKey: "staged/images/artifact-21",
          },
          mediaType: "image/png",
          sizeBytes: 4,
          availability: "available",
          retrieval: "inline",
        },
      },
    });
    if (!contentResponse.ok) {
      throw new Error("Expected content-read response to be successful.");
    }
    expect("bytes" in contentResponse.value.content).toBe(false);
  });

  it("keeps locator fields storage-key based and avoids filesystem path fields in request payloads", () => {
    const readRequest = createApiArtifactReadRequest({
      locator: {
        storageKey: " staged/images/artifact-22 ",
      },
      boundary: {
        host: "server",
        source: " api.artifact-read ",
      },
    });
    const contentRequest = createApiArtifactContentReadRequest({
      locator: {
        storageKey: " staged/images/artifact-22 ",
      },
      boundary: {
        host: "server",
        source: " api.artifact-content-read ",
      },
    });
    const browseRequest = createApiArtifactBrowseRequest({
      artifactFamily: "image",
      boundary: {
        host: "server",
        source: " api.artifact-browse ",
      },
    });

    expect(readRequest.payload.locator.storageKey).toBe("staged/images/artifact-22");
    expect(contentRequest.payload.locator.storageKey).toBe("staged/images/artifact-22");
    expect(browseRequest.payload.artifactFamily).toBe("image");
    expect("path" in readRequest.payload.locator).toBe(false);
    expect("path" in contentRequest.payload.locator).toBe(false);
  });

  it("accepts generic artifactFamily filters without image/data coupling", () => {
    const browseRequest = createApiArtifactBrowseRequest({
      artifactFamily: "application",
      boundary: {
        host: "server",
        source: "api.artifact-browse",
      },
    });

    expect(browseRequest.payload.artifactFamily).toBe("application");
  });
});
