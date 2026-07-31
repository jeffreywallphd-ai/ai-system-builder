import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiImageGenerationClient } from "../api/apiImageGenerationClient";

describe("apiImageGenerationClient telemetry boundary", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends client source as transport metadata instead of request payload data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true, value: { requestId: "r1" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await createApiImageGenerationClient({ apiBaseUrl: "/api", source: "thin-client.image-generation" })
      .startImageGeneration({ prompt: "x" });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(options.headers).get("x-client-source")).toBe(
      "thin-client.image-generation",
    );
    expect(JSON.parse(String(options.body))).toEqual({ prompt: "x" });
  });
});
