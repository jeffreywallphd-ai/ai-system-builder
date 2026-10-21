import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { terminateOwnedProcess } from "../terminateOwnedProcess";
import { createComfyUiRuntimeSupervisor } from "../../comfyui/createComfyUiRuntimeSupervisor";
import { createPythonRuntimeSupervisor } from "../../python/supervisor/createPythonRuntimeSupervisor";
import { OwnedTaskReconcilerService } from "../../../../application/services/runtime/owned-task-reconciler.service";
import { shutdownOwnedTasks } from "../../../../hosts/shared/shutdownOwnedTasks";

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kills: 0,
    kill: (_signal?: string): boolean => {
      child.kills++;
      return true;
    },
  });
  child.on("error", () => {});
  return child;
}
const native = (child: ReturnType<typeof fakeChild>) =>
  child as unknown as ChildProcess;

test("owned termination requires terminal proof and catches synchronous close", async () => {
  for (const signal of [false, true]) {
    const child = fakeChild();
    if (signal) child.signalCode = "SIGTERM";
    else child.exitCode = 0;
    await terminateOwnedProcess(native(child));
    assert.equal(child.kills, 0);
  }
  const child = fakeChild();
  child.kill = () => {
    child.emit("close", 0, null);
    return true;
  };
  await terminateOwnedProcess(native(child));
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("close"), 0);
  assert.equal(child.listenerCount("error"), 1);
});

test("timeout and process error cannot prove termination; listeners retire", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ignored = fakeChild();
  const timed = assert.rejects(
    terminateOwnedProcess(native(ignored)),
    /termination could not be confirmed/,
  );
  t.mock.timers.tick(5000);
  await timed;
  assert.equal(ignored.exitCode, null);
  assert.equal(ignored.listenerCount("exit"), 0);
  const errored = fakeChild();
  const rejected = assert.rejects(
    terminateOwnedProcess(native(errored)),
    (error: Error) => {
      assert.match(error.message, /ownership is retained/);
      assert.equal(error.message.includes("private-payload"), false);
      return true;
    },
  );
  errored.emit("error", new Error("private-payload"));
  await rejected;
  assert.equal(errored.listenerCount("close"), 0);
  assert.equal(errored.listenerCount("error"), 1);
});

test("refused or throwing kill fails unless terminal properties prove the raced exit", async () => {
  for (const throws of [false, true]) {
    for (const exited of [false, true]) {
      const child = fakeChild();
      child.kill = () => {
        if (exited) child.exitCode = 0;
        if (throws) throw new Error("private kill failure");
        return false;
      };
      const operation = terminateOwnedProcess(native(child));
      if (exited) await operation;
      else
        await assert.rejects(operation, /termination could not be confirmed/);
    }
  }
});

for (const runtime of ["python", "image"] as const) {
  test(`${runtime} stop timeout retains ownership and single-flight retry confirms exit`, async (t) => {
    const child = fakeChild();
    let spawned = false,
      spawns = 0;
    const spawn = () => {
      spawned = true;
      spawns++;
      return native(child);
    };
    const supervisor =
      runtime === "python"
        ? createPythonRuntimeSupervisor({
            command: "python",
            spawnImplementation: spawn as never,
            runtimeClient: {
              getHealthStatus: async () => {
                if (!spawned) throw new Error("not started");
                return {
                  healthy: true,
                  status: { runtimeId: "python-sidecar", status: "ready" },
                };
              },
            },
          })
        : createComfyUiRuntimeSupervisor({
            workingDirectory: "runtime/fixture",
            spawnImplementation: spawn as never,
            fetchImplementation: (async () => ({
              ok: true,
              json: async () => ({ devices: [] }),
            })) as never,
          });
    await supervisor.start();
    assert.equal(spawns, 1);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const first = supervisor.stop(),
      second = supervisor.stop();
    const denied = Promise.all([
      assert.rejects(first, /termination could not be confirmed/),
      assert.rejects(second, /termination could not be confirmed/),
    ]);
    await Promise.resolve();
    assert.equal(child.kills, 1);
    t.mock.timers.tick(5000);
    await denied;
    assert.notEqual(supervisor.getStatus(), "stopped");
    if ("getHealth" in supervisor)
      assert.equal((await supervisor.getHealth()).status, "unhealthy");
    await assert.rejects(supervisor.start(), /stop the owned process/);
    const retry = supervisor.stop();
    await Promise.resolve();
    child.emit("exit", 0, "SIGTERM");
    await retry;
    assert.equal(child.kills, 2);
    assert.equal(supervisor.getStatus(), "stopped");
  });
}

test("externally attached Python worker cannot be declared terminated", async () => {
  const supervisor = createPythonRuntimeSupervisor({
    command: "python",
    runtimeClient: {
      getHealthStatus: async () => ({
        healthy: true,
        status: { runtimeId: "python-sidecar", status: "ready" },
      }),
    },
    spawnImplementation: (() => {
      throw new Error("must not spawn");
    }) as never,
  });
  await supervisor.start();
  await assert.rejects(
    supervisor.stop(),
    /Externally attached.*cannot be confirmed/,
  );
  assert.equal(supervisor.getStatus(), "ready");
});

for (const failure of ["unhealthy", "transport", "capabilities"] as const) {
  test(`external ${failure} failure cannot authorize a replacement worker`, async () => {
    let available = true,
      spawns = 0;
    const supervisor = createPythonRuntimeSupervisor({
      command: "python",
      requiredCapabilities: ["fixture"],
      runtimeClient: {
        getHealthStatus: async () => {
          if (!available && failure === "transport")
            throw new Error("unavailable");
          return {
            healthy: available || failure !== "unhealthy",
            status: { runtimeId: "python-sidecar", status: "ready" },
          };
        },
        getCapabilities: async () => ({
          capabilities:
            !available && failure === "capabilities" ? [] : ["fixture"],
        }),
      },
      spawnImplementation: (() => {
        spawns++;
        throw new Error("replacement must not launch");
      }) as never,
    });
    await supervisor.start();
    available = false;
    await assert.rejects(
      supervisor.start(),
      /external termination must be confirmed/,
    );
    assert.equal(spawns, 0);
    await assert.rejects(
      supervisor.stop(),
      /Externally attached.*cannot be confirmed/,
    );
    available = true;
    await supervisor.start();
    assert.equal(supervisor.getStatus(), "ready");
    assert.equal(spawns, 0);
  });
}

test("host retains accepted input ownership until the actual image supervisor confirms stop", async (t) => {
  const child = fakeChild();
  let cleaned = 0;
  const supervisor = createComfyUiRuntimeSupervisor({
    workingDirectory: "runtime/fixture",
    spawnImplementation: (() => native(child)) as never,
    fetchImplementation: (async () => ({
      ok: true,
      json: async () => ({ devices: [] }),
    })) as never,
  });
  await supervisor.start();
  const reconciler = new OwnedTaskReconcilerService();
  reconciler.reserve("image").start(
    async () => false,
    async () => {},
    async () => {
      cleaned++;
    },
  );
  const options = {
    reconciler,
    stopPython: async () => {},
    stopImage: () => supervisor.stop(),
  };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const failed = assert.rejects(shutdownOwnedTasks(options), /remains pending/);
  await new Promise(setImmediate);
  assert.equal(child.kills, 1);
  t.mock.timers.tick(5000);
  await failed;
  assert.equal(cleaned, 0);
  assert.equal(reconciler.status.pending, 1);
  const retry = shutdownOwnedTasks(options);
  await new Promise(setImmediate);
  child.emit("close", 0, "SIGTERM");
  await retry;
  assert.equal(cleaned, 1);
  assert.equal(reconciler.status.pending, 0);
});

test("ComfyUI startup timeout retains an unconfirmed child until explicit retry stops it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const child = fakeChild();
  const supervisor = createComfyUiRuntimeSupervisor({
    workingDirectory: "runtime/fixture",
    spawnImplementation: (() => native(child)) as never,
    startupTimeoutMs: 1,
    healthCheckIntervalMs: 1,
    fetchImplementation: (async () => {
      throw new Error("not ready");
    }) as never,
  });
  const starting = assert.rejects(supervisor.start(), /failed to become ready/);
  await new Promise(setImmediate);
  t.mock.timers.tick(2);
  await new Promise(setImmediate);
  assert.equal(child.kills, 1);
  t.mock.timers.tick(5000);
  await starting;
  assert.equal(supervisor.isRunning(), true);
  assert.equal(supervisor.getStatus(), "unhealthy");
  await assert.rejects(supervisor.start(), /stop the owned process/);
  const stopped = supervisor.stop();
  await Promise.resolve();
  child.emit("close", 0, "SIGTERM");
  await stopped;
  assert.equal(supervisor.isRunning(), false);
});
