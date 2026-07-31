import { describe, expect, it } from "../../../testing/node-test";

import {
  API_RUNTIME_CAPABILITY_STATUS_READ_OPERATION,
  API_RUNTIME_READINESS_READ_OPERATION,
  createApiRuntimeCapabilityStatusReadRequest,
  createApiRuntimeCapabilityStatusReadSuccessResponse,
  createApiRuntimeReadinessReadRequest,
  createApiRuntimeReadinessReadSuccessResponse,
} from "..";

const now = "2026-05-06T00:00:00.000Z";

describe("runtime readiness api contracts", () => {
  it("uses runtime readiness operation identities", () => {
    expect(API_RUNTIME_READINESS_READ_OPERATION).toBe("runtime.readiness-read");
    expect(API_RUNTIME_CAPABILITY_STATUS_READ_OPERATION).toBe("runtime.capability-status-read");
  });

  it("normalizes capability ids in requests", () => {
    const request = createApiRuntimeCapabilityStatusReadRequest({ capabilityId: " PYTHON-RUNTIME " });

    expect(request).toMatchObject({
      operation: "runtime.capability-status-read",
      payload: { capabilityId: "python-runtime" },
    });
  });

  it("wraps shared readiness contracts without reshaping payloads", () => {
    const readRequest = createApiRuntimeReadinessReadRequest({ requestId: "r1", correlationId: "c1" });
    const capability = {
      capabilityId: "python-runtime" as const,
      status: "ready" as const,
      healthy: true,
      available: true,
      updatedAt: now,
    };
    const snapshot = {
      status: "ready" as const,
      healthy: true,
      available: true,
      capabilities: [capability],
      updatedAt: now,
    };

    expect(readRequest).toMatchObject({ requestId: "r1", correlationId: "c1" });
    expect(createApiRuntimeCapabilityStatusReadSuccessResponse(capability)).toMatchObject({
      ok: true,
      value: capability,
    });
    expect(createApiRuntimeReadinessReadSuccessResponse(snapshot)).toMatchObject({
      ok: true,
      value: snapshot,
    });
  });
});
