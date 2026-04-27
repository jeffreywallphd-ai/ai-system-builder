import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import {
  DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_CONTROL_RESPONSE_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_STATUS_READ_RESPONSE_CHANNEL,
  createDesktopPythonRuntimeControlRequest,
  createDesktopPythonRuntimeStatusReadRequest,
} from "../../../../contracts/ipc";
import {
  createDesktopPythonRuntimeControlIpcHandler,
  createDesktopPythonRuntimeStatusReadIpcHandler,
  registerPythonRuntimeIpc,
} from "../python-runtime/registerPythonRuntimeIpc";

describe("registerPythonRuntimeIpc", () => {
  it("maps status-read requests to runtime status response envelope", async () => {
    const handler = createDesktopPythonRuntimeStatusReadIpcHandler({
      readPythonRuntimeStatus: testDouble.fn(async () => ({
        supervisorStatus: "ready",
        healthy: true,
        runtimeStatus: "ready",
        capabilities: ["prepare-training-dataset"],
        logs: [],
      })),
    });

    const response = await handler({}, createDesktopPythonRuntimeStatusReadRequest({
      boundary: {
        host: "desktop",
        source: "desktop.renderer.runtime-footer",
      },
    }));

    expect(response.ok).toBe(true);
    expect(response.value.runtimeStatus).toBe("ready");
  });

  it("maps control requests to runtime action and status response envelope", async () => {
    const startPythonRuntime = testDouble.fn(async () => undefined);
    const handler = createDesktopPythonRuntimeControlIpcHandler({
      startPythonRuntime,
      stopPythonRuntime: testDouble.fn(async () => undefined),
      restartPythonRuntime: testDouble.fn(async () => undefined),
      unloadPythonRuntimeModel: testDouble.fn(async () => undefined),
      readPythonRuntimeStatus: testDouble.fn(async () => ({
        supervisorStatus: "starting",
        healthy: false,
        runtimeStatus: "starting",
        capabilities: [],
        logs: [],
      })),
    });

    const response = await handler({}, createDesktopPythonRuntimeControlRequest({
      action: "start",
      boundary: {
        host: "desktop",
        source: "desktop.renderer.runtime-footer",
      },
    }));

    expect(startPythonRuntime).toHaveBeenCalledOnce();
    expect(response.ok).toBe(true);
    expect(response.value.supervisorStatus).toBe("starting");
  });

  it("maps status-read handler errors to IPC failure envelopes with the status-read response channel", async () => {
    const handler = createDesktopPythonRuntimeStatusReadIpcHandler({
      readPythonRuntimeStatus: testDouble.fn(async () => {
        throw new Error("status not available");
      }),
    });

    const response = await handler({}, createDesktopPythonRuntimeStatusReadRequest({
      boundary: {
        host: "desktop",
        source: "desktop.renderer.runtime-footer",
      },
    }, {
      requestId: "req-python-status",
      correlationId: "corr-python-status",
    }));

    expect(response).toMatchObject({
      ok: false,
      channel: DESKTOP_PYTHON_RUNTIME_STATUS_READ_RESPONSE_CHANNEL.value,
      requestId: "req-python-status",
      correlationId: "corr-python-status",
    });
  });

  it("maps control handler errors to IPC failure envelopes with the control response channel", async () => {
    const handler = createDesktopPythonRuntimeControlIpcHandler({
      startPythonRuntime: testDouble.fn(async () => undefined),
      stopPythonRuntime: testDouble.fn(async () => undefined),
      restartPythonRuntime: testDouble.fn(async () => {
        throw new Error("restart failed");
      }),
      unloadPythonRuntimeModel: testDouble.fn(async () => undefined),
      readPythonRuntimeStatus: testDouble.fn(async () => ({
        supervisorStatus: "failed",
        healthy: false,
        runtimeStatus: "failed",
        capabilities: [],
        logs: [],
      })),
    });

    const response = await handler({}, createDesktopPythonRuntimeControlRequest({
      action: "restart",
      boundary: {
        host: "desktop",
        source: "desktop.renderer.runtime-footer",
      },
    }, {
      requestId: "req-python-control",
      correlationId: "corr-python-control",
    }));

    expect(response).toMatchObject({
      ok: false,
      channel: DESKTOP_PYTHON_RUNTIME_CONTROL_RESPONSE_CHANNEL.value,
      requestId: "req-python-control",
      correlationId: "corr-python-control",
    });
  });

  it("registers python runtime IPC channels", () => {
    const channels: string[] = [];
    registerPythonRuntimeIpc({
      ipcMain: {
        handle: testDouble.fn((channel: string) => {
          channels.push(channel);
        }),
      },
      startPythonRuntime: testDouble.fn(async () => undefined),
      stopPythonRuntime: testDouble.fn(async () => undefined),
      restartPythonRuntime: testDouble.fn(async () => undefined),
      unloadPythonRuntimeModel: testDouble.fn(async () => undefined),
      readPythonRuntimeStatus: testDouble.fn(async () => ({
        supervisorStatus: "stopped",
        healthy: false,
        runtimeStatus: "stopped",
        capabilities: [],
        logs: [],
      })),
    });

    expect(channels).toEqual([
      DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL.value,
      DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL.value,
    ]);
  });

  it("maps unload-model control requests to the runtime model unload operation", async () => {
    const unloadPythonRuntimeModel = testDouble.fn(async () => undefined);
    const handler = createDesktopPythonRuntimeControlIpcHandler({
      startPythonRuntime: testDouble.fn(async () => undefined),
      stopPythonRuntime: testDouble.fn(async () => undefined),
      restartPythonRuntime: testDouble.fn(async () => undefined),
      unloadPythonRuntimeModel,
      readPythonRuntimeStatus: testDouble.fn(async () => ({
        supervisorStatus: "ready",
        healthy: true,
        runtimeStatus: "ready",
        capabilities: ["unload-model"],
        logs: [],
        loadedModels: [],
        activeTaskCount: 0,
      })),
    });

    const response = await handler({}, createDesktopPythonRuntimeControlRequest({
      action: "unload-model",
      boundary: {
        host: "desktop",
        source: "desktop.renderer.dataset-preparation",
      },
    }));

    expect(unloadPythonRuntimeModel).toHaveBeenCalledOnce();
    expect(response.ok).toBe(true);
  });
});
