import { afterEach, describe, expect, it, testDouble } from "../../../modules/testing/node-test";

import { createApiRuntimeReadinessClient } from "../src/features/runtime-readiness";

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalLocalStorage === undefined) {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  } else {
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      configurable: true,
      writable: true,
    });
  }
});

function installLocalStorage() {
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: testDouble.fn(() => null) },
    configurable: true,
    writable: true,
  });
}

describe("api runtime readiness client", () => {
  it("reads the server runtime readiness snapshot", async () => {
    installLocalStorage();
    const snapshot = { status: "ready", healthy: true, available: true, capabilities: [] };
    const fetchMock = testDouble.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      status: 200,
      json: async () => ({ ok: true, operation: "runtime.readiness-read", value: snapshot }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await createApiRuntimeReadinessClient().readRuntimeReadiness();

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall?.[0]).toBe("/api/runtime/readiness");
    expect(result).toEqual(snapshot);
  });

  it("reads one runtime capability status", async () => {
    installLocalStorage();
    const capability = { capabilityId: "python-runtime", status: "ready", healthy: true, available: true };
    const fetchMock = testDouble.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      status: 200,
      json: async () => ({ ok: true, operation: "runtime.capability-status-read", value: capability }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await createApiRuntimeReadinessClient({ apiBaseUrl: "http://localhost:3010/api" })
      .readRuntimeCapabilityStatus("python-runtime");

    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall?.[0]).toBe("http://localhost:3010/api/runtime/capabilities/python-runtime");
    expect(result).toEqual(capability);
  });
});
