import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiArtifactUploadClient } from "../api/apiArtifactUploadClient";

describe("api artifact upload client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends multipart upload requests to the express artifact-upload route and maps success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        operation: "artifact.upload",
        value: {
          descriptor: {
            storage: {
              key: "uploads/cat.png",
              mediaType: "image/png",
              sizeBytes: 3,
            },
          },
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = createApiArtifactUploadClient();
    const input = {
      fileName: "cat.png",
      mediaType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    };

    const result = await client.uploadArtifact(input);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/artifact/upload");
    expect(options.method).toBe("POST");
    expect(options.headers).toBeUndefined();
    expect(options.body).toBeInstanceOf(FormData);

    const formData = options.body as FormData;
    expect(formData.get("source")).toBe("thin-client.artifact-upload.form");
    const file = formData.get("file");
    expect(file).toBeInstanceOf(File);
    expect((file as File).name).toBe("cat.png");
    expect((file as File).type).toBe("image/png");

    expect(result).toEqual({
      ok: true,
      value: {
        descriptor: {
          key: "uploads/cat.png",
          mediaType: "image/png",
          sizeBytes: 3,
        },
      },
    });
  });

  it("maps api error envelopes into renderer-facing failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({
        ok: false,
        operation: "artifact.upload",
        error: {
          code: "validation",
          message: "Artifact type is not accepted: application/pdf.",
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = createApiArtifactUploadClient({ apiBaseUrl: "http://localhost:3000/api" });
    const result = await client.uploadArtifact({
      fileName: "bad.pdf",
      mediaType: "application/pdf",
      bytes: new Uint8Array([1, 2]),
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/artifact/upload",
      expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "validation",
        message: "Artifact type is not accepted: application/pdf.",
      },
    });
  });

  it("returns a meaningful failure when the server returns a non-json error response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: vi.fn().mockRejectedValue(new Error("Unexpected token < in JSON")),
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = createApiArtifactUploadClient();
    const result = await client.uploadArtifact({
      fileName: "cat.png",
      mediaType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "internal",
        message: "Artifact upload failed (500 Internal Server Error).",
      },
    });
  });
});
