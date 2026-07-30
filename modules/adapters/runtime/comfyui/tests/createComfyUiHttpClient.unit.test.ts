import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";

import { createComfyUiHttpClient } from "../createComfyUiHttpClient";

describe("createComfyUiHttpClient", () => {
  it("maps GET endpoints", async () => {
    let call = 0;
    const fetcher = testDouble.fn(async () => {
      call += 1;
      if (call === 1)
        return { ok: true, status: 200, json: async () => ({ devices: [] }) };
      if (call === 2)
        return {
          ok: true,
          status: 200,
          json: async () => ({ queue_running: [], queue_pending: [] }),
        };
      return {
        ok: true,
        status: 200,
        json: async () => ({ abc: { outputs: {} } }),
      };
    });
    const client = createComfyUiHttpClient({
      baseUrl: "http://127.0.0.1:8188",
      fetchImplementation: fetcher as never,
    });

    await client.getSystemStats();
    await client.getQueue();
    await client.getHistory();

    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:8188/system_stats",
    );
    expect(fetcher.mock.calls[1]?.[0]).toBe("http://127.0.0.1:8188/queue");
    expect(fetcher.mock.calls[2]?.[0]).toBe("http://127.0.0.1:8188/history");
  });

  it("posts prompt payload", async () => {
    const fetcher = testDouble
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ prompt_id: "p1", number: 1 }),
      });
    const client = createComfyUiHttpClient({
      baseUrl: "http://127.0.0.1:8188",
      fetchImplementation: fetcher as never,
    });

    await client.submitPrompt({ prompt: { node1: {} } });

    expect(fetcher.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8188/prompt");
    expect((fetcher.mock.calls[0]?.[1] as { method: string }).method).toBe(
      "POST",
    );
  });

  it("posts a scoped cancellation request", async () => {
    const fetcher = testDouble.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    const client = createComfyUiHttpClient({
      baseUrl: "http://127.0.0.1:8188",
      fetchImplementation: fetcher as never,
    });

    await expect(client.cancelPrompt("prompt-1")).resolves.toEqual({
      cancelled: true,
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8188/queue");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ delete: ["prompt-1"] }),
    });
  });

  it("aborts runtime requests at the configured timeout", async () => {
    const fetcher = testDouble.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new Error("aborted"));
          });
        }),
    );
    const client = createComfyUiHttpClient({
      baseUrl: "http://127.0.0.1:8188",
      fetchImplementation: fetcher as never,
      requestTimeoutMs: 1_000,
    });

    await expect(client.getQueue()).rejects.toThrow(
      "ComfyUI request timed out for /queue",
    );
  });

  it("posts ComfyUI free-memory request when unloading models", async () => {
    const fetcher = testDouble
      .fn()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ unload_models: true, free_memory: true }),
      });
    const client = createComfyUiHttpClient({
      baseUrl: "http://127.0.0.1:8188",
      fetchImplementation: fetcher as never,
    });

    const result = await client.unloadModels();

    expect(fetcher.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8188/free");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ unload_models: true, free_memory: true }),
    });
    expect(result).toEqual({ unloadedModels: true, freedMemory: true });
  });

  it("accepts successful /free responses even when response JSON is invalid", async () => {
    const fetcher = testDouble.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("invalid json");
      },
    });
    const client = createComfyUiHttpClient({
      baseUrl: "http://127.0.0.1:8188",
      fetchImplementation: fetcher as never,
    });

    await expect(client.unloadModels()).resolves.toEqual({
      unloadedModels: true,
      freedMemory: true,
    });
  });

  it("surfaces endpoint failures", async () => {
    const fetcher = testDouble
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: "boom" }),
      });
    const client = createComfyUiHttpClient({
      baseUrl: "http://127.0.0.1:8188",
      fetchImplementation: fetcher as never,
    });
    await expect(client.getQueue()).rejects.toThrow(
      "ComfyUI request failed for /queue with status 500",
    );
  });
});
