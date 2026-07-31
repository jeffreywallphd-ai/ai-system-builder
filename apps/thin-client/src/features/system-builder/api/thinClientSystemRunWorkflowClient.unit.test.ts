import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../../modules/testing/node-test";
import { createThinClientSystemRunWorkflowClient } from "./thinClientSystemRunWorkflowClient";

const source = {
  kind: "approved-release" as const,
  sourceId: "release-a",
  sourceDigest: `sha256:${"a".repeat(64)}`,
  label: "Release A",
};

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
    },
  });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalLocalStorage,
  });
});

describe("thin-client system run workflow client", () => {
  it("uses the generic list, prepare, and invoke API routes", async () => {
    const fetcher = testDouble.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, value: [] }),
    });
    globalThis.fetch = fetcher as never;
    const client = createThinClientSystemRunWorkflowClient("/api/");
    await client.listProfiles({
      workspaceId: "workspace a",
      sourceKind: "approved-release",
      sourceId: "release-a",
    });
    await client.prepare({
      workspaceId: "workspace-a",
      profileId: "fixture.workflow@1.0.0",
      source,
    });
    await client.invoke({
      workspaceId: "workspace-a",
      profileId: "fixture.workflow@1.0.0",
      source,
      actionId: "refresh",
      operationId: "operation-1",
      values: {},
    });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/systems/run-workflows?workspaceId=workspace+a&sourceKind=approved-release&sourceId=release-a",
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "/api/systems/run-workflows/prepare",
    );
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      workspaceId: "workspace-a",
      profileId: "fixture.workflow@1.0.0",
      source,
    });
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      "/api/systems/run-workflows/invoke",
    );
  });

  it("maps sanitized failure envelopes and hides transport exceptions", async () => {
    globalThis.fetch = testDouble.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({
        ok: false,
        error: {
          code: "forbidden",
          message: "This workflow is not available.",
          details: { field: "profileId" },
        },
      }),
    }) as never;
    const client = createThinClientSystemRunWorkflowClient();
    const denied = await client.prepare({
      workspaceId: "workspace-a",
      profileId: "fixture.workflow@1.0.0",
      source,
    });
    expect(denied).toEqual({
      ok: false,
      error: {
        code: "workflow.unauthorized",
        message: "This workflow is not available.",
        field: "profileId",
      },
    });

    globalThis.fetch = testDouble
      .fn()
      .mockRejectedValue(new Error("private transport detail")) as never;
    const unavailable = await client.listProfiles({
      workspaceId: "workspace-a",
    });
    expect(unavailable).toEqual({
      ok: false,
      error: {
        code: "workflow.failed",
        message: "System workflows are unavailable.",
      },
    });
  });
});
