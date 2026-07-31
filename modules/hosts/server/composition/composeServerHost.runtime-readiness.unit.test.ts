import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, testDouble } from "../../../testing/node-test";
import { createServerRuntimeReadinessService } from "./composeServerHost";

describe("createServerRuntimeReadinessService", () => {
  it("wires execution-time capability preparation to the Python supervisor", () => {
    const source = readFileSync(
      resolve("modules/hosts/server/composition/composeServerHost.ts"),
      "utf8",
    );

    expect(source).toContain("async prepareCapability(capabilityId)");
    expect(source).toContain('capabilityId === "dataset-preparation"');
  });

  it("reads supervisor and installer status without starting or repairing runtimes", async () => {
    const startPython = testDouble.fn();
    const startComfyUi = testDouble.fn();
    const repairComfyUi = testDouble.fn();
    const readComfyUiInstallStatus = testDouble.fn(
      async () => "installed" as const,
    );
    const service = createServerRuntimeReadinessService({
      pythonSupervisor: {
        getStatus: testDouble.fn(() => "stopped" as const),
        start: startPython,
      } as any,
      readComfyUiSupervisor: () =>
        ({
          getStatus: testDouble.fn(() => "stopped" as const),
          start: startComfyUi,
        }) as any,
      readComfyUiInstallStatus,
      now: () => "2026-05-06T00:00:00.000Z",
    });

    const snapshot = await service.getReadinessSnapshot();

    expect(
      snapshot.capabilities.map((capability) => capability.capabilityId),
    ).toEqual([
      "python-runtime",
      "comfyui-runtime",
      "image-generation",
      "dataset-preparation",
      "model-training",
      "model-validation",
      "model-publishing",
    ]);
    expect(readComfyUiInstallStatus).toHaveBeenCalled();
    expect(startPython).not.toHaveBeenCalled();
    expect(startComfyUi).not.toHaveBeenCalled();
    expect(repairComfyUi).not.toHaveBeenCalled();
  });

  it("reports a missing ComfyUI supervisor as an explicit host-scoped readiness status", async () => {
    const service = createServerRuntimeReadinessService({
      pythonSupervisor: { getStatus: () => "ready" },
      readComfyUiSupervisor: () => undefined,
      now: () => "2026-05-06T00:00:00.000Z",
    });

    const status = await service.getCapabilityStatus("comfyui-runtime");

    expect(status).toMatchObject({
      capabilityId: "comfyui-runtime",
      status: "unknown",
      reason: { code: "runtime.comfyui.supervisor-missing" },
    });
  });
});
