import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import {
  DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_CREATE_BINDING_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_LIST_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_LATEST_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_REFRESH_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_SUMMARIZE_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_VALIDATE_BINDING_REQUEST_CHANNEL,
  createDesktopRuntimeCapabilityStatusReadRequest,
  createDesktopRuntimeReadinessReadRequest,
} from "../../../../contracts/ipc";
import { createRuntimeCapabilityStatus } from "../../../../contracts/runtime";
import { RuntimeReadinessService } from "../../../../application/services/runtime";
import type { RuntimeReadinessPort } from "../../../../application/ports/runtime";
import {
  createDesktopRuntimeCapabilityStatusReadIpcHandler,
  createDesktopRuntimeReadinessReadIpcHandler,
  registerRuntimeReadinessIpc,
} from "../runtime-readiness/registerRuntimeReadinessIpc";

function createRuntimeReadiness(overrides?: Partial<RuntimeReadinessPort>): RuntimeReadinessPort {
  return {
    getReadinessSnapshot: testDouble.fn<RuntimeReadinessPort["getReadinessSnapshot"]>().mockResolvedValue({
      status: "ready",
      healthy: true,
      available: true,
      capabilities: [],
      updatedAt: "2026-05-06T00:00:00.000Z",
    }),
    getCapabilityStatus: testDouble.fn<RuntimeReadinessPort["getCapabilityStatus"]>().mockResolvedValue(
      createRuntimeCapabilityStatus({
        capabilityId: "python-runtime",
        status: "ready",
        updatedAt: "2026-05-06T00:00:00.000Z",
      }),
    ),
    ...overrides,
  };
}

describe("registerRuntimeReadinessIpc", () => {
  it("returns readiness snapshots with request correlation preserved", async () => {
    const runtimeReadiness = createRuntimeReadiness();
    const handler = createDesktopRuntimeReadinessReadIpcHandler({ runtimeReadiness });
    const request = createDesktopRuntimeReadinessReadRequest(
      { boundary: { host: "desktop", source: "desktop.renderer.runtime-readiness" } },
      { requestId: "req-ready", correlationId: "corr-ready" },
    );

    const response = await handler({}, request);

    expect(runtimeReadiness.getReadinessSnapshot).toHaveBeenCalledOnce();
    expect(response).toMatchObject({
      ok: true,
      requestId: "req-ready",
      correlationId: "corr-ready",
      value: { status: "ready" },
    });
  });

  it("returns sanitized provider-failed snapshots without raw provider exception details", async () => {
    const runtimeReadiness = new RuntimeReadinessService({
      providers: [{
        capabilityId: "python-runtime",
        async getStatus() {
          throw new Error("C:\\secret\\token path TOKEN=abc /tmp/runtime");
        },
      }],
      now: () => "2026-05-06T00:00:00.000Z",
    });
    const handler = createDesktopRuntimeReadinessReadIpcHandler({ runtimeReadiness });
    const request = createDesktopRuntimeReadinessReadRequest(
      { boundary: { host: "desktop", source: "desktop.renderer.runtime-readiness" } },
      { requestId: "req-ready-sanitized", correlationId: "corr-ready-sanitized" },
    );

    const response = await handler({}, request);

    expect(response).toMatchObject({
      ok: true,
      value: {
        capabilities: [{
          capabilityId: "python-runtime",
          status: "failed",
          reason: {
            code: "runtime.readiness.provider-failed",
            message: "Runtime readiness provider failed. See logs for diagnostic details.",
            details: { failureKind: "provider-threw", capabilityId: "python-runtime" },
          },
        }],
      },
    });
    const payload = JSON.stringify(response);
    expect(payload).not.toContain("C:\\secret");
    expect(payload).not.toContain("TOKEN=abc");
    expect(payload).not.toContain("/tmp/runtime");
  });

  it("reads individual capability status by normalized capability id", async () => {
    const runtimeReadiness = createRuntimeReadiness();
    const handler = createDesktopRuntimeCapabilityStatusReadIpcHandler({ runtimeReadiness });
    const request = createDesktopRuntimeCapabilityStatusReadRequest(
      {
        capabilityId: "python-runtime",
        boundary: { host: "desktop", source: "desktop.renderer.runtime-readiness" },
      },
      { requestId: "req-cap", correlationId: "corr-cap" },
    );

    const response = await handler({}, request);

    expect(runtimeReadiness.getCapabilityStatus).toHaveBeenCalledWith("python-runtime");
    expect(response).toMatchObject({
      ok: true,
      requestId: "req-cap",
      correlationId: "corr-cap",
      value: { capabilityId: "python-runtime", status: "ready" },
    });
  });


  it("returns a generic internal message when readiness snapshot reads throw", async () => {
    const runtimeReadiness = createRuntimeReadiness({
      getReadinessSnapshot: testDouble.fn(async () => {
        throw new Error("C:/Users/name/AppData/Local/runtime secret TOKEN=abc\n    at RuntimeReader.read");
      }),
    });
    const handler = createDesktopRuntimeReadinessReadIpcHandler({ runtimeReadiness });
    const request = createDesktopRuntimeReadinessReadRequest(
      { boundary: { host: "desktop", source: "desktop.renderer.runtime-readiness" } },
      { requestId: "req-ready-fail", correlationId: "corr-ready-fail" },
    );

    const response = await handler({}, request);

    expect(response).toMatchObject({
      ok: false,
      requestId: "req-ready-fail",
      correlationId: "corr-ready-fail",
      error: {
        code: "internal",
        message: "Unable to read runtime readiness.",
      },
    });
    const payload = JSON.stringify(response);
    expect(payload).not.toContain("C:/Users/name");
    expect(payload).not.toContain("TOKEN=abc");
    expect(payload).not.toContain("RuntimeReader.read");
  });

  it("returns a generic internal message when capability status reads throw", async () => {
    const runtimeReadiness = createRuntimeReadiness({
      getCapabilityStatus: testDouble.fn(async () => {
        throw new Error("/tmp/runtime/socket failed\n    at Adapter.readStatus --token abc");
      }),
    });
    const handler = createDesktopRuntimeCapabilityStatusReadIpcHandler({ runtimeReadiness });
    const request = createDesktopRuntimeCapabilityStatusReadRequest(
      {
        capabilityId: "python-runtime",
        boundary: { host: "desktop", source: "desktop.renderer.runtime-readiness" },
      },
      { requestId: "req-cap-fail", correlationId: "corr-cap-fail" },
    );

    const response = await handler({}, request);

    expect(runtimeReadiness.getCapabilityStatus).toHaveBeenCalledWith("python-runtime");
    expect(response).toMatchObject({
      ok: false,
      requestId: "req-cap-fail",
      correlationId: "corr-cap-fail",
      error: {
        code: "internal",
        message: "Unable to read runtime capability status.",
      },
    });
    const payload = JSON.stringify(response);
    expect(payload).not.toContain("/tmp/runtime");
    expect(payload).not.toContain("Adapter.readStatus");
    expect(payload).not.toContain("--token abc");
  });

  it("maps invalid capability ids to validation failures without calling the service", async () => {
    const runtimeReadiness = createRuntimeReadiness();
    const handler = createDesktopRuntimeCapabilityStatusReadIpcHandler({ runtimeReadiness });
    const request = {
      ...createDesktopRuntimeCapabilityStatusReadRequest({
        capabilityId: "python-runtime",
        boundary: { host: "desktop", source: "desktop.renderer.runtime-readiness" },
      }, { requestId: "req-bad", correlationId: "corr-bad" }),
      payload: {
        capabilityId: "not-a-capability",
        boundary: { host: "desktop", source: "desktop.renderer.runtime-readiness" },
      },
    } as any;

    const response = await handler({}, request);

    expect(runtimeReadiness.getCapabilityStatus).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      ok: false,
      requestId: "req-bad",
      correlationId: "corr-bad",
      error: {
        code: "validation",
        message: "Unknown runtime capability id.",
        details: { field: "capabilityId" },
      },
    });
  });

  it("registers readiness snapshot and capability status channels", () => {
    const channels: string[] = [];
    registerRuntimeReadinessIpc({
      ipcMain: {
        handle: testDouble.fn((channel: string) => channels.push(channel)),
      },
      runtimeReadiness: createRuntimeReadiness(),
    });

    expect(channels).toEqual([
      DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL.value,
      DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL.value,
    ]);
  });

  it("registers v2 runtime-readiness channels when provided", () => {
    const channels: string[] = [];
    registerRuntimeReadinessIpc({
      ipcMain: { handle: testDouble.fn((channel: string) => channels.push(channel)) },
      runtimeReadiness: createRuntimeReadiness(),
      runtimeReadinessV2: {
        inventory: { refreshInventoryFromSources: testDouble.fn(), listRuntimeInventory: testDouble.fn(), readRuntimeInventory: testDouble.fn(), readLatestRuntimeInventory: testDouble.fn() },
        inventorySummary: { summarizeRuntimeCapabilities: testDouble.fn() },
        createBinding: { execute: testDouble.fn() },
        validateBinding: { execute: testDouble.fn() },
      },
    });

    expect(channels).toContain(DESKTOP_RUNTIME_READINESS_REFRESH_INVENTORY_REQUEST_CHANNEL.value);
    expect(channels).toContain(DESKTOP_RUNTIME_READINESS_LIST_INVENTORY_REQUEST_CHANNEL.value);
    expect(channels).toContain(DESKTOP_RUNTIME_READINESS_READ_INVENTORY_REQUEST_CHANNEL.value);
    expect(channels).toContain(DESKTOP_RUNTIME_READINESS_READ_LATEST_INVENTORY_REQUEST_CHANNEL.value);
    expect(channels).toContain(DESKTOP_RUNTIME_READINESS_SUMMARIZE_INVENTORY_REQUEST_CHANNEL.value);
    expect(channels).toContain(DESKTOP_RUNTIME_READINESS_CREATE_BINDING_REQUEST_CHANNEL.value);
    expect(channels).toContain(DESKTOP_RUNTIME_READINESS_VALIDATE_BINDING_REQUEST_CHANNEL.value);
  });

});
