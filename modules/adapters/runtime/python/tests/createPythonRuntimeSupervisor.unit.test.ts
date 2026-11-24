import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";
import { createPythonRuntimeSupervisor } from "../supervisor/createPythonRuntimeSupervisor";
import { OWNED_RUNTIME_READY_PREFIX } from "../supervisor/ownedPythonRuntimeProof";
import path from "node:path";
import {createWindowsOriginalWorkerLaunch, originalWorkerResourceDigest,
  type WindowsOriginalWorkerResourceProfile} from "../supervisor/windowsOriginalWorkerLaunch";

function createMockChildProcess() {
  const emitter = new EventEmitter() as EventEmitter & {
    kill: (signal?: string) => boolean;
    stdout: PassThrough;
    stderr: PassThrough;
  };
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.kill = () => {
    queueMicrotask(() => {
      emitter.emit("exit", 0, "SIGTERM");
    });

    return true;
  };

  return emitter;
}

describe("installed-only Python runtime admission", () => {
  function harness(verify?: () => Promise<boolean>, prepare?: () => Promise<void>, launchPrepare?: () => Promise<void>) {
    const child = createMockChildProcess(); let spawned = 0, installs = 0, launchPreparations = 0;
    const options = {
      command: "python", args: ["main.py"], env: {PRIVATE_SYNTHETIC: "original"},
      verifyRuntimeEnvironment: verify,
      async prepareRuntimeEnvironment() {installs++; await prepare?.();},
      async prepareLaunchEnvironment() {launchPreparations++; await launchPrepare?.();},
      runtimeClient: {async getHealthStatus() {
        if (!spawned) throw new Error("unavailable");
        return {healthy: true, status: {runtimeId: "python-sidecar", status: "ready" as const}};
      }},
      spawnImplementation: (() => {spawned++; return child as any;}) as any,
      startupTimeoutMs: 100, healthCheckIntervalMs: 1,
    };
    return {supervisor: createPythonRuntimeSupervisor(options), options, counts: () => ({spawned, installs, launchPreparations})};
  }

  it("requires an explicit successful verifier before attach/spawn and never runs the installer", async () => {
    for (const verify of [undefined, async () => false, async () => {throw new Error("private/path token=secret");}]) {
      const h = harness(verify);
      await expect(h.supervisor.startWithoutInstalling!()).rejects.toThrow("verification is unavailable");
      expect(h.counts()).toEqual({spawned: 0, installs: 0, launchPreparations: 0});
    }
    let probes = 0;
    const h = harness(async () => {probes++; return true;});
    h.options.verifyRuntimeEnvironment = async () => false;
    await h.supervisor.startWithoutInstalling!();
    await h.supervisor.startWithoutInstalling!();
    expect(h.counts()).toEqual({spawned: 1, installs: 0, launchPreparations: 1});
    expect(probes).toBe(2); expect(h.supervisor.getStatus()).toBe("ready");
    await h.supervisor.stop();
  });

  it("coalesces the same policy and refuses both directions of mixed startup authority", async () => {
    let release!: () => void, probes = 0;
    const gate = new Promise<void>(resolve => {release = resolve;});
    const h = harness(async () => {probes++; await gate; return true;});
    const one = h.supervisor.startWithoutInstalling!(), two = h.supervisor.startWithoutInstalling!();
    await expect(h.supervisor.start()).rejects.toThrow("authority differs");
    release(); await Promise.all([one, two]);
    expect(probes).toBe(1); expect(h.counts().installs).toBe(0);
    await h.supervisor.stop();

    let releaseInstall!: () => void, entered!: () => void;
    const installing = new Promise<void>(resolve => {entered = resolve;});
    const ordinary = harness(async () => true, async () => {
      entered(); await new Promise<void>(resolve => {releaseInstall = resolve;});
    });
    const start = ordinary.supervisor.start(); await installing;
    await expect(ordinary.supervisor.startWithoutInstalling!()).rejects.toThrow("authority differs");
    releaseInstall(); await start;
    expect(ordinary.counts().installs).toBe(1); await ordinary.supervisor.stop();
  });

  it("preserves stop-generation fences while an installed-only probe is pending", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    const h = harness(async () => {await gate; return true;});
    const start = h.supervisor.startWithoutInstalling!();
    await h.supervisor.stop(); release();
    await expect(start).rejects.toThrow("startup was stopped");
    expect(h.counts()).toEqual({spawned: 0, installs: 0, launchPreparations: 0});
    expect(h.supervisor.getStatus()).toBe("stopped");
    await h.supervisor.startWithoutInstalling!();
    expect(h.counts().spawned).toBe(1); await h.supervisor.stop();
  });

  for (const boundary of ["verification", "launch preparation"] as const) it(`rechecks originating permission after ${boundary} with currentness still true`, async () => {
    let permitted = true, checks = 0;
    const admission = {assertCurrent() {}, async assertAllowed() {checks++; if (!permitted) throw Error("synthetic withdrawal");}};
    const h = harness(async () => {if (boundary === "verification") permitted = false; return true;}, undefined,
      async () => {if (boundary === "launch preparation") permitted = false;});
    await assert.rejects(h.supervisor.startWithoutInstalling!(admission));
    assert.equal(h.counts().spawned, 0); assert.equal(h.counts().installs, 0); assert.ok(checks >= 2);
    permitted = true; await assert.rejects(h.supervisor.startWithoutInstalling!(admission));
    assert.equal(h.counts().spawned, 0); // Observed loss stays attached to this original grant.
  });

  it("coalesces only the same original admission and captures its methods before waits", async () => {
    let release!: () => void, entered!: () => void, originalCalls = 0, replacements = 0;
    const gate = new Promise<void>(resolve => {release = resolve;}), observed = new Promise<void>(resolve => {entered = resolve;});
    const h = harness(async () => {entered(); await gate; return true;});
    const admission = {assertCurrent() {assert.equal(this, admission); originalCalls++;},
      async assertAllowed() {assert.equal(this, admission); originalCalls++;}};
    const one = h.supervisor.startWithoutInstalling!(admission); await observed;
    admission.assertCurrent = () => {replacements++; throw Error("replacement");};
    admission.assertAllowed = async () => {replacements++; throw Error("replacement");};
    const same = h.supervisor.startWithoutInstalling!(admission);
    await assert.rejects(h.supervisor.startWithoutInstalling!(), /authority differs/);
    await assert.rejects(h.supervisor.startWithoutInstalling!({assertCurrent() {}, async assertAllowed() {}}), /authority differs/);
    release(); await Promise.all([one, same]); assert.equal(h.counts().spawned, 1);
    assert.ok(originalCalls > 2); assert.equal(replacements, 0); await h.supervisor.stop();
  });

  it("publishes the startup flight before an admission callback can request an unguarded launch", async () => {
    const h = harness(async () => true); let foreign: Promise<void> | undefined;
    const admission = {assertCurrent() {}, async assertAllowed() {
      foreign ??= assert.rejects(h.supervisor.startWithoutInstalling!(), /authority differs/);
    }};
    await h.supervisor.startWithoutInstalling!(admission); await foreign;
    assert.equal(h.counts().spawned, 1); await h.supervisor.stop();
  });

  it("does not run active admission getters or accept asynchronous currentness", async () => {
    let getters = 0;
    const active = {get assertCurrent() {getters++; return () => {};}, async assertAllowed() {}};
    const h = harness(async () => true);
    await assert.rejects(h.supervisor.startWithoutInstalling!(active)); assert.equal(getters, 0);
    await assert.rejects(h.supervisor.startWithoutInstalling!({assertCurrent: (async () => {throw Error("private rejection");}) as never,
      async assertAllowed() {}}));
    await new Promise(resolve => setImmediate(resolve)); assert.equal(h.counts().spawned, 0);
  });
});

describe("createPythonRuntimeSupervisor", () => {
  it("retains failed startup diagnostics after asynchronous error and confirmed close", async () => {
    const child = createMockChildProcess();
    const supervisor = createPythonRuntimeSupervisor({
      command: "python",
      runtimeClient: {
        getHealthStatus: async () => {
          throw new Error("not ready");
        },
      },
      spawnImplementation: (() => {
        queueMicrotask(() => {
          child.emit("error", new Error("synthetic spawn failure"));
          child.emit("close", -1, null);
        });
        return child as any;
      }) as any,
      startupTimeoutMs: 50,
      healthCheckIntervalMs: 1,
    });
    await expect(supervisor.start()).rejects.toThrow(
      "exited before health check completed",
    );
    expect(supervisor.getStatus()).toBe("failed");
    await supervisor.stop();
    expect(supervisor.getStatus()).toBe("stopped");
  });

  it("starts and transitions to ready after health probing", async () => {
    const child = createMockChildProcess();
    const spawnImplementation = testDouble.fn(() => child as any);
    let healthAttempt = 0;
    const getHealthStatus = testDouble.fn(async () => {
      healthAttempt += 1;
      if (healthAttempt === 1) {
        throw new Error("runtime unavailable");
      }

      return {
        healthy: true,
        status: {
          runtimeId: "python-sidecar",
          status: "ready" as const,
        },
      };
    });

    const supervisor = createPythonRuntimeSupervisor({
      command: "python",
      args: ["main.py"],
      runtimeClient: { getHealthStatus },
      spawnImplementation: spawnImplementation as any,
      startupTimeoutMs: 100,
      healthCheckIntervalMs: 1,
    });

    await supervisor.start();

    expect(supervisor.getStatus()).toBe("ready");
    expect(spawnImplementation).toHaveBeenCalledOnce();
    expect(getHealthStatus).toHaveBeenCalled();
  });

  it("attaches to an already healthy runtime instead of spawning a duplicate process", async () => {
    const spawnImplementation = testDouble.fn(
      () => createMockChildProcess() as any,
    );
    const onEvent = testDouble.fn();
    const supervisor = createPythonRuntimeSupervisor({
      command: "python",
      args: ["main.py"],
      runtimeClient: {
        getHealthStatus: async () => ({
          healthy: true,
          status: { runtimeId: "python-sidecar", status: "ready" as const },
        }),
      },
      spawnImplementation: spawnImplementation as any,
      startupTimeoutMs: 100,
      healthCheckIntervalMs: 1,
      onEvent,
    });

    await supervisor.start();

    expect(supervisor.getStatus()).toBe("ready");
    expect(spawnImplementation).not.toHaveBeenCalled();
    expect(
      onEvent.mock.calls
        .map((call) => call[0])
        .some((event) => event.type === "attached"),
    ).toBe(true);
  });

  it("fails clearly before spawning when a healthy runtime is missing required capabilities", async () => {
    const spawnImplementation = testDouble.fn(
      () => createMockChildProcess() as any,
    );
    const onEvent = testDouble.fn();
    const supervisor = createPythonRuntimeSupervisor({
      command: "python",
      args: ["main.py"],
      runtimeClient: {
        getHealthStatus: async () => ({
          healthy: true,
          status: { runtimeId: "python-sidecar", status: "ready" as const },
        }),
        getCapabilities: async () => {
          return {
            runtimeId: "python-sidecar",
            capabilities: ["prepare-training-dataset"],
          };
        },
      },
      requiredCapabilities: [
        "prepare-training-dataset",
        "dataset-preparation.auto-inference-mode",
      ],
      spawnImplementation: spawnImplementation as any,
      startupTimeoutMs: 100,
      healthCheckIntervalMs: 1,
      onEvent,
    });

    await expect(supervisor.start()).rejects.toThrow(
      "missing required capability/capabilities",
    );

    expect(supervisor.getStatus()).toBe("failed");
    expect(spawnImplementation).not.toHaveBeenCalled();
    const eventTypes = onEvent.mock.calls.map((call) => call[0].type);
    expect(eventTypes).toContain("capability-mismatch");
    expect(eventTypes).not.toContain("attached");
  });

  it("stops the process and marks status stopped", async () => {
    const child = createMockChildProcess();
    let spawned = false;
    const supervisor = createPythonRuntimeSupervisor({
      command: "python",
      args: ["main.py"],
      runtimeClient: {
        getHealthStatus: async () => {
          if (!spawned) throw new Error("not started");
          return {
            healthy: true,
            status: { runtimeId: "python-sidecar", status: "ready" },
          };
        },
      },
      spawnImplementation: (() => {
        spawned = true;
        return child as any;
      }) as any,
      startupTimeoutMs: 100,
      healthCheckIntervalMs: 1,
    });

    await supervisor.start();
    await supervisor.stop();

    expect(supervisor.getStatus()).toBe("stopped");
  });

  it("fails fast with runtime output when process exits during startup", async () => {
    const child = createMockChildProcess();
    const getHealthStatus = testDouble.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      throw new Error("runtime unavailable");
    });
    const supervisor = createPythonRuntimeSupervisor({
      command: "python",
      args: ["main.py"],
      runtimeClient: { getHealthStatus },
      spawnImplementation: (() => {
        queueMicrotask(() => {
          child.stderr.write(
            "ImportError: attempted relative import with no known parent package",
          );
          child.emit("exit", 1, null);
        });
        return child as any;
      }) as any,
      startupTimeoutMs: 100,
      healthCheckIntervalMs: 1,
    });

    await expect(supervisor.start()).rejects.toThrow(
      /Python runtime exited before health check completed\./,
    );
  });

  it("emits one health-probe-failed event for repeated identical probe failures", async () => {
    const child = createMockChildProcess();
    let probeAttempt = 0;
    const getHealthStatus = testDouble.fn(async () => {
      probeAttempt += 1;
      if (probeAttempt < 4) {
        throw new Error("fetch failed");
      }

      return {
        healthy: true,
        status: {
          runtimeId: "python-sidecar",
          status: "ready" as const,
        },
      };
    });
    const onEvent = testDouble.fn();

    const supervisor = createPythonRuntimeSupervisor({
      command: "python",
      args: ["main.py"],
      runtimeClient: { getHealthStatus },
      spawnImplementation: (() => child as any) as any,
      startupTimeoutMs: 200,
      healthCheckIntervalMs: 1,
      onEvent,
    });

    await supervisor.start();

    const healthProbeFailedEvents = onEvent.mock.calls
      .map((call) => call[0])
      .filter((event) => event.type === "health-probe-failed");
    expect(healthProbeFailedEvents.length).toBe(1);
    expect(healthProbeFailedEvents[0]).toMatchObject({
      detail: "Python runtime health probe failed (Error).",
    });
    const healthReadyEvent = onEvent.mock.calls
      .map((call) => call[0])
      .find((event) => event.type === "health-ready");
    expect(healthReadyEvent).toMatchObject({
      detail:
        "Python runtime reported healthy startup state after 2 failed health probe attempt(s).",
    });
  });

  it("fails startup with failed status when spawning the runtime throws synchronously", async () => {
    const onEvent = testDouble.fn();
    const supervisor = createPythonRuntimeSupervisor({
      command: "python",
      args: ["main.py"],
      runtimeClient: {
        getHealthStatus: async () => {
          throw new Error("runtime unavailable");
        },
      },
      spawnImplementation: (() => {
        throw new Error("spawn EPERM");
      }) as any,
      startupTimeoutMs: 50,
      healthCheckIntervalMs: 1,
      onEvent,
    });

    await expect(supervisor.start()).rejects.toThrow(
      "Python runtime failed during startup.",
    );
    expect(supervisor.getStatus()).toBe("failed");
    const processErrorEvent = onEvent.mock.calls
      .map((call) => call[0])
      .find((event) => event.type === "process-error");
    expect(processErrorEvent).toBeDefined();
    expect(processErrorEvent).toMatchObject({
      type: "process-error",
      detail: "Python runtime process failed to start.",
    });
  });

  it("runs runtime-environment preparation before spawning", async () => {
    const child = createMockChildProcess();
    const prepareRuntimeEnvironment = testDouble.fn(async () => undefined);
    const spawnImplementation = testDouble.fn(() => child as any);
    let healthAttempt = 0;
    const supervisor = createPythonRuntimeSupervisor({
      command: "python",
      args: ["main.py"],
      runtimeClient: {
        getHealthStatus: async () => {
          healthAttempt += 1;
          if (healthAttempt === 1) {
            throw new Error("runtime unavailable");
          }
          return {
            healthy: true,
            status: { runtimeId: "python-sidecar", status: "ready" },
          };
        },
      },
      prepareRuntimeEnvironment,
      spawnImplementation: spawnImplementation as any,
      startupTimeoutMs: 100,
      healthCheckIntervalMs: 1,
    });

    await supervisor.start();

    expect(prepareRuntimeEnvironment).toHaveBeenCalledOnce();
    expect(spawnImplementation).toHaveBeenCalledOnce();
  });

  it("fails startup when runtime-environment preparation fails", async () => {
    const prepareRuntimeEnvironment = testDouble.fn(async () => {
      throw new Error("missing fastapi");
    });
    const spawnImplementation = testDouble.fn(
      () => createMockChildProcess() as any,
    );
    const supervisor = createPythonRuntimeSupervisor({
      command: "python",
      args: ["main.py"],
      runtimeClient: {
        getHealthStatus: async () => {
          throw new Error("runtime unavailable");
        },
      },
      prepareRuntimeEnvironment,
      spawnImplementation: spawnImplementation as any,
      startupTimeoutMs: 100,
      healthCheckIntervalMs: 1,
    });

    await expect(supervisor.start()).rejects.toThrow(
      "Python runtime environment preparation failed.",
    );
    expect(supervisor.getStatus()).toBe("failed");
    expect(spawnImplementation).not.toHaveBeenCalled();
  });

  it("bounds and sanitizes subprocess output and tolerates a failing diagnostics sink", async () => {
    const child = createMockChildProcess();
    const events: unknown[] = [];
    let sinkCalls = 0;
    let healthCalls = 0;
    const supervisor = createPythonRuntimeSupervisor({
      command: "C:/private/python.exe",
      args: ["C:/private/worker.py", "--token=secret"],
      cwd: "C:/private/runtime",
      runtimeClient: {
        getHealthStatus: async () => {
          healthCalls += 1;
          if (healthCalls === 1) throw new Error("runtime unavailable");
          return {
            healthy: true,
            status: { runtimeId: "python-sidecar", status: "ready" },
          };
        },
      },
      spawnImplementation: (() => child as any) as any,
      startupTimeoutMs: 100,
      healthCheckIntervalMs: 1,
      onEvent: (event) => {
        sinkCalls += 1;
        events.push(event);
        if (sinkCalls === 2) throw new Error("diagnostic sink failed");
      },
    });

    await supervisor.start();
    child.stderr.write(`token=secret C:/private/runtime ${"x".repeat(20_000)}`);
    child.stdout.write(
      JSON.stringify({
        event: "runtime.task.failed",
        diagnosticClass: "RuntimeError",
        stage: "generation",
        errorCode: "structured_output_settings_invalid",
        requestId: "private-task-id",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("C:/private");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("private-task-id");
    expect(serialized).toContain("stderr:unstructured-output");
    expect(serialized).toContain(
      "stdout:runtime.task.failed:RuntimeError:stage=generation:code=structured_output_settings_invalid",
    );
    expect(supervisor.getStatus()).toBe("ready");
  });
});
import assert from "node:assert/strict";
import { createPythonRuntimeStartupDiagnostics } from "../pythonRuntimeStartupDiagnostics";

it("binds coalesced and retried starts to actual tokens and preserves preparation failure", async () => {
  const diagnostics = createPythonRuntimeStartupDiagnostics();
  const events: any[] = []; let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  let prepared = 0, spawned = 0;
  const supervisor = createPythonRuntimeSupervisor({ command: "synthetic", runtimeClient: { getHealthStatus: async () => { throw new Error("not ready"); } },
    onStartupEvent: event => { events.push(event); diagnostics.event(event); },
    prepareRuntimeEnvironment: async context => { prepared++; await gate; diagnostics.preparationFailed(context.startupToken!, "context", "unsupported-python"); throw new Error("private setup"); },
    spawnImplementation: (() => { spawned++; throw new Error("unexpected spawn"); }) as any,
  });
  const first = supervisor.start(), joined = supervisor.start(); release();
  await Promise.allSettled([first, joined]);
  assert.equal(events.filter(e => e.type === "begin").length, 1); assert.equal(prepared, 1); assert.equal(spawned, 0);
  assert.equal(diagnostics.read().reason, "unsupported-python");
  const old = events[0].token; await supervisor.stop(); await assert.rejects(supervisor.start());
  assert.equal(diagnostics.read().attempt, 2);
  diagnostics.environment(old, { pythonVersion: "3.99.0" }); assert.equal(diagnostics.read().pythonVersion, undefined);
});
it("captures controls, capabilities and bound client methods before a mutating diagnostic getter", async () => {
  const args = ["main.py"], capabilities = ["required"], env = { SAFE: "original" };
  let healthCalls = 0, prepared = 0, launched = 0, spawned = 0, getters = 0;
  const client = { marker: "bound", async getHealthStatus() { assert.equal(this.marker, "bound"); healthCalls++; if (healthCalls === 1) throw new Error("not started"); return { healthy: true, status: { runtimeId: "fixture", status: "ready" as const } }; }, async getCapabilities() { assert.equal(this.marker, "bound"); return { runtimeId: "fixture", capabilities: [] as string[] }; } };
  const options: any = { command: "original", args, cwd: "original-cwd", env, requiredCapabilities: capabilities, runtimeClient: client,
    prepareRuntimeEnvironment(context: any) { prepared++; assert.equal(context.command, "original"); assert.equal(context.cwd, "original-cwd"); assert.deepEqual(context.args, ["main.py"]); assert.equal(context.env.SAFE, "original"); },
    prepareLaunchEnvironment(context: any) { launched++; context.env.ROTATED = "owned"; },
    spawnImplementation: ((_command: string, _args: readonly string[], context: any) => { spawned++; assert.equal(_command, "original"); assert.deepEqual(_args, ["main.py"]); assert.equal(context.cwd, "original-cwd"); assert.equal(context.env.SAFE, "original"); assert.equal(context.env.ROTATED, "owned"); return createMockChildProcess() as any; }) as any,
    startupTimeoutMs: 5, healthCheckIntervalMs: 1 };
  Object.defineProperty(options, "onStartupEvent", { get() { getters++; options.command = "mutated"; options.cwd = "mutated"; args.push("mutated"); capabilities.length = 0; env.SAFE = "mutated"; options.prepareRuntimeEnvironment = undefined; options.prepareLaunchEnvironment = undefined; client.getCapabilities = async () => ({ runtimeId: "fixture", capabilities: ["required"] }); return () => {}; } });
  const supervisor = createPythonRuntimeSupervisor(options);
  await assert.rejects(supervisor.start(), /missing required capability/);
  assert.equal(getters, 1); assert.equal(prepared, 1); assert.equal(launched, 1); assert.equal(spawned, 1);
  await supervisor.stop();
});
it("retires an in-flight startup report and reports a vanished attached worker without a new launch", async () => {
  const d = createPythonRuntimeStartupDiagnostics(); let release!: () => void; const gate = new Promise<void>(r => { release = r; });
  const pending = createPythonRuntimeSupervisor({ command: "fixture", runtimeClient: { getHealthStatus: async () => { throw new Error("not ready"); } }, onStartupEvent: d.event, prepareRuntimeEnvironment: () => gate, spawnImplementation: (() => { throw new Error("must not spawn"); }) as any });
  const start = pending.start(); await new Promise(resolve => setTimeout(resolve, 0)); await pending.stop();
  assert.equal(d.read().outcome, "retired"); release(); await assert.rejects(start); assert.equal(d.read().outcome, "retired");
  const attached = createPythonRuntimeStartupDiagnostics(); let available = true;
  const supervisor = createPythonRuntimeSupervisor({ command: "fixture", onStartupEvent: attached.event, runtimeClient: { getHealthStatus: async () => { if (!available) throw new Error("gone"); return { healthy: true, status: { runtimeId: "fixture", status: "ready" } }; } }, spawnImplementation: (() => { throw new Error("must not spawn"); }) as any });
  await supervisor.start(); await supervisor.start(); assert.equal(attached.read().attempt, 1);
  available = false; await assert.rejects(supervisor.start(), /Externally attached/);
  assert.equal(attached.read().attempt, 1); assert.equal(attached.read().outcome, "failed"); assert.equal(attached.read().reason, "health-failed");
});

function originalRetirementHarness() {
  const children: ReturnType<typeof createMockChildProcess>[] = []; let kills = 0;
  const supervisor = createPythonRuntimeSupervisor({command: "inert-python", requireOwnedStartupProof: true,
    env: {PYTHON_RUNTIME_HOST: "127.0.0.1", PYTHON_RUNTIME_PORT: "43111"},
    verifyRuntimeEnvironment: async () => true, startupTimeoutMs: 200, healthCheckIntervalMs: 1,
    runtimeClient: {async getHealthStatus() {return {healthy: true, status: {runtimeId: "inert-runtime", status: "ready" as const}};}},
    spawnImplementation: ((_command: unknown, _args: unknown, options: any) => {
      const child = createMockChildProcess(); children.push(child);
      child.kill = function () {assert.equal(this, child); kills++; queueMicrotask(() => child.emit("exit", 0, "SIGTERM")); return true;};
      queueMicrotask(() => child.stdout.write(OWNED_RUNTIME_READY_PREFIX + options.env.PYTHON_RUNTIME_STARTUP_PROOF + " 127.0.0.1:43111\n"));
      return child;
    }) as never});
  const close = (child = children[children.length - 1]!) => {
    child.stdout.destroy(); child.stderr.destroy(); child.emit("close", 0, null);
  };
  return {supervisor, children, close, get kills() {return kills;}};
}

it("captures only an owned bound-ready child, never attached HTTP readiness", async () => {
  const h = originalRetirementHarness(); assert.throws(() => h.supervisor.captureOriginalWorkerRetirement!());
  const attached = createPythonRuntimeSupervisor({command: "inert", runtimeClient: {async getHealthStatus() {
    return {healthy: true, status: {runtimeId: "external", status: "ready" as const}};
  }}, spawnImplementation: (() => {throw Error("must not spawn");}) as never});
  await attached.start(); assert.throws(() => attached.captureOriginalWorkerRetirement!());
  await h.supervisor.startWithoutInstalling!(); const owner = h.supervisor.captureOriginalWorkerRetirement!();
  owner.assertCurrent(); owner.releaseUnused(); h.close();
});

it("waits for original close after exit, shares Stop and never terminates a replacement", async () => {
  const h = originalRetirementHarness(); await h.supervisor.startWithoutInstalling!();
  const child = h.children[0]!, owner = h.supervisor.captureOriginalWorkerRetirement!();
  child.kill = () => {throw Error("replacement method must not be used");};
  const retirement = owner.retireOriginal(), joined = owner.retireOriginal(), stop = h.supervisor.stop();
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(h.kills, 1);
  assert.throws(() => owner.assertCurrent());
  await assert.rejects(h.supervisor.startWithoutInstalling!(), /stopping|closure/);
  let settled = false; void retirement.then(() => {settled = true;});
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(settled, false);
  h.close(child); assert.equal(await retirement, true); assert.equal(await joined, true); await stop;
  await h.supervisor.startWithoutInstalling!(); assert.equal(h.children.length, 2);
  assert.equal(await owner.retireOriginal(), true); assert.equal(h.kills, 1); assert.equal(h.supervisor.getStatus(), "ready");
  h.close(h.children[1]);
});

it("retains a strong claim after natural exit and accepts late close without a kill", async () => {
  const h = originalRetirementHarness(); await h.supervisor.startWithoutInstalling!();
  const child = h.children[0]!, owner = h.supervisor.captureOriginalWorkerRetirement!();
  child.emit("exit", 0, null); assert.equal(h.supervisor.getStatus(), "stopped");
  await assert.rejects(h.supervisor.startWithoutInstalling!(), /closure/);
  assert.equal(await owner.retireOriginal(), false); assert.equal(h.kills, 0);
  h.close(child); assert.equal(await owner.retireOriginal(), true); assert.equal(h.kills, 0);
});

for (const failure of ["false", "throw"] as const) it(`does not repeat an unknown original kill (${failure})`, async () => {
  const h = originalRetirementHarness(); await h.supervisor.startWithoutInstalling!();
  const child = h.children[0]!; let attempts = 0;
  child.kill = function () {assert.equal(this, child); attempts++; if (failure === "throw") throw Error("private failure"); return false;};
  const owner = h.supervisor.captureOriginalWorkerRetirement!();
  assert.equal(await owner.retireOriginal(), false); assert.equal(attempts, 1);
  const observation = owner.retireOriginal(), stop = h.supervisor.stop();
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(attempts, 1);
  h.close(child); assert.equal(await observation, true); await stop; assert.equal(attempts, 1);
});

it("disarms an unused claim and cannot revive it when the same child is reused", async () => {
  const h = originalRetirementHarness(); await h.supervisor.startWithoutInstalling!();
  const original = h.supervisor.captureOriginalWorkerRetirement!(); original.releaseUnused();
  assert.throws(() => original.assertCurrent()); assert.throws(() => original.releaseUnused());
  assert.equal(await original.retireOriginal(), false); assert.equal(h.kills, 0);
  const next = h.supervisor.captureOriginalWorkerRetirement!(); assert.notEqual(next, original); next.assertCurrent();
  assert.equal(await original.retireOriginal(), false); assert.equal(h.kills, 0);
  next.releaseUnused(); const stopping = h.supervisor.stop(); await stopping; // ordinary exit-only compatibility
  assert.equal(h.kills, 1); h.close(h.children[0]);
});

it("a timed-out close observation retains its original one-attempt claim", async context => {
  const h = originalRetirementHarness(); await h.supervisor.startWithoutInstalling!();
  const child = h.children[0]!, owner = h.supervisor.captureOriginalWorkerRetirement!();
  context.mock.timers.enable({apis: ["setTimeout"]});
  try {
    const first = owner.retireOriginal(); await Promise.resolve(); await Promise.resolve();
    context.mock.timers.tick(5_000); assert.equal(await first, false); assert.equal(h.kills, 1);
    await assert.rejects(h.supervisor.startWithoutInstalling!(), /closure/);
    const late = owner.retireOriginal(); await Promise.resolve(); h.close(child);
    assert.equal(await late, true); assert.equal(h.kills, 1);
  } finally {context.mock.timers.reset(); h.close(child);}
});

const inertResourceProfile: WindowsOriginalWorkerResourceProfile = {schema: "windows-original-worker-job-v1", profileId: "inert-no-native",
  processMemoryBytes: 64 * 1024 * 1024, jobMemoryBytes: 128 * 1024 * 1024,
  maximumActiveProcesses: 1, maximumDurationMs: 30_000, observationMs: 30};
function nativeWireHarness() {
  const child = new EventEmitter() as EventEmitter & {stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => boolean};
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => {throw Error("controller kill cannot prove worker retirement");};
  let boot: any, starts = 0, resumes = 0, stops = 0, hostLive = true;
  let resumeReply = true, stopReply = true, stopCloses = true, exitFirst = false;
  const frame = (kind: string, fields: Record<string, unknown> = {}) => {
    child.stdout.write(JSON.stringify({schema: "windows-original-worker-control-v1", nonce: boot.nonce,
      profileDigest: boot.profileDigest, kind, ...fields}) + "\n");
  };
  const close = () => {child.stdout.end(); child.stderr.end(); child.emit("close", 0, null);};
  child.stdin.on("data", data => {
    const value = JSON.parse(data.toString());
    if (value.schema === "windows-original-worker-launch-v1") {boot = value; queueMicrotask(() => frame("suspended")); return;}
    assert.equal(value.nonce, boot.nonce); assert.equal(value.profileDigest, boot.profileDigest);
    if (value.action === "resume") {resumes++; if (resumeReply) queueMicrotask(() => frame("running"));}
    else {assert.equal(value.action, "stop"); stops++; queueMicrotask(() => {
      if (exitFirst) child.emit("exit", 0, null);
      if (stopReply) frame("retired");
      if (stopCloses) close();
    });}
  });
  const configuration = {command: process.execPath, cwd: path.resolve(__dirname, "../worker"),
    nativePlatform: (): {platform: NodeJS.Platform; arch: string} => ({platform: "win32", arch: "x64"}),
    environment: {PYTHON_RUNTIME_HOST: "127.0.0.1", PYTHON_RUNTIME_PORT: "43111", PYTHON_RUNTIME_STARTUP_PROOF: "a".repeat(64), PYTHON_RUNTIME_AUTH_TOKEN: "inert-".padEnd(40, "x")},
    profile: inertResourceProfile, assertHostCurrent() {if (!hostLive) throw Error("host ended");},
    spawnImplementation: ((_command: string, args: string[], options: any) => {
      starts++; assert.equal(_command, process.execPath); assert.deepEqual(args.slice(0, 4), ["-I", "-S", "-B", "-u"]);
      assert.equal(args.length, 5); assert.equal(path.basename(args[4]!), "windows_original_worker_launch.py"); assert.equal(options.windowsHide, true);
      return child;
    }) as never};
  const packet = (...rows: {kind: string; lane?: string; data?: string}[]) => child.stdout.write(rows.map(row => JSON.stringify({
    schema: "windows-original-worker-control-v1", nonce: boot.nonce, profileDigest: boot.profileDigest, ...row})).join("\n") + "\n");
  return {configuration, child, frame, packet, close, create: () => createWindowsOriginalWorkerLaunch(configuration),
    get starts() {return starts;}, get resumes() {return resumes;}, get stops() {return stops;},
    set resumeReply(value: boolean) {resumeReply = value;}, set stopReply(value: boolean) {stopReply = value;},
    set stopCloses(value: boolean) {stopCloses = value;}, set exitFirst(value: boolean) {exitFirst = value;}, endHost() {hostLive = false;}};
}

it("original controller requires native worker proof and controller close, not controller kill", async () => {
  const h = nativeWireHarness(), owner = h.create();
  assert.equal(h.starts, 0); await owner.prepare(); owner.assertCurrent(); await owner.resume();
  assert.equal(h.starts, 1); assert.equal(h.resumes, 1);
  assert.equal(await owner.retireOriginal(), true); assert.equal(await owner.retireOriginal(), true);
  assert.equal(h.stops, 1); assert.throws(() => owner.assertCurrent());
});

it("original controller keeps native retirement pending until its own stdio closes", async () => {
  const h = nativeWireHarness(); h.stopCloses = false; const owner = h.create();
  await owner.prepare(); await owner.resume(); assert.equal(await owner.retireOriginal(), false);
  h.close(); assert.equal(await owner.retireOriginal(), true); assert.equal(h.stops, 1);
});

it("original controller exit before final pipe data does not erase original native retirement", async () => {
  const h = nativeWireHarness(); h.exitFirst = true; const owner = h.create();
  await owner.prepare(); await owner.resume(); assert.equal(await owner.retireOriginal(), true); assert.equal(h.stops, 1);
});

it("original controller close without original Job proof cannot release ownership", async () => {
  const h = nativeWireHarness(); h.stopReply = false; const owner = h.create();
  await owner.prepare(); await owner.resume(); assert.equal(await owner.retireOriginal(), false);
  assert.equal(await owner.retireOriginal(), false); assert.equal(h.stops, 1);
});

it("original controller late resume reply cannot renew admission but can finish one original stop", async () => {
  const h = nativeWireHarness(); h.resumeReply = false; const owner = h.create();
  await owner.prepare(); await assert.rejects(owner.resume()); assert.throws(() => owner.assertCurrent());
  h.frame("running"); assert.throws(() => owner.assertCurrent());
  assert.equal(await owner.retireOriginal(), true); assert.equal(h.resumes, 1); assert.equal(h.stops, 1);
});

it("original controller refuses wrong or duplicate frame facts and unsafe profiles", async () => {
  for (const malformed of ["foreign", "duplicate"] as const) {
    const h = nativeWireHarness(), owner = h.create(); await owner.prepare();
    if (malformed === "foreign") h.frame("running", {nonce: "b".repeat(64)});
    else h.frame("suspended");
    assert.throws(() => owner.assertCurrent()); await assert.rejects(owner.resume()); h.close();
  }
  for (const mutate of [(p: any) => {p.processMemoryBytes = true;}, (p: any) => {p.maximumActiveProcesses = 0;},
    (p: any) => {p.jobMemoryBytes = 1;}, (p: any) => {p.nativeReady = true;}]) {
    const profile = {...inertResourceProfile}; mutate(profile);
    assert.throws(() => originalWorkerResourceDigest(profile));
  }
});

it("original controller drains a coalesced final packet after exit", async () => {
  const h = nativeWireHarness(); h.stopReply = false; h.stopCloses = false; const owner = h.create();
  await owner.prepare(); await owner.resume(); const closing = owner.retireOriginal();
  await Promise.resolve(); h.child.emit("exit", 0, null);
  h.packet({kind: "worker-output", lane: "stdout", data: Buffer.from("inert diagnostic").toString("base64")}, {kind: "retired"});
  h.close(); assert.equal(await closing, true); assert.equal(h.stops, 1);
});

it("original controller rejects an unsupported platform before invoking its supplier", async () => {
  const h = nativeWireHarness(); h.configuration.nativePlatform = () => ({platform: "linux", arch: "x64"});
  try {await assert.rejects(async () => h.create().prepare()); assert.equal(h.starts, 0);}
  finally {h.close();}
});

it("original controller retirement fences pending preflight with positive zero-construction closure", async () => {
  const h = nativeWireHarness(), owner = h.create();
  const preparing = owner.prepare(), stopping = owner.retireOriginal();
  await assert.rejects(preparing); assert.equal(await stopping, true); assert.equal(h.starts, 0);
  assert.equal(await owner.retireOriginal(), true); assert.equal(h.stops, 0);
});

it("original controller checks captured async permission after file preflight and before supplier", async () => {
  const h = nativeWireHarness(); let checks = 0, replacement = 0, release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;}), observed = new Promise<void>(resolve => {entered = resolve;});
  const configuration = {...h.configuration, async assertStartupAllowed(): Promise<void> {
    assert.equal(this, configuration); checks++; entered(); await gate; throw Error("synthetic withdrawn permission");
  }};
  const owner = createWindowsOriginalWorkerLaunch(configuration), preparing = owner.prepare();
  await observed; configuration.assertStartupAllowed = async () => {replacement++;};
  const rejected = assert.rejects(preparing); release(); await rejected;
  assert.equal(checks, 1); assert.equal(replacement, 0); assert.equal(h.starts, 0); assert.equal(h.resumes, 0);
  assert.equal(await owner.retireOriginal(), true); // Existing actual no-construction proof, no source mode.
  assert.equal(h.stops, 0); h.close();
});

it("Stop during the final async construction check prevents controller creation", async () => {
  const h = nativeWireHarness(); let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;}), observed = new Promise<void>(resolve => {entered = resolve;});
  const owner = createWindowsOriginalWorkerLaunch({...h.configuration, async assertStartupAllowed() {entered(); await gate;}});
  const preparing = owner.prepare(); await observed;
  const stopping = owner.retireOriginal(); release(); await assert.rejects(preparing);
  assert.equal(await stopping, true); assert.equal(h.starts, 0); assert.equal(h.stops, 0); h.close();
});

it("async construction checks cannot reenter prepare and native current callbacks cannot reenter resume", async () => {
  const h = nativeWireHarness(); let owner!: ReturnType<typeof createWindowsOriginalWorkerLaunch>, reentered = false;
  const rejected: Promise<void>[] = [];
  const configuration = {...h.configuration,
    async assertStartupAllowed() {rejected.push(assert.rejects(owner.prepare()));},
    assertHostCurrent() {
      h.configuration.assertHostCurrent();
      if (!reentered && h.starts) {reentered = true; rejected.push(assert.rejects(owner.resume()));}
    }};
  owner = createWindowsOriginalWorkerLaunch(configuration);
  // Reentry after launch but during prepare cannot issue Resume in preparing phase.
  await owner.prepare(); await Promise.all(rejected); rejected.length = 0; reentered = false;
  await owner.resume(); await Promise.all(rejected);
  assert.equal(h.starts, 1); assert.equal(h.resumes, 1); assert.equal(await owner.retireOriginal(), true);
});

it("an active final construction hook is refused without executing its getter", () => {
  const h = nativeWireHarness(); let getters = 0;
  assert.throws(() => createWindowsOriginalWorkerLaunch({...h.configuration,
    get assertStartupAllowed() {getters++; return async () => {};}}));
  assert.equal(getters, 0); assert.equal(h.starts, 0); h.close();
});

for (const mode of ["unsupported-platform", "host-ended"] as const) it(`native prelaunch refusal reports failed without constructing a worker (${mode})`, async () => {
  let starts = 0;
  const supervisor = createPythonRuntimeSupervisor({command: process.execPath, args: ["main.py"],
    cwd: path.resolve(__dirname, "../worker"), env: {PYTHON_RUNTIME_HOST: "127.0.0.1", PYTHON_RUNTIME_PORT: "43111",
      PYTHON_RUNTIME_AUTH_TOKEN: "inert-".padEnd(40, "x")},
    nativeWorkerResourceProfile: inertResourceProfile,
    nativePlatform: () => ({platform: mode === "unsupported-platform" ? "linux" : "win32", arch: "x64"}),
    assertHostCurrent() {if (mode === "host-ended") throw Error("private controlled host detail");},
    verifyRuntimeEnvironment: async () => true,
    runtimeClient: {getHealthStatus: async () => ({healthy: true, status: {status: "ready"}})} as never,
    spawnImplementation: (() => {starts++; throw Error("No process permitted");}) as never});
  await assert.rejects(supervisor.startWithoutInstalling!(), /^Error: The configured native Python worker is unavailable\.$/);
  assert.equal(starts, 0); assert.equal(supervisor.getStatus(), "failed");
});
