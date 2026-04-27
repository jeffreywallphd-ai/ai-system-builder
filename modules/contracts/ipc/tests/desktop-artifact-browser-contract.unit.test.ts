import { describe, expect, it } from "../../../testing/node-test";

import {
  DESKTOP_ARTIFACT_BROWSE_OPERATION,
  DESKTOP_ARTIFACT_PUBLISH_OPERATION,
  DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION,
  DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION,
  DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_REGISTER_FROM_REPO_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_BROWSE_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_CONTENT_READ_OPERATION,
  DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_CONTENT_READ_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION,
  DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_MEDIA_VIEW_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_READ_OPERATION,
  DESKTOP_ARTIFACT_READ_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_READ_RESPONSE_CHANNEL,
  createDesktopArtifactBrowseRequest,
  createDesktopArtifactPublishRequest,
  createDesktopArtifactPublishSuccessResponse,
  createDesktopArtifactBrowseSuccessResponse,
  createDesktopArtifactContentReadRequest,
  createDesktopArtifactContentReadSuccessResponse,
  createDesktopArtifactMediaViewRequest,
  createDesktopArtifactReadRequest,
  createDesktopArtifactReadSuccessResponse,
} from "..";
import {
  ARTIFACT_BROWSE_OPERATION,
  ARTIFACT_CONTENT_READ_OPERATION,
  ARTIFACT_READ_OPERATION,
} from "../../artifact-browser";
import { API_ARTIFACT_PUBLISH_OPERATION } from "../../api";

describe("desktop artifact-browser ipc contract", () => {
  it("reuses canonical operation identity and helper-derived channel naming for read operations", () => {
    expect(DESKTOP_ARTIFACT_BROWSE_OPERATION).toBe(ARTIFACT_BROWSE_OPERATION);
    expect(DESKTOP_ARTIFACT_READ_OPERATION).toBe(ARTIFACT_READ_OPERATION);
    expect(DESKTOP_ARTIFACT_CONTENT_READ_OPERATION).toBe(ARTIFACT_CONTENT_READ_OPERATION);

    expect(DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL.value).toBe(
      "ipc.artifact.browse.request",
    );
    expect(DESKTOP_ARTIFACT_BROWSE_RESPONSE_CHANNEL.value).toBe(
      "ipc.artifact.browse.response",
    );
    expect(DESKTOP_ARTIFACT_READ_REQUEST_CHANNEL.value).toBe(
      "ipc.artifact.read.request",
    );
    expect(DESKTOP_ARTIFACT_READ_RESPONSE_CHANNEL.value).toBe(
      "ipc.artifact.read.response",
    );
    expect(DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL.value).toBe(
      "ipc.artifact.content.read.request",
    );
    expect(DESKTOP_ARTIFACT_CONTENT_READ_RESPONSE_CHANNEL.value).toBe(
      "ipc.artifact.content.read.response",
    );
    expect(DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION).toBe("artifact.media.view");
    expect(DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL.value).toBe(
      "ipc.artifact.media.view.request",
    );
    expect(DESKTOP_ARTIFACT_MEDIA_VIEW_RESPONSE_CHANNEL.value).toBe(
      "ipc.artifact.media.view.response",
    );
    expect(DESKTOP_ARTIFACT_PUBLISH_OPERATION).toBe(API_ARTIFACT_PUBLISH_OPERATION);
    expect(DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL.value).toBe(
      "ipc.artifact.publish.request",
    );
    expect(DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL.value).toBe(
      "ipc.artifact.publish.response",
    );
    expect(DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION).toBe("artifact.publish.verify");
    expect(DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL.value).toBe(
      "ipc.artifact.publish.verify.request",
    );
    expect(DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL.value).toBe(
      "ipc.artifact.publish.verify.response",
    );
    expect(DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION).toBe("artifact.register.from-repo");
    expect(DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL.value).toBe(
      "ipc.artifact.register.from-repo.request",
    );
    expect(DESKTOP_ARTIFACT_REGISTER_FROM_REPO_RESPONSE_CHANNEL.value).toBe(
      "ipc.artifact.register.from-repo.response",
    );
    expect(DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION).toBe("artifact.localize.from-repo");
    expect(DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL.value).toBe(
      "ipc.artifact.localize.from-repo.request",
    );
    expect(DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_RESPONSE_CHANNEL.value).toBe(
      "ipc.artifact.localize.from-repo.response",
    );
  });

  it("keeps browse and detail payloads metadata-oriented while content-read stays descriptor-oriented", () => {
    const browseResponse = createDesktopArtifactBrowseSuccessResponse({
      items: [
        {
          artifactId: " staged/images/artifact-31 ",
          storageKey: " staged/images/artifact-31 ",
          artifactFamily: "image",
          mediaType: " image/png ",
        },
      ],
    });
    const readResponse = createDesktopArtifactReadSuccessResponse({
      artifact: {
        locator: {
          storageKey: " staged/images/artifact-31 ",
        },
        artifactFamily: "image",
      },
    });
    const contentResponse = createDesktopArtifactContentReadSuccessResponse({
      content: {
        locator: {
          storageKey: " staged/images/artifact-31 ",
        },
        mediaType: " image/png ",
        sizeBytes: 4,
        availability: "available",
        retrieval: "deferred",
      },
    });

    if (!browseResponse.ok) {
      throw new Error("Expected browse response to be successful.");
    }
    expect(browseResponse.value.items[0].storageKey).toBe("staged/images/artifact-31");
    expect(browseResponse.value.items[0].artifactId).toBe("staged/images/artifact-31");
    expect("content" in browseResponse.value.items[0]).toBe(false);

    if (!readResponse.ok) {
      throw new Error("Expected read response to be successful.");
    }
    expect(readResponse.value.artifact.locator.storageKey).toBe(
      "staged/images/artifact-31",
    );
    expect("content" in readResponse.value.artifact).toBe(false);

    if (!contentResponse.ok) {
      throw new Error("Expected content-read response to be successful.");
    }
    expect(contentResponse.value.content.locator.storageKey).toBe(
      "staged/images/artifact-31",
    );
    expect(contentResponse.value.content).toMatchObject({
      mediaType: "image/png",
      sizeBytes: 4,
      availability: "available",
      retrieval: "deferred",
    });
    expect("bytes" in contentResponse.value.content).toBe(false);
  });

  it("keeps read and content-read request locators storage-key based with no filesystem path fields", () => {
    const readRequest = createDesktopArtifactReadRequest({
      locator: {
        storageKey: " staged/images/artifact-32 ",
      },
      boundary: {
        host: "desktop",
        source: " desktop.renderer.artifact-read ",
      },
    });
    const contentRequest = createDesktopArtifactContentReadRequest({
      locator: {
        storageKey: " staged/images/artifact-32 ",
      },
      boundary: {
        host: "desktop",
        source: " desktop.renderer.artifact-content-read ",
      },
    });
    const browseRequest = createDesktopArtifactBrowseRequest({
      artifactFamily: "image",
      boundary: {
        host: "desktop",
        source: " desktop.renderer.artifact-browse ",
      },
    });

    const mediaViewRequest = createDesktopArtifactMediaViewRequest({
      storageKey: " staged/images/artifact-32 ",
      boundary: {
        host: "desktop",
        source: " desktop.renderer.artifact-media-view ",
      },
    });

    expect(readRequest.payload.locator.storageKey).toBe("staged/images/artifact-32");
    expect(contentRequest.payload.locator.storageKey).toBe("staged/images/artifact-32");
    expect(browseRequest.payload.artifactFamily).toBe("image");
    expect(mediaViewRequest.payload.storageKey).toBe("staged/images/artifact-32");
    expect("path" in readRequest.payload.locator).toBe(false);
    expect("path" in contentRequest.payload.locator).toBe(false);
  });

  it("accepts generic artifactFamily filters without narrowing to image/data", () => {
    const browseRequest = createDesktopArtifactBrowseRequest({
      artifactFamily: "application",
      boundary: {
        host: "desktop",
        source: "desktop.renderer.artifact-browse",
      },
    });

    expect(browseRequest.payload.artifactFamily).toBe("application");
  });

  it("defines a publish contract that mirrors the shared publish operation semantics", () => {
    const request = createDesktopArtifactPublishRequest({
      artifactId: " uploads/cat.png ",
      target: {
        provider: " huggingface ",
        repository: " openai/demo ",
        path: " images/cat.png ",
        revision: " main ",
      },
      mediaType: " image/png ",
      verify: true,
      boundary: {
        host: "desktop",
        source: " desktop.renderer.artifact-browser ",
      },
    });

    const response = createDesktopArtifactPublishSuccessResponse({
      target: {
        provider: " huggingface ",
        repository: " openai/demo ",
        path: " images/cat.png ",
        revision: " main ",
        locator: " openai/demo/images/cat.png ",
      },
      verification: {
        exists: true,
        verifiedAt: " 2026-04-17T00:00:00.000Z ",
      },
    });

    expect(request.operation).toBe("artifact.publish");
    expect(request.payload).toMatchObject({
      artifactId: "uploads/cat.png",
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
        revision: "main",
      },
      mediaType: "image/png",
      verify: true,
      boundary: {
        host: "desktop",
        source: "desktop.renderer.artifact-browser",
      },
    });

    if (!response.ok) {
      throw new Error("Expected publish response to be successful.");
    }

    expect(response.value).toEqual({
      target: {
        provider: "huggingface",
        repository: "openai/demo",
        path: "images/cat.png",
        revision: "main",
        locator: "openai/demo/images/cat.png",
      },
      verification: {
        exists: true,
        verifiedAt: "2026-04-17T00:00:00.000Z",
      },
    });
  });
});
