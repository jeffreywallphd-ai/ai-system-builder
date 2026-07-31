import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  testDouble,
} from "../../../../../../modules/testing/node-test";
import { createThinClientSystemPublishedLifecycleClient } from "./thinClientSystemPublishedLifecycleClient";

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
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

describe("thin-client published system lifecycle client", () => {
  it("uses exact-release read and minimal intent routes", async () => {
    const fetcher = testDouble.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, value: { state: "not-installed" } }),
    });
    globalThis.fetch = fetcher as never;
    const client = createThinClientSystemPublishedLifecycleClient("/api/");
    await client.read({ workspaceId: "workspace a", releaseId: "release/a" });
    await client.invoke({
      workspaceId: "workspace-a",
      releaseId: "release-a",
      action: "install",
      expectedRevision: "not-installed",
    });

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "/api/systems/published-lifecycle?workspaceId=workspace%20a&releaseId=release%2Fa",
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe(
      "/api/systems/published-lifecycle/invoke",
    );
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      workspaceId: "workspace-a",
      releaseId: "release-a",
      action: "install",
      expectedRevision: "not-installed",
    });
  });

  it("hides transport exceptions", async () => {
    globalThis.fetch = testDouble
      .fn()
      .mockRejectedValue(new Error("private transport detail")) as never;
    expect(
      await createThinClientSystemPublishedLifecycleClient().read({
        workspaceId: "workspace-a",
        releaseId: "release-a",
      }),
    ).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        message: "Published system lifecycle is unavailable.",
      },
    });
  });
});
