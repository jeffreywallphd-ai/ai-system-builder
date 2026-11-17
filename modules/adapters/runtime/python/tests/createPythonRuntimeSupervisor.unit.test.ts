import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";
import { createPythonRuntimeSupervisor } from "../supervisor/createPythonRuntimeSupervisor";

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
  const client = { marker: "bound", async getHealthStatus() { assert.equal(this.marker, "bound"); healthCalls++; if (healthCalls === 1) throw new Error("not started"); return { healthy: true, status: { runtimeId: "fixture", status: "ready" as const } }; }, async getCapabilities() { assert.equal(this.marker, "bound"); return { runtimeId: "fixture", capabilities: [] }; } };
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
