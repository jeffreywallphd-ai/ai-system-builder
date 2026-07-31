import { describe, expect, it } from "../../../../testing/node-test";

import {
  RUNTIME_CAPABILITY_IDS,
  createRuntimeCapabilityStatus,
  type RuntimeCapabilityId,
  type RuntimeCapabilityStatus,
} from "../../../../contracts/runtime";
import type { RuntimeInstallStatus } from "../../../../contracts/runtime-installer";
import {
  RuntimeReadinessService,
  createComfyUiRuntimeCapabilityStatusProvider,
  createCompositeRuntimeCapabilityStatusProvider,
  createDerivedRuntimeCapabilityStatusProvider,
  createPythonRuntimeCapabilityStatusProvider,
  createRuntimeInstallerCapabilityStatusProvider,
  mapComfyUiRuntimeLifecycleStateToReadinessStatus,
  mapPythonRuntimeLifecycleStateToReadinessStatus,
  mapRuntimeInstallStatusToReadinessStatus,
  type RuntimeCapabilityStatusProvider,
} from "../runtime-readiness.service";

const NOW = "2026-05-06T00:00:00.000Z";
const now = () => NOW;

describe("RuntimeReadinessService", () => {
  it("maps Python supervisor-style states into shared readiness status vocabulary", async () => {
    expect(mapPythonRuntimeLifecycleStateToReadinessStatus("stopped")).toBe("unavailable");
    expect(mapPythonRuntimeLifecycleStateToReadinessStatus("starting")).toBe("starting");
    expect(mapPythonRuntimeLifecycleStateToReadinessStatus("ready")).toBe("ready");
    expect(mapPythonRuntimeLifecycleStateToReadinessStatus("failed")).toBe("failed");

    const provider = createPythonRuntimeCapabilityStatusProvider({ readState: () => "ready", now });
    expect(await provider.getStatus()).toMatchObject({
      capabilityId: "python-runtime",
      status: "ready",
      healthy: true,
      available: true,
      updatedAt: NOW,
    });
  });

  it("maps ComfyUI supervisor-style states into shared readiness status vocabulary", async () => {
    expect(mapComfyUiRuntimeLifecycleStateToReadinessStatus("stopped")).toBe("unavailable");
    expect(mapComfyUiRuntimeLifecycleStateToReadinessStatus("starting")).toBe("starting");
    expect(mapComfyUiRuntimeLifecycleStateToReadinessStatus("ready")).toBe("ready");
    expect(mapComfyUiRuntimeLifecycleStateToReadinessStatus("unhealthy")).toBe("failed");

    const provider = createComfyUiRuntimeCapabilityStatusProvider({ readState: () => "unhealthy", now });
    expect(await provider.getStatus()).toMatchObject({
      capabilityId: "comfyui-runtime",
      status: "failed",
      reason: { category: "health" },
      recommendedActions: ["retry", "view-logs"],
      updatedAt: NOW,
    });
  });

  it("maps runtime installer-style states without treating installed as process ready", async () => {
    expect(mapRuntimeInstallStatusToReadinessStatus("not-installed")).toBe("not-installed");
    expect(mapRuntimeInstallStatusToReadinessStatus("installing")).toBe("installing");
    expect(mapRuntimeInstallStatusToReadinessStatus("checking")).toBe("installing");
    expect(mapRuntimeInstallStatusToReadinessStatus("installed")).toBe("unknown");
    expect(mapRuntimeInstallStatusToReadinessStatus("update-available")).toBe("degraded");
    expect(mapRuntimeInstallStatusToReadinessStatus("failed")).toBe("failed");
    expect(mapRuntimeInstallStatusToReadinessStatus("unknown")).toBe("unknown");

    const provider = createRuntimeInstallerCapabilityStatusProvider({
      capabilityId: "comfyui-runtime",
      readStatus: () => "installed",
      targetId: "comfyui",
      now,
    });
    expect(await provider.getStatus()).toMatchObject({
      capabilityId: "comfyui-runtime",
      status: "unknown",
      available: false,
      details: { installStatus: "installed", targetId: "comfyui" },
      reason: { category: "installation" },
      updatedAt: NOW,
    });
  });

  it("derives feature capability status from runtime dependency status without starting runtimes", async () => {
    const provider = createDerivedRuntimeCapabilityStatusProvider({
      capabilityId: "image-generation",
      dependencies: ["comfyui-runtime"],
      readDependencyStatus: () => createRuntimeCapabilityStatus({
        capabilityId: "comfyui-runtime",
        status: "starting",
        updatedAt: NOW,
      }),
      now,
    });

    expect(await provider.getStatus()).toMatchObject({
      capabilityId: "image-generation",
      status: "starting",
      available: false,
      reason: { category: "dependency" },
      dependencies: [{ capabilityId: "comfyui-runtime", status: "starting" }],
      updatedAt: NOW,
    });
  });

  it("uses snapshot-scoped dependency statuses for derived capabilities without duplicate runtime reads", async () => {
    let pythonReads = 0;
    let comfyUiInstallReads = 0;
    let comfyUiSupervisorReads = 0;

    const pythonProvider: RuntimeCapabilityStatusProvider = {
      capabilityId: "python-runtime",
      getStatus: async () => {
        pythonReads += 1;
        return createRuntimeCapabilityStatus({
          capabilityId: "python-runtime",
          status: "ready",
          summary: `Python runtime snapshot read ${pythonReads}.`,
          details: { readCount: pythonReads },
          updatedAt: `python-read-${pythonReads}`,
        });
      },
    };

    const comfyUiProvider = createCompositeRuntimeCapabilityStatusProvider({
      capabilityId: "comfyui-runtime",
      providers: [
        createRuntimeInstallerCapabilityStatusProvider({
          capabilityId: "comfyui-runtime",
          readStatus: async () => {
            comfyUiInstallReads += 1;
            return "installed";
          },
          targetId: "comfyui",
          now: () => `comfyui-install-read-${comfyUiInstallReads}`,
        }),
        {
          capabilityId: "comfyui-runtime",
          getStatus: async () => {
            comfyUiSupervisorReads += 1;
            return createRuntimeCapabilityStatus({
              capabilityId: "comfyui-runtime",
              status: "ready",
              summary: `ComfyUI supervisor snapshot read ${comfyUiSupervisorReads}.`,
              details: { supervisorReadCount: comfyUiSupervisorReads },
              updatedAt: `comfyui-supervisor-read-${comfyUiSupervisorReads}`,
            });
          },
        },
      ],
      now,
    });

    const unavailableFallback = () => createRuntimeCapabilityStatus({
      capabilityId: "python-runtime",
      status: "failed",
      summary: "Fallback dependency reader should not be used during snapshots.",
      updatedAt: "fallback-read",
    });

    const service = new RuntimeReadinessService({
      providers: [
        pythonProvider,
        comfyUiProvider,
        createDerivedRuntimeCapabilityStatusProvider({
          capabilityId: "image-generation",
          dependencies: ["comfyui-runtime"],
          readDependencyStatus: unavailableFallback,
          now,
        }),
        createDerivedRuntimeCapabilityStatusProvider({
          capabilityId: "dataset-preparation",
          dependencies: ["python-runtime"],
          readDependencyStatus: unavailableFallback,
          now,
        }),
        createDerivedRuntimeCapabilityStatusProvider({
          capabilityId: "model-training",
          dependencies: ["python-runtime"],
          readDependencyStatus: unavailableFallback,
          now,
        }),
      ],
      now,
    });

    const snapshot = await service.getReadinessSnapshot();
    const pythonStatus = snapshot.capabilities.find((capability) => capability.capabilityId === "python-runtime");
    const comfyUiStatus = snapshot.capabilities.find((capability) => capability.capabilityId === "comfyui-runtime");
    const imageGeneration = snapshot.capabilities.find((capability) => capability.capabilityId === "image-generation");
    const datasetPreparation = snapshot.capabilities.find((capability) => capability.capabilityId === "dataset-preparation");
    const modelTraining = snapshot.capabilities.find((capability) => capability.capabilityId === "model-training");

    expect(pythonReads).toBe(1);
    expect(comfyUiInstallReads).toBe(1);
    expect(comfyUiSupervisorReads).toBe(1);
    expect(pythonStatus).toMatchObject({ updatedAt: "python-read-1", details: { readCount: 1 } });
    expect(comfyUiStatus).toMatchObject({
      updatedAt: NOW,
      details: { installStatus: "installed", targetId: "comfyui", supervisorReadCount: 1 },
    });
    expect(imageGeneration?.dependencies).toEqual([
      {
        capabilityId: "comfyui-runtime",
        status: comfyUiStatus?.status,
        healthy: comfyUiStatus?.healthy,
        available: comfyUiStatus?.available,
        summary: comfyUiStatus?.summary,
        reason: comfyUiStatus?.reason,
        updatedAt: comfyUiStatus?.updatedAt,
      },
    ]);
    for (const featureStatus of [datasetPreparation, modelTraining]) {
      expect(featureStatus?.dependencies).toEqual([
        {
          capabilityId: "python-runtime",
          status: pythonStatus?.status,
          healthy: pythonStatus?.healthy,
          available: pythonStatus?.available,
          summary: pythonStatus?.summary,
          reason: pythonStatus?.reason,
          updatedAt: pythonStatus?.updatedAt,
        },
      ]);
    }
  });

  it("memoizes snapshot reads before provider execution for out-of-order derived dependencies", async () => {
    let pythonReads = 0;
    const service = new RuntimeReadinessService({
      providers: [
        createDerivedRuntimeCapabilityStatusProvider({
          capabilityId: "dataset-preparation",
          dependencies: ["python-runtime"],
          readDependencyStatus: () => {
            throw new Error("snapshot context should read python-runtime");
          },
          now,
        }),
        createDerivedRuntimeCapabilityStatusProvider({
          capabilityId: "model-training",
          dependencies: ["python-runtime"],
          readDependencyStatus: () => {
            throw new Error("snapshot context should read python-runtime");
          },
          now,
        }),
        {
          capabilityId: "python-runtime",
          getStatus: () => {
            pythonReads += 1;
            return createRuntimeCapabilityStatus({
              capabilityId: "python-runtime",
              status: "ready",
              summary: `Python runtime explicit-scope read ${pythonReads}.`,
              updatedAt: `python-explicit-read-${pythonReads}`,
            });
          },
        },
      ],
      capabilityIds: ["dataset-preparation", "model-training", "python-runtime"],
      now,
    });

    const snapshot = await service.getReadinessSnapshot();
    const pythonStatus = snapshot.capabilities.find((capability) => capability.capabilityId === "python-runtime");

    expect(pythonReads).toBe(1);
    expect(snapshot.capabilities.map((capability) => capability.capabilityId)).toEqual([
      "dataset-preparation",
      "model-training",
      "python-runtime",
    ]);
    for (const featureStatus of snapshot.capabilities.slice(0, 2)) {
      expect(featureStatus.dependencies).toEqual([{
        capabilityId: "python-runtime",
        status: pythonStatus?.status,
        healthy: pythonStatus?.healthy,
        available: pythonStatus?.available,
        summary: pythonStatus?.summary,
        reason: pythonStatus?.reason,
        updatedAt: pythonStatus?.updatedAt,
      }]);
    }
  });

  it("reads direct capability status requests through the provider each time", async () => {
    let reads = 0;
    const service = new RuntimeReadinessService({
      providers: [{
        capabilityId: "python-runtime",
        getStatus: () => {
          reads += 1;
          return createRuntimeCapabilityStatus({
            capabilityId: "python-runtime",
            status: "ready",
            details: { reads },
            updatedAt: NOW,
          });
        },
      }],
      now,
    });

    await service.getCapabilityStatus("python-runtime");
    const second = await service.getCapabilityStatus("python-runtime");

    expect(reads).toBe(2);
    expect(second.details).toEqual({ reads: 2 });
  });

  it("isolates provider failures when reading an individual capability", async () => {
    const service = new RuntimeReadinessService({
      providers: [{
        capabilityId: "python-runtime",
        async getStatus() {
          throw new Error("boom");
        },
      }],
      now,
    });

    expect(await service.getCapabilityStatus("python-runtime")).toMatchObject({
      capabilityId: "python-runtime",
      status: "failed",
      available: false,
      reason: {
        code: "runtime.readiness.provider-failed",
        message: "Runtime readiness provider failed. See logs for diagnostic details.",
        details: { failureKind: "provider-threw", capabilityId: "python-runtime" },
      },
      recommendedActions: ["retry", "view-logs"],
      updatedAt: NOW,
    });
  });

  it("sanitizes thrown Error provider details from direct status and snapshot payloads", async () => {
    const rawSecret = "C:\\secret\\token path TOKEN=abc /tmp/cache --env SECRET=abc";
    const service = new RuntimeReadinessService({
      providers: [{
        capabilityId: "python-runtime",
        async getStatus() {
          throw new Error(rawSecret);
        },
      }],
      now,
    });

    const status = await service.getCapabilityStatus("python-runtime");
    const snapshot = await service.getReadinessSnapshot();
    const statusPayload = JSON.stringify(status);
    const snapshotPayload = JSON.stringify(snapshot);

    expect(status).toMatchObject({
      capabilityId: "python-runtime",
      status: "failed",
      available: false,
      reason: {
        code: "runtime.readiness.provider-failed",
        message: "Runtime readiness provider failed. See logs for diagnostic details.",
        category: "unknown",
        retryable: true,
        details: { failureKind: "provider-threw", capabilityId: "python-runtime" },
      },
      recommendedActions: ["retry", "view-logs"],
    });
    expect(status.reason?.message).not.toContain(rawSecret);
    expect(status.summary).not.toContain(rawSecret);
    expect(JSON.stringify(status.details)).not.toContain(rawSecret);
    expect(statusPayload).not.toContain(rawSecret);
    expect(statusPayload).not.toContain("TOKEN=abc");
    expect(statusPayload).not.toContain("/tmp/cache");
    expect(snapshotPayload).not.toContain(rawSecret);
    expect(snapshotPayload).not.toContain("TOKEN=abc");
    expect(snapshotPayload).not.toContain("/tmp/cache");
  });

  it("sanitizes non-Error provider throw values", async () => {
    const service = new RuntimeReadinessService({
      providers: [{
        capabilityId: "python-runtime",
        async getStatus() {
          throw { message: "raw /tmp/path TOKEN=abc", env: process.env.PATH };
        },
      }],
      now,
    });

    const status = await service.getCapabilityStatus("python-runtime");

    expect(status).toMatchObject({
      capabilityId: "python-runtime",
      status: "failed",
      reason: {
        code: "runtime.readiness.provider-failed",
        message: "Runtime readiness provider failed. See logs for diagnostic details.",
        details: { failureKind: "provider-threw", capabilityId: "python-runtime" },
      },
      recommendedActions: ["retry", "view-logs"],
    });
    expect(status.reason?.message).not.toContain("raw /tmp/path");
    expect(status.summary).not.toContain("raw /tmp/path");
    expect(JSON.stringify(status.details)).not.toContain("raw /tmp/path");
    expect(JSON.stringify(status)).not.toContain("raw /tmp/path");
    expect(JSON.stringify(status)).not.toContain("TOKEN=abc");
  });

  it("snapshots only composed providers by default", async () => {
    const service = new RuntimeReadinessService({
      providers: [
        createPythonRuntimeCapabilityStatusProvider({ readState: () => "ready", now }),
      ],
      now,
    });

    const snapshot = await service.getReadinessSnapshot();

    expect(snapshot.capabilities.map((capability) => capability.capabilityId)).toEqual(["python-runtime"]);
    expect(snapshot.capabilities.length).toBe(1);
  });

  it("includes explicitly scoped missing capabilities as structured missing-provider statuses", async () => {
    const service = new RuntimeReadinessService({
      providers: [
        createPythonRuntimeCapabilityStatusProvider({ readState: () => "ready", now }),
      ],
      capabilityIds: ["python-runtime", "image-generation"],
      now,
    });

    const snapshot = await service.getReadinessSnapshot();

    expect(snapshot.capabilities.map((capability) => [capability.capabilityId, capability.status])).toEqual([
      ["python-runtime", "ready"],
      ["image-generation", "unknown"],
    ]);
    expect(snapshot.capabilities[1]).toMatchObject({
      capabilityId: "image-generation",
      reason: {
        code: "runtime.readiness.provider-missing",
        retryable: false,
      },
      recommendedActions: ["configure"],
    });
  });

  it("keeps implicit snapshot ordering deterministic by global capability order", async () => {
    const service = new RuntimeReadinessService({
      providers: [
        createDerivedRuntimeCapabilityStatusProvider({
          capabilityId: "model-training",
          dependencies: [],
          readDependencyStatus: () => {
            throw new Error("unused");
          },
          now,
        }),
        createComfyUiRuntimeCapabilityStatusProvider({ readState: () => "ready", now }),
        createPythonRuntimeCapabilityStatusProvider({ readState: () => "ready", now }),
      ],
      now,
    });

    const snapshot = await service.getReadinessSnapshot();

    expect(snapshot.capabilities.map((capability) => capability.capabilityId)).toEqual([
      "python-runtime",
      "comfyui-runtime",
      "model-training",
    ]);
  });

  it("preserves explicit snapshot ordering while normalizing duplicate capability ids", async () => {
    const service = new RuntimeReadinessService({
      providers: createFullProviderSet(),
      capabilityIds: ["model-training", "python-runtime", "model-training", "comfyui-runtime"],
      now,
    });

    const snapshot = await service.getReadinessSnapshot();

    expect(snapshot.capabilities.map((capability) => capability.capabilityId)).toEqual([
      "model-training",
      "python-runtime",
      "comfyui-runtime",
    ]);
  });

  it("allows a host to request every known capability explicitly", async () => {
    const service = new RuntimeReadinessService({
      providers: [
        createPythonRuntimeCapabilityStatusProvider({ readState: () => "ready", now }),
      ],
      capabilityIds: RUNTIME_CAPABILITY_IDS,
      now,
    });

    const snapshot = await service.getReadinessSnapshot();

    expect(snapshot.capabilities.map((capability) => capability.capabilityId)).toEqual(RUNTIME_CAPABILITY_IDS);
    expect(snapshot.capabilities.filter((capability) => capability.status === "unknown").length).toBe(6);
  });

  it("combines ComfyUI installer and supervisor signals into one capability status", async () => {
    const cases: Array<{
      installStatus: RuntimeInstallStatus;
      supervisorState: "stopped" | "starting" | "ready" | "unhealthy";
      expected: RuntimeCapabilityStatus["status"];
    }> = [
      { installStatus: "not-installed", supervisorState: "stopped", expected: "not-installed" },
      { installStatus: "not-installed", supervisorState: "unhealthy", expected: "not-installed" },
      { installStatus: "installing", supervisorState: "stopped", expected: "installing" },
      { installStatus: "checking", supervisorState: "stopped", expected: "installing" },
      { installStatus: "checking", supervisorState: "unhealthy", expected: "installing" },
      { installStatus: "failed", supervisorState: "ready", expected: "failed" },
      { installStatus: "failed", supervisorState: "stopped", expected: "failed" },
      { installStatus: "installed", supervisorState: "ready", expected: "ready" },
      { installStatus: "installed", supervisorState: "starting", expected: "starting" },
      { installStatus: "installed", supervisorState: "stopped", expected: "unavailable" },
      { installStatus: "update-available", supervisorState: "ready", expected: "degraded" },
      { installStatus: "unknown", supervisorState: "ready", expected: "degraded" },
    ];

    for (const testCase of cases) {
      const provider = createCompositeRuntimeCapabilityStatusProvider({
        capabilityId: "comfyui-runtime",
        providers: [
          createRuntimeInstallerCapabilityStatusProvider({
            capabilityId: "comfyui-runtime",
            readStatus: () => testCase.installStatus,
            now,
          }),
          createComfyUiRuntimeCapabilityStatusProvider({ readState: () => testCase.supervisorState, now }),
        ],
        now,
      });

      const status = await provider.getStatus();

      expect(status.status).toBe(testCase.expected);
      expect(status.details).toMatchObject({ installStatus: testCase.installStatus });
    }
  });

  it("preserves generic composite signal details, actions, reasons, and dependencies", async () => {
    const provider = createCompositeRuntimeCapabilityStatusProvider({
      capabilityId: "python-runtime",
      providers: [
        {
          capabilityId: "python-runtime",
          getStatus() {
            return createRuntimeCapabilityStatus({
              capabilityId: "python-runtime",
              status: "ready",
              details: { runtimeVersion: "3.12" },
              updatedAt: NOW,
            });
          },
        },
        {
          capabilityId: "python-runtime",
          getStatus() {
            return createRuntimeCapabilityStatus({
              capabilityId: "python-runtime",
              status: "degraded",
              reason: {
                code: "runtime.python.capability-degraded",
                message: "Python runtime capability read is degraded.",
                category: "health",
                retryable: true,
              },
              recommendedActions: ["configure"],
              details: { capabilityRead: "partial" },
              dependencies: [{
                capabilityId: "dataset-preparation",
                status: "degraded",
                summary: "Dataset preparation can run with limitations.",
              }],
              updatedAt: NOW,
            });
          },
        },
      ],
      now,
    });

    expect(await provider.getStatus()).toMatchObject({
      capabilityId: "python-runtime",
      status: "degraded",
      reason: { code: "runtime.python.capability-degraded" },
      recommendedActions: ["view-logs", "configure"],
      details: { runtimeVersion: "3.12", capabilityRead: "partial" },
      dependencies: [{ capabilityId: "dataset-preparation", status: "degraded" }],
    });
  });

  it("composite providers only read signals and do not perform lifecycle actions", async () => {
    const calls: string[] = [];
    const provider = createCompositeRuntimeCapabilityStatusProvider({
      capabilityId: "python-runtime",
      providers: [
        {
          capabilityId: "python-runtime",
          getStatus() {
            calls.push("read-python-lifecycle");
            return createRuntimeCapabilityStatus({
              capabilityId: "python-runtime",
              status: "ready",
              updatedAt: NOW,
            });
          },
        },
        {
          capabilityId: "python-runtime",
          getStatus() {
            calls.push("read-python-capability");
            return createRuntimeCapabilityStatus({
              capabilityId: "python-runtime",
              status: "ready",
              updatedAt: NOW,
            });
          },
        },
      ],
      now,
    });

    expect(await provider.getStatus()).toMatchObject({
      capabilityId: "python-runtime",
      status: "ready",
    });
    expect(calls).toEqual(["read-python-lifecycle", "read-python-capability"]);
  });

  it("isolates provider failures when reading scoped snapshots", async () => {
    const service = new RuntimeReadinessService({
      providers: [
        {
          capabilityId: "python-runtime",
          async getStatus() {
            throw new Error("boom");
          },
        },
      ],
      capabilityIds: ["python-runtime"],
      now,
    });

    const snapshot = await service.getReadinessSnapshot();

    expect(snapshot.capabilities.length).toBe(1);
    expect(snapshot.capabilities[0]).toMatchObject({
      capabilityId: "python-runtime",
      status: "failed",
      reason: {
        code: "runtime.readiness.provider-failed",
        message: "Runtime readiness provider failed. See logs for diagnostic details.",
      },
    });
  });

  it("aggregates a full readiness snapshot across explicit providers", async () => {
    const service = new RuntimeReadinessService({
      providers: createFullProviderSet(),
      now,
    });

    const snapshot = await service.getReadinessSnapshot();

    expect(snapshot).toMatchObject({
      status: "degraded",
      healthy: false,
      available: true,
      updatedAt: NOW,
    });
    expect(snapshot.capabilities.length).toBe(7);
    expect(snapshot.capabilities.map((capability) => [capability.capabilityId, capability.status])).toEqual([
      ["python-runtime", "ready"],
      ["comfyui-runtime", "ready"],
      ["image-generation", "ready"],
      ["dataset-preparation", "ready"],
      ["model-training", "ready"],
      ["model-validation", "ready"],
      ["model-publishing", "unknown"],
    ]);
  });
});

function createFullProviderSet(): RuntimeCapabilityStatusProvider[] {
  const staticStatuses: Map<RuntimeCapabilityId, RuntimeCapabilityStatus> = new Map([
    ["python-runtime", createRuntimeCapabilityStatus({ capabilityId: "python-runtime", status: "ready", updatedAt: NOW })],
    ["comfyui-runtime", createRuntimeCapabilityStatus({ capabilityId: "comfyui-runtime", status: "ready", updatedAt: NOW })],
  ] as const);

  const readDependencyStatus = async (capabilityId: RuntimeCapabilityId) => {
    const status = staticStatuses.get(capabilityId);
    if (!status) {
      throw new Error(`Missing status for ${capabilityId}.`);
    }
    return status;
  };

  return [
    { capabilityId: "python-runtime", getStatus: () => readDependencyStatus("python-runtime") },
    { capabilityId: "comfyui-runtime", getStatus: () => readDependencyStatus("comfyui-runtime") },
    createDerivedRuntimeCapabilityStatusProvider({ capabilityId: "image-generation", dependencies: ["comfyui-runtime"], readDependencyStatus, now }),
    createDerivedRuntimeCapabilityStatusProvider({ capabilityId: "dataset-preparation", dependencies: ["python-runtime"], readDependencyStatus, now }),
    createDerivedRuntimeCapabilityStatusProvider({ capabilityId: "model-training", dependencies: ["python-runtime"], readDependencyStatus, now }),
    createDerivedRuntimeCapabilityStatusProvider({ capabilityId: "model-validation", dependencies: ["python-runtime"], readDependencyStatus, now }),
    {
      capabilityId: "model-publishing",
      getStatus: () => createRuntimeCapabilityStatus({
        capabilityId: "model-publishing",
        status: "unknown",
        summary: "Model publishing readiness is not composed yet.",
        updatedAt: NOW,
      }),
    },
  ];
}
