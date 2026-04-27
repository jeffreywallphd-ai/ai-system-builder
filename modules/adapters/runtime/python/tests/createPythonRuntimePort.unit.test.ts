import { describe, expect, expectTypeOf, it, testDouble } from "../../../../testing/node-test";

import type { PythonRuntimePort } from "../../../../application/ports/runtime";
import { createPythonRuntimeAdapterFoundation } from "../createPythonRuntimePort";

describe("createPythonRuntimeAdapterFoundation", () => {
  it("returns a runtime port and supervisor foundation ready for host composition", async () => {
    const fetchImplementation = testDouble.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({
          healthy: true,
          status: {
            runtimeId: "python-sidecar",
            status: "ready",
          },
        }), { status: 200 });
      }

      if (url.endsWith("/capabilities")) {
        return new Response(JSON.stringify({
          runtimeId: "python-sidecar",
          capabilities: ["prepare-training-dataset"],
        }), { status: 200 });
      }

      if (url.endsWith("/models/status")) {
        return new Response(JSON.stringify({
          loadedModels: [],
          activeTaskCount: 0,
        }), { status: 200 });
      }

      if (url.endsWith("/models/unload")) {
        return new Response(JSON.stringify({
          unloadedModels: [],
          activeTaskCount: 0,
        }), { status: 200 });
      }

      return new Response(JSON.stringify({
        requestId: "req-1",
        taskType: "prepare-training-dataset",
        success: false,
        error: {
          code: "not_implemented",
          message: "Not implemented",
        },
      }), { status: 200 });
    });

    const foundation = createPythonRuntimeAdapterFoundation({
      client: {
        baseUrl: "http://127.0.0.1:43111",
        fetchImplementation,
      },
      supervisor: {
        command: "python",
        args: ["main.py"],
        spawnImplementation: (() => ({
          once: () => undefined,
          kill: () => true,
        })) as any,
        startupTimeoutMs: 100,
        healthCheckIntervalMs: 1,
      },
    });

    expectTypeOf<typeof foundation.runtimePort>().toEqualTypeOf<PythonRuntimePort>();

    const health = await foundation.runtimePort.getHealthStatus();
    const capabilities = await foundation.runtimePort.getCapabilities();
    const modelStatus = await foundation.runtimePort.getModelStatus();
    const unloadResult = await foundation.runtimePort.unloadModels();
    const taskResult = await foundation.runtimePort.executeTask({
      requestId: "req-1",
      taskType: "prepare-training-dataset",
      payload: {},
    });

    expect(health.healthy).toBe(true);
    expect(capabilities.capabilities).toContain("prepare-training-dataset");
    expect(modelStatus.loadedModels).toEqual([]);
    expect(unloadResult.unloadedModels).toEqual([]);
    expect(taskResult.success).toBe(false);
    expect(foundation.supervisor.getStatus()).toBe("stopped");
  });
});
