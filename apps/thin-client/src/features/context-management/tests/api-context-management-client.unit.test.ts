import { afterEach, describe, expect, it, testDouble } from "../../../../../../modules/testing/node-test";
import { createApiContextManagementClient } from "../api/apiContextManagementClient";

describe("createApiContextManagementClient", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("routes reads and writes through their scoped endpoints", async () => {
    const fetchMock = testDouble
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockImplementation(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            operation: "context-management.execute",
            value: { action: "browser-list", items: [] },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    globalThis.fetch = fetchMock as typeof fetch;
    const client = createApiContextManagementClient("/api/");
    await client.execute({
      workspaceId: "workspace-a",
      command: { action: "browser-list" },
    });
    await client.execute({
      workspaceId: "workspace-a",
      command: { action: "browser-delete", artifactId: "context-1" },
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/context-management/read");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/context-management/write");
  });
});
