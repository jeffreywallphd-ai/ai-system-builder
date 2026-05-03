import { describe, expect, it } from "../../../../testing/node-test";

import {
  mapCancelTaskResponse,
  mapCapabilitiesResponseFromHttpPayload,
  mapHealthResponseFromHttpPayload,
  mapStartTaskRequest,
  mapStartTaskResponse,
  mapTaskStatusResponse,
} from "../protocol/pythonRuntimeHttpProtocol";

describe("pythonRuntimeHttpProtocol", () => {
  it("keeps contract payloads canonical when mapping to/from HTTP payloads", () => {
    const request = {
      requestId: "req-python-1",
      taskType: "prepare-training-dataset",
      payload: { template: "{{text}}" },
    };

    const requestPayload = mapStartTaskRequest(request);
    expect(requestPayload.requestId).toBe(request.requestId);

    const health = mapHealthResponseFromHttpPayload({
      healthy: true,
      status: {
        runtimeId: "python-sidecar",
        status: "ready",
      },
    });
    expect(health.status.runtimeId).toBe("python-sidecar");

    const capabilities = mapCapabilitiesResponseFromHttpPayload({
      runtimeId: "python-sidecar",
      capabilities: ["prepare-training-dataset"],
    });
    expect(capabilities.capabilities).toContain("prepare-training-dataset");

    const taskResult = mapTaskStatusResponse({
      requestId: "req-python-1",
      taskType: "prepare-training-dataset",
      status: "failed",
      error: { code: "not_implemented", stage: "generation", message: "Not implemented." },
    });
    expect(taskResult.status).toBe("failed");
    expect(taskResult.error?.stage).toBe("generation");
  });

  it("maps legacy errorCode payloads to canonical code", () => {
    const taskResult = mapTaskStatusResponse({
      requestId: "req-python-1",
      taskType: "prepare-training-dataset",
      status: "failed",
      error: { errorCode: "runtime_timeout", stage: "generation", message: "Timed out." },
    });

    expect(taskResult.error?.code).toBe("runtime_timeout");
  });

  it("rejects malformed health payloads", () => {
    expect(() => mapHealthResponseFromHttpPayload({ healthy: "yes" })).toThrow(
      "healthy must be a boolean",
    );
  });

  it("rejects unsupported runtime status values in health payloads", () => {
    expect(() =>
      mapHealthResponseFromHttpPayload({
        healthy: true,
        status: {
          runtimeId: "python-sidecar",
          status: "warming",
        },
      }),
    ).toThrow("status.status must be one of starting, ready, degraded, stopped, failed");
  });

  it("rejects malformed capabilities payloads", () => {
    expect(() => mapCapabilitiesResponseFromHttpPayload({ runtimeId: "python", capabilities: [1] })).toThrow(
      "capabilities[0] must be a non-empty string",
    );
  });

  it("rejects malformed task payloads", () => {
    expect(() => mapTaskStatusResponse({ requestId: "id", taskType: "t", status: "running", metadata: [] })).toThrow(
      "metadata: expected object payload",
    );
  });

  it("maps async start-task request/response payloads", () => {
    const mappedRequest = mapStartTaskRequest({
      requestId: "task-1",
      taskType: "prepare-training-dataset",
      payload: { source: "a" },
      metadata: { source: "desktop" },
    });
    expect(mappedRequest.requestId).toBe("task-1");

    const result = mapStartTaskResponse({
      requestId: "task-1",
      taskType: "prepare-training-dataset",
      accepted: true,
      status: "running",
    });
    expect(result.accepted).toBe(true);
    expect(result.status).toBe("running");
  });

  it("rejects async start payloads when accepted is false", () => {
    expect(() =>
      mapStartTaskResponse({
        requestId: "task-1",
        taskType: "prepare-training-dataset",
        accepted: false,
        status: "queued",
      }),
    ).toThrow("accepted must be true");
  });

  it("rejects async start payloads with non-start statuses", () => {
    expect(() =>
      mapStartTaskResponse({
        requestId: "task-1",
        taskType: "prepare-training-dataset",
        accepted: true,
        status: "failed",
      }),
    ).toThrow("start status must be queued or running");
  });

  it("maps task status payloads for running/succeeded/failed states", () => {
    expect(mapTaskStatusResponse({ requestId: "task-1", status: "running" }).status).toBe("running");
    expect(mapTaskStatusResponse({ requestId: "task-1", status: "succeeded", data: { rows: 10 } }).status).toBe("succeeded");
    const failed = mapTaskStatusResponse({
      requestId: "task-1",
      status: "failed",
      error: { code: "runtime_failed", message: "boom" },
    });
    expect(failed.status).toBe("failed");
    expect(failed.error?.code).toBe("runtime_failed");
  });

  it("maps cancel payloads and normalizes invalid statuses to unknown", () => {
    const result = mapCancelTaskResponse({
      requestId: "task-1",
      status: "cancelled",
      cancelled: true,
      message: "Cancelled.",
    });
    expect(result.cancelled).toBe(true);
    expect(result.status).toBe("cancelled");

    const normalized = mapTaskStatusResponse({ requestId: "task-1", status: 123 });
    expect(normalized.status).toBe("unknown");
  });
});
