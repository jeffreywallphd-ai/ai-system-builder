import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { createPythonRuntimeHttpClient } from "../client/createPythonRuntimeHttpClient";

describe("createPythonRuntimeHttpClient", () => {
  it("calls POST /tasks/start", async () => {
    const fetcher = testDouble.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ requestId: "r1", taskType: "train-model", accepted: true, status: "queued" }) });
    const client = createPythonRuntimeHttpClient({ baseUrl: "http://localhost:8000", fetchImplementation: fetcher as never });
    await client.startTask({ requestId: "r1", taskType: "train-model", payload: { x: 1 } });
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://localhost:8000/tasks/start");
    expect((fetcher.mock.calls[0]?.[1] as { method?: string }).method).toBe("POST");
  });

  it("calls GET /tasks/{requestId}", async () => {
    const fetcher = testDouble.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ requestId: "r2", taskType: "train-model", status: "running" }) });
    const client = createPythonRuntimeHttpClient({ baseUrl: "http://localhost:8000", fetchImplementation: fetcher as never });
    await client.readTaskStatus("r2");
    expect(fetcher).toHaveBeenCalledWith("http://localhost:8000/tasks/r2", { method: "GET" });
  });

  it("calls POST /tasks/{requestId}/cancel", async () => {
    const fetcher = testDouble.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ requestId: "r3", status: "cancelled", cancelled: true }) });
    const client = createPythonRuntimeHttpClient({ baseUrl: "http://localhost:8000", fetchImplementation: fetcher as never });
    await client.cancelTask("r3");
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://localhost:8000/tasks/r3/cancel");
    expect((fetcher.mock.calls[0]?.[1] as { method?: string }).method).toBe("POST");
  });

  it("does not expose executeTask", () => {
    const client = createPythonRuntimeHttpClient({ baseUrl: "http://localhost:8000", fetchImplementation: testDouble.fn() as never });
    expect("executeTask" in (client as Record<string, unknown>)).toBe(false);
  });
});
