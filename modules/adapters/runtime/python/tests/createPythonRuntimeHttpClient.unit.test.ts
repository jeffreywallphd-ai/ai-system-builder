import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import { createPythonRuntimeHttpClient } from "../client/createPythonRuntimeHttpClient";

describe("createPythonRuntimeHttpClient", () => {
  it("supports health, capabilities, and task execution over local HTTP", async () => {
    const fetchImplementation = testDouble.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        expect(init?.method).toBe("GET");
        return new Response(JSON.stringify({
          healthy: true,
          status: {
            runtimeId: "python-sidecar",
            status: "ready",
          },
        }), { status: 200 });
      }

      if (url.endsWith("/capabilities")) {
        expect(init?.method).toBe("GET");
        return new Response(JSON.stringify({
          runtimeId: "python-sidecar",
          capabilities: ["prepare-training-dataset", "ensure-model-download"],
        }), { status: 200 });
      }

      expect(url.endsWith("/tasks/execute")).toBe(true);
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ "content-type": "application/json" });
      return new Response(JSON.stringify({
        requestId: "req-python-1",
        taskType: "prepare-training-dataset",
        success: false,
        error: {
          code: "not_implemented",
          message: "Not implemented",
        },
      }), { status: 200 });
    });

    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://127.0.0.1:43111/",
      fetchImplementation,
    });

    const health = await client.getHealthStatus();
    const capabilities = await client.getCapabilities();
    const task = await client.executeTask({
      requestId: "req-python-1",
      taskType: "prepare-training-dataset",
      payload: {},
    });

    expect(health.healthy).toBe(true);
    expect(capabilities.capabilities).toContain("prepare-training-dataset");
    expect(capabilities.capabilities).toContain("ensure-model-download");
    expect(task.success).toBe(false);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it("supports ensure-model-downloaded endpoint over local HTTP", async () => {
    const fetchImplementation = testDouble.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      expect(url.endsWith("/models/ensure-downloaded")).toBe(true);
      expect(init?.method).toBe("POST");
      expect(init?.headers).toMatchObject({ "content-type": "application/json" });
      expect(JSON.parse(String(init?.body ?? "{}"))).toEqual({
        provider: "transformers",
        modelId: "Qwen/Qwen2.5-1.5B-Instruct",
      });
      return new Response(JSON.stringify({
        provider: "transformers",
        modelId: "Qwen/Qwen2.5-1.5B-Instruct",
        downloaded: true,
        fromCache: false,
        localPath: "/tmp/model-cache",
      }), { status: 200 });
    });

    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://127.0.0.1:43111",
      fetchImplementation,
    });

    const result = await client.ensureModelDownloaded({
      provider: "transformers",
      modelId: "Qwen/Qwen2.5-1.5B-Instruct",
    });

    expect(result).toEqual({
      provider: "transformers",
      modelId: "Qwen/Qwen2.5-1.5B-Instruct",
      downloaded: true,
      fromCache: false,
      localPath: "/tmp/model-cache",
    });
  });

  it("supports model status and unload endpoints over local HTTP", async () => {
    const fetchImplementation = testDouble.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/models/status")) {
        expect(init?.method).toBe("GET");
        return new Response(JSON.stringify({
          loadedModels: [{
            provider: "transformers",
            modelId: "google/flan-t5-base",
            inferenceMode: "text2text",
            device: "auto",
            torchDtype: "auto",
            localPath: "/tmp/models/flan",
          }],
          activeTaskCount: 0,
        }), { status: 200 });
      }

      expect(url.endsWith("/models/unload")).toBe(true);
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({
        unloadedModels: [{
          provider: "transformers",
          modelId: "google/flan-t5-base",
          inferenceMode: "text2text",
          device: "auto",
          torchDtype: "auto",
          localPath: "/tmp/models/flan",
        }],
        activeTaskCount: 0,
      }), { status: 200 });
    });

    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://127.0.0.1:43111",
      fetchImplementation,
    });

    const status = await client.getModelStatus();
    const unload = await client.unloadModels();

    expect(status.loadedModels[0]?.localPath).toBe("/tmp/models/flan");
    expect(unload.unloadedModels[0]?.modelId).toBe("google/flan-t5-base");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("maps structured model download failures without exposing ASGI stack traces", async () => {
    const fetchImplementation = testDouble.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        error: {
          code: "model_download_failed",
          errorCode: "generation_model_not_available",
          stage: "generation",
          message: "Automatic download failed. Verify network access.",
          retryable: true,
        },
      }), { status: 502 }));

    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://127.0.0.1:43111",
      fetchImplementation,
    });

    await expect(client.ensureModelDownloaded({
      provider: "transformers",
      modelId: "Qwen/Qwen3.5-4B",
    })).rejects.toThrow(
      "Python runtime model download failed: Automatic download failed. Verify network access.",
    );
  });

  it("maps structured health payloads from non-2xx responses", async () => {
    const fetchImplementation = testDouble.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        healthy: false,
        status: {
          runtimeId: "python-sidecar",
          status: "failed",
        },
        error: {
          code: "runtime_unavailable",
          message: "Runtime unavailable.",
        },
      }), { status: 503 }));

    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://127.0.0.1:43111",
      fetchImplementation,
    });

    const health = await client.getHealthStatus();
    expect(health.healthy).toBe(false);
    expect(health.error?.code).toBe("runtime_unavailable");
  });

  it("maps structured capabilities payloads from non-2xx responses", async () => {
    const fetchImplementation = testDouble.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        runtimeId: "python-sidecar",
        capabilities: ["prepare-training-dataset"],
      }), { status: 503 }));

    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://127.0.0.1:43111",
      fetchImplementation,
    });

    const capabilities = await client.getCapabilities();
    expect(capabilities.runtimeId).toBe("python-sidecar");
    expect(capabilities.capabilities).toEqual(["prepare-training-dataset"]);
  });

  it("throws clear fallback error when /health returns non-JSON payload", async () => {
    const fetchImplementation = testDouble.fn<typeof fetch>(async () =>
      new Response("service unavailable", { status: 503 }));

    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://127.0.0.1:43111",
      fetchImplementation,
    });

    await expect(client.getHealthStatus()).rejects.toThrow(
      "Python runtime request failed for /health with status 503 and invalid JSON response body.",
    );
  });

  it("throws clear fallback error when /capabilities returns malformed structured payload", async () => {
    const fetchImplementation = testDouble.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        runtimeId: "python-sidecar",
        capabilities: [123],
      }), { status: 503 }));

    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://127.0.0.1:43111",
      fetchImplementation,
    });

    await expect(client.getCapabilities()).rejects.toThrow(
      "Python runtime request failed for /capabilities with status 503 and invalid structured payload.",
    );
  });

  it("throws clear fallback error when /tasks/execute returns non-JSON payload", async () => {
    const fetchImplementation = testDouble.fn<typeof fetch>(async () =>
      new Response("<html>gateway timeout</html>", { status: 504 }));

    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://127.0.0.1:43111",
      fetchImplementation,
    });

    await expect(client.executeTask({
      requestId: "req-python-3",
      taskType: "prepare-training-dataset",
      payload: {},
    })).rejects.toThrow(
      "Python runtime request failed for /tasks/execute with status 504 and invalid JSON response body.",
    );
  });

  it("maps structured runtime task errors from non-2xx responses", async () => {
    const fetchImplementation = testDouble.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({
        requestId: "req-python-err",
        taskType: "prepare-training-dataset",
        success: false,
        error: {
          code: "chunk_limit_exceeded",
          stage: "chunking",
          message: "Chunk limit exceeded.",
          retryable: false,
          details: { maxChunkCount: 10_000, actualChunkCount: 20_001 },
        },
      }), { status: 422 }));

    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://127.0.0.1:43111",
      fetchImplementation,
    });

    const task = await client.executeTask({
      requestId: "req-python-err",
      taskType: "prepare-training-dataset",
      payload: {},
    });

    expect(task.success).toBe(false);
    expect(task.error).toMatchObject({
      code: "chunk_limit_exceeded",
      stage: "chunking",
      retryable: false,
    });
  });

  it("enforces task timeout and forwards timeoutMs to runtime", async () => {
    const fetchImplementation = testDouble.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body.timeoutMs).toBe(20);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 100);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
      return new Response(JSON.stringify({
        requestId: "req-python-2",
        taskType: "prepare-training-dataset",
        success: true,
        data: {},
      }), { status: 200 });
    });

    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://127.0.0.1:43111",
      fetchImplementation,
      defaultTaskTimeoutMs: 20,
    });

    await expect(client.executeTask({
      requestId: "req-python-2",
      taskType: "prepare-training-dataset",
      payload: {},
    })).rejects.toThrow("timed out");
  });
});
