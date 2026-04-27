import { describe, expect, it } from "../../../testing/node-test";

import {
  DESKTOP_ARTIFACT_UPLOAD_OPERATION,
  DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL,
  createDesktopArtifactUploadRequest,
  createDesktopArtifactUploadSuccessResponse,
  getDesktopArtifactUploadChannel,
  isDesktopArtifactUploadRequestChannel,
  isDesktopArtifactUploadResponseChannel,
} from "..";

describe("desktop artifact upload ipc contract", () => {
  it("keeps operation identity and channel names derived from shared helpers", () => {
    expect(DESKTOP_ARTIFACT_UPLOAD_OPERATION).toBe("artifact.upload");
    expect(DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL).toEqual({
      operation: "artifact.upload",
      kind: "request",
      value: "ipc.artifact.upload.request",
    });
    expect(DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL).toEqual({
      operation: "artifact.upload",
      kind: "response",
      value: "ipc.artifact.upload.response",
    });
    expect(getDesktopArtifactUploadChannel("request")).toEqual(
      DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL,
    );
    expect(getDesktopArtifactUploadChannel("response")).toEqual(
      DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL,
    );
  });

  it("creates a minimal upload request payload for desktop ipc transport", () => {
    const bytes = new Uint8Array([137, 80, 78, 71]);

    const request = createDesktopArtifactUploadRequest(
      {
        fileName: "  kitten.png  ",
        mediaType: " image/png ",
        bytes,
        boundary: {
          host: "desktop",
          source: "  desktop.renderer.artifact-upload.form  ",
        },
      },
      {
        requestId: "req-upload-1",
        correlationId: "corr-upload-1",
      },
    );

    expect(request).toEqual({
      channel: "ipc.artifact.upload.request",
      operation: "artifact.upload",
      payload: {
        fileName: "kitten.png",
        mediaType: "image/png",
        bytes,
        boundary: {
          host: "desktop",
          source: "desktop.renderer.artifact-upload.form",
        },
      },
      requestId: "req-upload-1",
      correlationId: "corr-upload-1",
      metadata: undefined,
    });
    expect(isDesktopArtifactUploadRequestChannel(request.channel)).toBe(true);
    expect(isDesktopArtifactUploadResponseChannel(request.channel)).toBe(false);
  });

  it("creates an upload success response that returns storage descriptor details", () => {
    const response = createDesktopArtifactUploadSuccessResponse(
      {
        storage: {
          key: " workspace/ws-42/uploads/kitten.png ",
        },
        sourceKind: "upload",
      },
      {
        requestId: "req-upload-2",
      },
    );

    expect(response).toMatchObject({
      ok: true,
      value: {
        descriptor: {
          storage: {
            key: "workspace/ws-42/uploads/kitten.png",
          },
          sourceKind: "upload",
        },
      },
      requestId: "req-upload-2",
      correlationId: undefined,
      operation: "artifact.upload",
      channel: "ipc.artifact.upload.response",
      metadata: undefined,
    });
    expect(isDesktopArtifactUploadResponseChannel(response.channel)).toBe(true);
    expect(isDesktopArtifactUploadRequestChannel(response.channel)).toBe(false);
  });

  it("rejects invalid request payload fields with basic validation errors", () => {
    expect(() =>
      createDesktopArtifactUploadRequest({
        fileName: "   ",
        mediaType: "image/png",
        bytes: new Uint8Array([1]),
        boundary: {
          host: "desktop",
          source: "desktop.renderer.artifact-upload.form",
        },
      }),
    ).toThrow("fileName must be a non-empty, trimmed string.");

    expect(() =>
      createDesktopArtifactUploadRequest({
        fileName: "kitten.png",
        mediaType: "image/png",
        bytes: new Uint8Array([]),
        boundary: {
          host: "desktop",
          source: "desktop.renderer.artifact-upload.form",
        },
      }),
    ).toThrow("bytes must contain at least one byte.");
  });
});
