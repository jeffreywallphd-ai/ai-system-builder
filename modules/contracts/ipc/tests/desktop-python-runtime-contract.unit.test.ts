import { describe, expect, it } from "../../../testing/node-test";

import {
  DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION,
  DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_CONTROL_RESPONSE_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION,
  DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_STATUS_READ_RESPONSE_CHANNEL,
  createDesktopPythonRuntimeControlRequest,
  createDesktopPythonRuntimeControlSuccessResponse,
  createDesktopPythonRuntimeStatusReadRequest,
  createDesktopPythonRuntimeStatusReadSuccessResponse,
} from "..";

describe("desktop python runtime ipc contract", () => {
  it("defines operation and channel identities", () => {
    expect(DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION).toBe("runtime.python-status-read");
    expect(DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION).toBe("runtime.python-control");
    expect(DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL.value).toBe("ipc.runtime.python-status-read.request");
    expect(DESKTOP_PYTHON_RUNTIME_STATUS_READ_RESPONSE_CHANNEL.value).toBe("ipc.runtime.python-status-read.response");
    expect(DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL.value).toBe("ipc.runtime.python-control.request");
    expect(DESKTOP_PYTHON_RUNTIME_CONTROL_RESPONSE_CHANNEL.value).toBe("ipc.runtime.python-control.response");
  });

  it("creates normalized request and success envelopes", () => {
    const request = createDesktopPythonRuntimeStatusReadRequest({
      boundary: {
        host: "desktop",
        source: " desktop.renderer.runtime-footer ",
      },
    });

    expect(request.payload.boundary.source).toBe("desktop.renderer.runtime-footer");

    const controlRequest = createDesktopPythonRuntimeControlRequest({
      action: "restart",
      boundary: {
        host: "desktop",
        source: " desktop.renderer.runtime-footer ",
      },
    });

    expect(controlRequest.payload.action).toBe("restart");
    expect(controlRequest.payload.boundary.source).toBe("desktop.renderer.runtime-footer");

    const unloadRequest = createDesktopPythonRuntimeControlRequest({
      action: "unload-model",
      boundary: {
        host: "desktop",
        source: " desktop.renderer.dataset-preparation ",
      },
    });
    expect(unloadRequest.payload.action).toBe("unload-model");

    const statusResponse = createDesktopPythonRuntimeStatusReadSuccessResponse({
      supervisorStatus: "ready",
      healthy: true,
      runtimeStatus: "ready",
      capabilities: ["prepare-training-dataset"],
      loadedModels: [{
        provider: "transformers",
        modelId: " google/flan-t5-base ",
        inferenceMode: "text2text",
        localPath: " /tmp/models/flan ",
      }],
      activeTaskCount: 0,
      logs: [{
        timestamp: "2026-04-20T00:00:00.000Z",
        level: "info",
        message: " Runtime is healthy. ",
      }],
    });
    expect(statusResponse.ok).toBe(true);
    expect(statusResponse.value.logs[0]?.message).toBe("Runtime is healthy.");
    expect(statusResponse.value.loadedModels?.[0]?.modelId).toBe("google/flan-t5-base");
    expect(statusResponse.value.loadedModels?.[0]?.localPath).toBe("/tmp/models/flan");

    const controlResponse = createDesktopPythonRuntimeControlSuccessResponse({
      supervisorStatus: "starting",
      healthy: false,
      runtimeStatus: "starting",
      capabilities: [],
      logs: [],
    });
    expect(controlResponse.ok).toBe(true);
    expect(controlResponse.value.supervisorStatus).toBe("starting");
  });
});
