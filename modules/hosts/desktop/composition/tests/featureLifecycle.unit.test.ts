import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, testDouble } from "../../../../testing/node-test";
import { DESKTOP_FEATURE_LIFECYCLE_POLICIES } from "../composeDesktopHost";
import { createDesktopFeatureLifecycleRegistry } from "../featureLifecycle";
import type { LoggingPort } from "../../../../application/ports/logging";

function createLoggingPort() {
  return { log: testDouble.fn(async () => undefined) } as unknown as LoggingPort & { log: ReturnType<typeof testDouble.fn> };
}

describe("desktop feature lifecycle registry", () => {
  it("disposes a disposable feature, clears memoization, and recreates on next request", async () => {
    const loggingPort = createLoggingPort();
    const milestones: string[] = [];
    let composeCount = 0;
    let disposeCount = 0;
    const registry = createDesktopFeatureLifecycleRegistry({ loggingPort, recordMilestone: (milestone) => milestones.push(milestone) });
    const getFeature = registry.registerAsyncFeature({
      featureKey: "artifact-remote",
      policy: "disposable",
      milestoneBase: "desktop.host.artifact-remote-features",
      importFeature: async () => async () => ({ instance: ++composeCount, dispose: () => { disposeCount += 1; } }),
    });

    const first = await getFeature();
    const result = await registry.disposeFeature("artifact-remote", "explicit-dev-action");
    const second = await getFeature();

    expect(first.instance).toBe(1);
    expect(second.instance).toBe(2);
    expect(result).toMatchObject({ disposed: true, featureKey: "artifact-remote" });
    expect(disposeCount).toBe(1);
    expect(milestones).toContain("desktop.host.feature.dispose.requested");
    expect(milestones).toContain("desktop.host.feature.dispose.started");
    expect(milestones).toContain("desktop.host.feature.memoized.cleared");
    expect(milestones).toContain("desktop.host.feature.dispose.completed");
  });

  it("makes dispose idempotent for already disposed disposable features", async () => {
    const registry = createDesktopFeatureLifecycleRegistry({ loggingPort: createLoggingPort() });
    let disposeCount = 0;
    registry.registerAsyncFeature({
      featureKey: "website-ingestion",
      policy: "disposable",
      milestoneBase: "desktop.host.ingestion-features",
      importFeature: async () => async () => ({ dispose: () => { disposeCount += 1; } }),
    });

    const first = await registry.disposeFeature("website-ingestion", "explicit-dev-action");
    const second = await registry.disposeFeature("website-ingestion", "explicit-dev-action");

    expect(first.alreadyDisposed).toBe(true);
    expect(second.alreadyDisposed).toBe(true);
    expect(disposeCount).toBe(0);
  });

  it("logs dispose failures, clears memoization, and allows later requests to recreate the feature", async () => {
    const loggingPort = createLoggingPort();
    let composeCount = 0;
    const registry = createDesktopFeatureLifecycleRegistry({ loggingPort });
    const getFeature = registry.registerAsyncFeature({
      featureKey: "artifact-remote",
      policy: "disposable",
      milestoneBase: "desktop.host.artifact-remote-features",
      importFeature: async () => async () => ({ instance: ++composeCount, dispose: () => { throw new Error("boom"); } }),
    });

    await getFeature();
    const result = await registry.disposeFeature("artifact-remote", "explicit-dev-action");
    const recreated = await getFeature();

    expect(result).toMatchObject({ disposed: false, blockedReason: "dispose-failed" });
    expect(recreated.instance).toBe(2);
    expect(loggingPort.log).toHaveBeenCalledOnce();
  });

  it("logs a bounded import failure, clears rejected memoization, and retries", async () => {
    const loggingPort = createLoggingPort();
    let importCount = 0;
    const registry = createDesktopFeatureLifecycleRegistry({ loggingPort });
    const getFeature = registry.registerAsyncFeature({
      featureKey: "model-registry",
      policy: "retained",
      milestoneBase: "desktop.host.model-features",
      importFeature: async () => {
        importCount += 1;
        if (importCount === 1) {
          throw Object.assign(new Error("C:\\private\\feature.js"), {
            code: "MODULE_NOT_FOUND",
          });
        }
        return async () => ({ ready: true });
      },
    });

    await expect(getFeature()).rejects.toThrow();
    await expect(getFeature()).resolves.toEqual({ ready: true });

    expect(importCount).toBe(2);
    expect(loggingPort.log.mock.calls[0]?.[0]).toMatchObject({
      event: "desktop.host.feature.load.failed",
      data: {
        featureKey: "model-registry",
        stage: "import",
        errorName: "Error",
        errorCode: "MODULE_NOT_FOUND",
      },
    });
    expect(JSON.stringify(loggingPort.log.mock.calls[0]?.[0])).not.toContain(
      "private",
    );
  });

  it("does not disclose unsafe error codes from compose failures and permits retry", async () => {
    const loggingPort = createLoggingPort();
    let composeCount = 0;
    const registry = createDesktopFeatureLifecycleRegistry({ loggingPort });
    const getFeature = registry.registerAsyncFeature({
      featureKey: "model-registry",
      policy: "retained",
      milestoneBase: "desktop.host.model-features",
      importFeature: async () => async () => {
        composeCount += 1;
        if (composeCount === 1) {
          throw Object.assign(new Error("sensitive payload"), {
            code: "C:\\private\\module.js",
          });
        }
        return { ready: true };
      },
    });

    await expect(getFeature()).rejects.toThrow();
    await expect(getFeature()).resolves.toEqual({ ready: true });

    const logged = loggingPort.log.mock.calls[0]?.[0];
    expect(logged).toMatchObject({
      event: "desktop.host.feature.load.failed",
      data: {
        featureKey: "model-registry",
        stage: "compose",
        errorName: "Error",
      },
    });
    expect(JSON.stringify(logged)).not.toContain("private");
    expect(JSON.stringify(logged)).not.toContain("sensitive payload");
    expect((logged?.data as Record<string, unknown>).errorCode).toBeUndefined();
  });

  it("does not dispose retained or explicit-unload-only features through generic disposal", async () => {
    const registry = createDesktopFeatureLifecycleRegistry({ loggingPort: createLoggingPort() });
    let retainedDisposed = false;
    let explicitDisposed = false;
    const getRetained = registry.registerAsyncFeature({ featureKey: "artifact-local", policy: "retained", milestoneBase: "desktop.host.artifact-features", importFeature: async () => async () => ({ dispose: () => { retainedDisposed = true; } }) });
    const getExplicit = registry.registerAsyncFeature({ featureKey: "comfyui-image-runtime", policy: "explicit-unload-only", milestoneBase: "desktop.host.comfyui-image-runtime-features", importFeature: async () => async () => ({ dispose: () => { explicitDisposed = true; } }) });

    await getRetained();
    await getExplicit();
    const retained = await registry.disposeFeature("artifact-local", "explicit-dev-action");
    const explicit = await registry.disposeFeature("comfyui-image-runtime", "explicit-dev-action");

    expect(retained.blockedReason).toBe("policy-retained");
    expect(explicit.blockedReason).toBe("policy-explicit-unload-only");
    expect(retainedDisposed).toBe(false);
    expect(explicitDisposed).toBe(false);
  });

  it("blocks unsafe disposable feature disposal while active runtime tasks exist", async () => {
    const milestones: string[] = [];
    const details: Record<string, unknown>[] = [];
    const registry = createDesktopFeatureLifecycleRegistry({
      loggingPort: createLoggingPort(),
      recordMilestone: (milestone, detail) => { milestones.push(milestone); details.push(detail ?? {}); },
    });
    let disposed = false;
    const getFeature = registry.registerAsyncFeature({
      featureKey: "dataset-preparation",
      policy: "disposable",
      milestoneBase: "desktop.host.dataset-preparation-features",
      importFeature: async () => async () => ({
        canDispose: () => ({ blockedReason: "active-runtime-tasks", activeTaskCount: 1 }),
        dispose: () => { disposed = true; },
      }),
    });

    await getFeature();
    const result = await registry.disposeFeature("dataset-preparation", "explicit-dev-action");

    expect(result).toMatchObject({ disposed: false, blockedReason: "active-runtime-tasks", activeTaskCount: 1 });
    expect(disposed).toBe(false);
    expect(milestones).toContain("desktop.host.feature.dispose.requested");
    expect(milestones).toContain("desktop.host.feature.dispose.blocked");
    expect(milestones).toContain("desktop.host.feature.dispose.completed");
    expect(details.some((detail) => detail.blockedReason === "active-runtime-tasks" && detail.activeTaskCount === 1)).toBe(true);
  });


  it("does not dispose always-resident features through idle cleanup", async () => {
    const registry = createDesktopFeatureLifecycleRegistry({ loggingPort: createLoggingPort() });
    let disposed = false;
    const getFeature = registry.registerAsyncFeature({
      featureKey: "diagnostics",
      policy: "always-resident",
      milestoneBase: "desktop.host.diagnostics",
      importFeature: async () => async () => ({ dispose: () => { disposed = true; } }),
    });

    await getFeature();
    expect(registry.markFeatureIdle("diagnostics", "feature-release")).toBe(false);
    const results = await registry.disposeIdleFeatures("explicit-dev-action");

    expect(results).toEqual([]);
    expect(disposed).toBe(false);
    expect(registry.getFeatureLifecycleState().find((entry) => entry.featureKey === "diagnostics")).toMatchObject({
      policy: "always-resident",
      loaded: true,
      idle: false,
      idleTimeoutScheduled: false,
    });
  });

  it("uses one scoped idle timeout per disposable feature and cancels it on reuse", async () => {
    const loggingPort = createLoggingPort();
    const milestones: string[] = [];
    const scheduled: Array<() => void> = [];
    const registry = createDesktopFeatureLifecycleRegistry({
      loggingPort,
      recordMilestone: (milestone) => milestones.push(milestone),
      setTimeoutFn: ((callback: () => void) => { scheduled.push(callback); return scheduled.length as never; }) as unknown as typeof setTimeout,
      clearTimeoutFn: testDouble.fn() as unknown as typeof clearTimeout,
    });
    const getFeature = registry.registerAsyncFeature({
      featureKey: "artifact-remote",
      policy: "disposable",
      milestoneBase: "desktop.host.artifact-remote-features",
      importFeature: async () => async () => ({ dispose: testDouble.fn() }),
    });

    await getFeature();
    expect(registry.markFeatureIdle("artifact-remote", "page-unmount")).toBe(true);
    expect(scheduled.length).toBe(1);
    await getFeature();

    expect(scheduled.length).toBe(1);
    expect(milestones).toContain("desktop.host.feature.idle.marked");
    expect(milestones).toContain("desktop.host.feature.idle.cancelled");
    expect(registry.getFeatureLifecycleState().find((entry) => entry.featureKey === "artifact-remote")).toMatchObject({ idleTimeoutScheduled: false });
  });

  it("keeps Python and ComfyUI process features explicit-unload-only under generic disposal", async () => {
    const registry = createDesktopFeatureLifecycleRegistry({ loggingPort: createLoggingPort() });
    let pythonStopped = false;
    let comfyStopped = false;
    const getPython = registry.registerAsyncFeature({
      featureKey: "python-runtime",
      policy: "explicit-unload-only",
      milestoneBase: "desktop.host.python-runtime",
      importFeature: async () => async () => ({ dispose: () => { pythonStopped = true; } }),
    });
    const getComfy = registry.registerAsyncFeature({
      featureKey: "comfyui-image-runtime",
      policy: "explicit-unload-only",
      milestoneBase: "desktop.host.comfyui-image-runtime-features",
      importFeature: async () => async () => ({ dispose: () => { comfyStopped = true; } }),
    });

    await getPython();
    await getComfy();
    const python = await registry.disposeFeature("python-runtime", "explicit-dev-action");
    const comfy = await registry.disposeFeature("comfyui-image-runtime", "explicit-dev-action");

    expect(python.blockedReason).toBe("policy-explicit-unload-only");
    expect(comfy.blockedReason).toBe("policy-explicit-unload-only");
    expect(pythonStopped).toBe(false);
    expect(comfyStopped).toBe(false);
  });
});

describe("desktop feature lifecycle safety policy map", () => {
  it("keeps active-task features protected by canDispose or explicit-unload-only policy", () => {
    const imageSource = readFileSync(resolve("modules/hosts/desktop/composition/composeDesktopImageGenerationFeature.ts"), "utf8");
    const datasetSource = readFileSync(resolve("modules/hosts/desktop/composition/composeDesktopDatasetPreparationFeature.ts"), "utf8");

    expect(DESKTOP_FEATURE_LIFECYCLE_POLICIES["runtime-task-registry"]).toBe("explicit-unload-only");
    expect(DESKTOP_FEATURE_LIFECYCLE_POLICIES["comfyui-image-runtime"]).toBe("explicit-unload-only");
    expect("python-runtime" in DESKTOP_FEATURE_LIFECYCLE_POLICIES).toBe(false);
    expect(DESKTOP_FEATURE_LIFECYCLE_POLICIES["image-generation"]).toBe("disposable");
    expect(DESKTOP_FEATURE_LIFECYCLE_POLICIES["dataset-preparation"]).toBe("disposable");
    expect(DESKTOP_FEATURE_LIFECYCLE_POLICIES["context-management"]).toBe("disposable");
    expect(DESKTOP_FEATURE_LIFECYCLE_POLICIES["artifact-remote"]).toBe("disposable");
    expect(DESKTOP_FEATURE_LIFECYCLE_POLICIES["website-ingestion"]).toBe("disposable");
    expect(imageSource).toContain("async canDispose()");
    expect(imageSource).toContain("TaskType.IMAGE_GENERATION");
    expect(datasetSource).toContain("async canDispose()");
    expect(datasetSource).toContain("TaskType.DATASET_PREPARATION");
  });
});
