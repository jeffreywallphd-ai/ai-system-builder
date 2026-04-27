import { describe, expect, it } from "../../../../testing/node-test";

import {
  mapCapabilitiesResponseFromHttpPayload,
  mapHealthResponseFromHttpPayload,
  mapTaskRequestToHttpPayload,
  mapTaskResponseFromHttpPayload,
} from "../protocol/pythonRuntimeHttpProtocol";

describe("pythonRuntimeHttpProtocol", () => {
  it("keeps contract payloads canonical when mapping to/from HTTP payloads", () => {
    const request = {
      requestId: "req-python-1",
      taskType: "prepare-training-dataset",
      payload: { template: "{{text}}" },
    };

    const requestPayload = mapTaskRequestToHttpPayload(request);
    expect(requestPayload).toMatchObject(request);

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

    const taskResult = mapTaskResponseFromHttpPayload({
      requestId: "req-python-1",
      taskType: "prepare-training-dataset",
      success: false,
      error: {
        code: "not_implemented",
        stage: "generation",
        message: "Not implemented.",
      },
    });
    expect(taskResult.success).toBe(false);
    expect(taskResult.error?.stage).toBe("generation");
    expect(taskResult.error?.code).toBe("not_implemented");
  });

  it("maps legacy errorCode payloads to canonical code", () => {
    const taskResult = mapTaskResponseFromHttpPayload({
      requestId: "req-python-1",
      taskType: "prepare-training-dataset",
      success: false,
      error: {
        errorCode: "runtime_timeout",
        stage: "generation",
        message: "Timed out.",
      },
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
    expect(() => mapTaskResponseFromHttpPayload({ requestId: "id", taskType: "t", success: true, metadata: [] })).toThrow(
      "metadata: expected object payload",
    );
  });
});
