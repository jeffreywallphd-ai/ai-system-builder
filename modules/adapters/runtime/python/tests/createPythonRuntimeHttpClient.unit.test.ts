import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPythonRuntimeHttpClient } from "../client/createPythonRuntimeHttpClient";
import { PYTHON_RUNTIME_TASK_TIMEOUTS } from "../pythonRuntimeTaskTimeoutPolicy";

const RUNTIME_TOKEN = "runtime-test-token-0123456789abcdef";

function fetchCalls(fetcher: unknown): Array<[string, RequestInit]> {
  return (fetcher as { mock: { calls: Array<[string, RequestInit]> } }).mock
    .calls;
}

describe("createPythonRuntimeHttpClient", () => {
  it("calls POST /tasks/start", async () => {
    const fetcher = testDouble.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        requestId: "r1",
        taskType: "train-model",
        accepted: true,
        status: "queued",
      }),
    });
    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://localhost:8000",
      authorizationToken: RUNTIME_TOKEN,
      fetchImplementation: fetcher as never,
    });
    await client.startTask({
      requestId: "r1",
      taskType: "train-model",
      payload: { x: 1 },
    });
    expect(fetchCalls(fetcher)[0]?.[0]).toBe(
      "http://127.0.0.1:8000/tasks/start",
    );
    expect(fetchCalls(fetcher)[0]?.[1].method).toBe("POST");
    expect(
      (fetchCalls(fetcher)[0]?.[1].headers as Record<string, string>)
        .authorization,
    ).toBe(`Bearer ${RUNTIME_TOKEN}`);
  });

  it("calls GET /tasks/{requestId}", async () => {
    const fetcher = testDouble.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        requestId: "r2",
        taskType: "train-model",
        status: "running",
      }),
    });
    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://localhost:8000",
      authorizationToken: RUNTIME_TOKEN,
      fetchImplementation: fetcher as never,
    });
    await client.readTaskStatus("r2");
    expect(fetchCalls(fetcher)[0]?.[0]).toBe("http://127.0.0.1:8000/tasks/r2");
    expect(fetchCalls(fetcher)[0]?.[1]).toMatchObject({
      method: "GET",
      headers: { authorization: `Bearer ${RUNTIME_TOKEN}` },
    });
  });

  it("calls POST /tasks/{requestId}/cancel", async () => {
    const fetcher = testDouble.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        requestId: "r3",
        status: "cancelled",
        cancelled: true,
      }),
    });
    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://localhost:8000",
      authorizationToken: RUNTIME_TOKEN,
      fetchImplementation: fetcher as never,
    });
    await client.cancelTask("r3");
    expect(fetchCalls(fetcher)[0]?.[0]).toBe(
      "http://127.0.0.1:8000/tasks/r3/cancel",
    );
    expect(fetchCalls(fetcher)[0]?.[1].method).toBe("POST");
  });

  it("does not expose executeTask", () => {
    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://localhost:8000",
      authorizationToken: RUNTIME_TOKEN,
      fetchImplementation: testDouble.fn() as never,
    });
    expect(
      "executeTask" in (client as unknown as Record<string, unknown>),
    ).toBe(false);
  });

  it("runs model downloads through async task polling instead of a long request", async () => {
    const modelCacheRoot = await mkdtemp(
      path.join(tmpdir(), "aisb-python-model-cache-"),
    );
    const modelHandle =
      "models--stabilityai--stable-diffusion-xl-base-1.0/snapshots/sdxl";
    const modelPath = path.join(modelCacheRoot, ...modelHandle.split("/"));
    await mkdir(modelPath, { recursive: true });
    const responses = [
      {
        ok: true,
        status: 200,
        json: async () => ({
          requestId: "model-download-1",
          taskType: "ensure-model-download",
          accepted: true,
          status: "queued",
        }),
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          requestId: "model-download-1",
          taskType: "ensure-model-download",
          status: "succeeded",
          data: {
            provider: "transformers",
            modelId: "stabilityai/stable-diffusion-xl-base-1.0",
            downloaded: true,
            fromCache: false,
            modelHandle,
          },
        }),
      },
    ];
    const fetcher = testDouble.fn(async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error("Unexpected fetch call.");
      }
      return response;
    });
    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://localhost:8000",
      authorizationToken: RUNTIME_TOKEN,
      fetchImplementation: fetcher as never,
      modelDownloadPollIntervalMs: 1,
      environment: { HF_HUB_CACHE: modelCacheRoot },
    });

    const result = await client.ensureModelDownloaded({
      provider: "transformers",
      modelId: "stabilityai/stable-diffusion-xl-base-1.0",
      inferenceMode: "text-to-image",
      taskTags: ["text-to-image"],
      artifactForm: "checkpoint",
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetchCalls(fetcher)[0]?.[0]).toBe(
      "http://127.0.0.1:8000/tasks/start",
    );
    expect(JSON.parse(String(fetchCalls(fetcher)[0]?.[1].body))).toMatchObject({
      taskType: "ensure-model-download",
      timeoutMs: PYTHON_RUNTIME_TASK_TIMEOUTS.modelDownload,
      payload: {
        provider: "transformers",
        modelId: "stabilityai/stable-diffusion-xl-base-1.0",
        inferenceMode: "text-to-image",
        taskTags: ["text-to-image"],
        artifactForm: "checkpoint",
      },
    });
    expect(String(fetchCalls(fetcher)[1]?.[0])).toContain(
      "/tasks/model-download-",
    );
    expect(result).toEqual({
      provider: "transformers",
      modelId: "stabilityai/stable-diffusion-xl-base-1.0",
      downloaded: true,
      fromCache: false,
      localPath: modelPath,
    });
    await rm(modelCacheRoot, { recursive: true, force: true });
  });

  it("continues polling model downloads after recoverable task status transport failures", async () => {
    const modelCacheRoot = await mkdtemp(
      path.join(tmpdir(), "aisb-python-model-cache-"),
    );
    const modelHandle =
      "models--stabilityai--stable-diffusion-xl-base-1.0/snapshots/sdxl";
    const modelPath = path.join(modelCacheRoot, ...modelHandle.split("/"));
    await mkdir(modelPath, { recursive: true });
    const responses = [
      {
        ok: true,
        status: 200,
        json: async () => ({
          requestId: "model-download-1",
          taskType: "ensure-model-download",
          accepted: true,
          status: "queued",
        }),
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          requestId: "model-download-1",
          taskType: "ensure-model-download",
          status: "running",
          progress: {
            stage: "snapshot-download",
            message: "Downloading Hugging Face snapshot.",
          },
        }),
      },
      new TypeError("fetch failed"),
      {
        ok: true,
        status: 200,
        json: async () => ({
          requestId: "model-download-1",
          taskType: "ensure-model-download",
          status: "succeeded",
          data: {
            provider: "transformers",
            modelId: "stabilityai/stable-diffusion-xl-base-1.0",
            downloaded: true,
            fromCache: false,
            modelHandle,
          },
        }),
      },
    ];
    const fetcher = testDouble.fn(async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error("Unexpected fetch call.");
      }
      if (response instanceof Error) {
        throw response;
      }
      return response;
    });
    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://localhost:8000",
      authorizationToken: RUNTIME_TOKEN,
      fetchImplementation: fetcher as never,
      modelDownloadPollIntervalMs: 1,
      environment: { HF_HUB_CACHE: modelCacheRoot },
    });

    const result = await client.ensureModelDownloaded({
      provider: "transformers",
      modelId: "stabilityai/stable-diffusion-xl-base-1.0",
    });

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(result.localPath).toBe(modelPath);
    await rm(modelCacheRoot, { recursive: true, force: true });
  });

  it("aborts bounded transport requests and reports only the endpoint class", async () => {
    const fetcher = testDouble.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("private request id leaked")),
          );
        }),
    );
    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://localhost:8000",
      authorizationToken: RUNTIME_TOKEN,
      fetchImplementation: fetcher as never,
      transportRequestTimeoutMs: 100,
    });

    await expect(client.readTaskStatus("private-id-1")).rejects.toThrow(
      "Python runtime request timed out for /tasks/:requestId",
    );
  });

  it("rejects unsafe task and model identifiers before transport", async () => {
    const fetcher = testDouble.fn();
    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://localhost:8000",
      authorizationToken: RUNTIME_TOKEN,
      fetchImplementation: fetcher as never,
    });

    await expect(client.readTaskStatus("../private-task")).rejects.toThrow(
      "task identifier is invalid",
    );
    await expect(
      client.ensureModelDownloaded({
        provider: "transformers",
        modelId: "../private-model",
      }),
    ).rejects.toThrow("canonical owner/model format");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects non-loopback, credentialed, HTTPS, and path-bearing runtime URLs", () => {
    for (const baseUrl of [
      "http://192.168.1.4:8000",
      "http://user:pass@127.0.0.1:8000",
      "https://127.0.0.1:8000",
      "http://127.0.0.1:8000/runtime",
      "http://127.0.0.1:80",
    ]) {
      expect(() =>
        createPythonRuntimeHttpClient({
          baseUrl,
          authorizationToken: RUNTIME_TOKEN,
          fetchImplementation: testDouble.fn() as never,
        }),
      ).toThrow();
    }
  });

  it("reads the current launch token for every request", async () => {
    let token = RUNTIME_TOKEN;
    const fetcher = testDouble.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        healthy: true,
        status: { runtimeId: "python-sidecar", status: "ready" },
      }),
    }));
    const client = createPythonRuntimeHttpClient({
      baseUrl: "http://127.0.0.1:8000",
      authorizationTokenProvider: () => token,
      fetchImplementation: fetcher as never,
    });

    await client.getHealthStatus();
    token = "rotated-runtime-token-0123456789abcdef";
    await client.getHealthStatus();

    expect(
      (fetchCalls(fetcher)[0]?.[1].headers as Record<string, string>)
        .authorization,
    ).toBe(`Bearer ${RUNTIME_TOKEN}`);
    expect(
      (fetchCalls(fetcher)[1]?.[1].headers as Record<string, string>)
        .authorization,
    ).toBe("Bearer rotated-runtime-token-0123456789abcdef");
  });
});
