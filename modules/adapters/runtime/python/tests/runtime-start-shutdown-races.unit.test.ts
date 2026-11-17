import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createPythonRuntimeSupervisor } from "../supervisor/createPythonRuntimeSupervisor";
import { createComfyUiRuntimeSupervisor } from "../../comfyui/createComfyUiRuntimeSupervisor";

for (const preparation of [
  "prepareRuntimeEnvironment",
  "prepareLaunchEnvironment",
] as const) {
  test(`Python starts share ${preparation} and cannot spawn after stop`, async () => {
    let finish!: () => void, prepared!: () => void;
    let preparations = 0,
      spawns = 0;
    const barrier = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      prepared = resolve;
    });
    const supervisor = createPythonRuntimeSupervisor({
      command: "python",
      runtimeClient: {
        getHealthStatus: async () => {
          throw new Error("not running");
        },
      },
      [preparation]: async () => {
        preparations++;
        prepared();
        await barrier;
      },
      spawnImplementation: (() => {
        spawns++;
        throw new Error("must not spawn");
      }) as never,
    });
    const first = supervisor.start(),
      second = supervisor.start();
    await entered;
    assert.equal(preparations, 1);
    await supervisor.stop();
    await assert.rejects(
      supervisor.start(),
      /Previous.*startup is still stopping/,
    );
    finish();
    const results = await Promise.allSettled([first, second]);
    assert.equal(
      results.every((r) => r.status === "rejected"),
      true,
    );
    assert.equal(spawns, 0);
    assert.equal(supervisor.getStatus(), "stopped");
  });
}

test("ComfyUI starts share installation and cannot spawn after stop during installation", async () => {
  let finish!: (result: any) => void, installing!: () => void;
  let installs = 0,
    spawns = 0;
  const barrier = new Promise<any>((resolve) => {
    finish = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    installing = resolve;
  });
  const supervisor = createComfyUiRuntimeSupervisor({
    autoInstall: true,
    installRoot: "runtime/comfyui",
    installer: {
      ensureInstalled: async () => {
        installs++;
        installing();
        return barrier;
      },
    } as never,
    client: { getSystemStats: async () => ({}) } as never,
    spawnImplementation: (() => {
      spawns++;
      throw new Error("must not spawn");
    }) as never,
  });
  const first = supervisor.start(),
    second = supervisor.start();
  await entered;
  assert.equal(installs, 1);
  await supervisor.stop();
  await assert.rejects(
    supervisor.start(),
    /Previous.*startup is still stopping/,
  );
  finish({ status: "installed" });
  const results = await Promise.allSettled([first, second]);
  assert.equal(
    results.every((r) => r.status === "rejected"),
    true,
  );
  assert.equal(spawns, 0);
  assert.equal(supervisor.getStatus(), "stopped");
});

function child() {
  return Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true,
  });
}
const healthy = () => ({
  healthy: true,
  status: { runtimeId: "python-sidecar", status: "ready" as const },
});

for (const stage of ["health", "capabilities"] as const) {
  test(`Python late ${stage} reply cannot resurrect an exited owned worker`, async () => {
    const process = child();
    let spawned = false;
    let reply!: (value: any) => void, entered!: () => void;
    const barrier = new Promise<any>((resolve) => {
      reply = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const supervisor = createPythonRuntimeSupervisor({
      command: "python",
      requiredCapabilities: stage === "capabilities" ? ["fixture"] : [],
      spawnImplementation: (() => {
        spawned = true;
        return process;
      }) as never,
      runtimeClient: {
        getHealthStatus: async () => {
          if (!spawned) throw new Error("not started");
          if (stage === "health") {
            entered();
            return barrier;
          }
          return healthy();
        },
        getCapabilities: async () => {
          entered();
          return barrier;
        },
      },
    });
    const starting = supervisor.start();
    await waiting;
    process.emit("exit", 1, null);
    reply(stage === "health" ? healthy() : { capabilities: ["fixture"] });
    await assert.rejects(starting, /exited before health check/);
    assert.equal(supervisor.getStatus(), "stopped");
  });
}

test("late ComfyUI health cannot overwrite a confirmed stop", async () => {
  const process = child();
  let reads = 0;
  let reply!: (value: unknown) => void, entered!: () => void;
  const barrier = new Promise((resolve) => {
    reply = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const response = () => ({ ok: true, json: async () => ({ devices: [] }) });
  const supervisor = createComfyUiRuntimeSupervisor({
    workingDirectory: "runtime/fixture",
    spawnImplementation: (() => process) as never,
    fetchImplementation: (async () => {
      if (++reads > 1) {
        entered();
        return barrier;
      }
      return response();
    }) as never,
  });
  await supervisor.start();
  const reading = supervisor.getHealth();
  await waiting;
  const stopping = supervisor.stop();
  await Promise.resolve();
  process.emit("exit", 0, "SIGTERM");
  await stopping;
  reply(response());
  assert.equal((await reading).status, "stopped");
  assert.equal(supervisor.getStatus(), "stopped");
  assert.equal(supervisor.isRunning(), false);
});

for (const runtime of ["python", "image"] as const) {
  test(`${runtime} spawn error retains owner until close and stale error cannot poison retry`, async () => {
    const first = child(),
      second = child();
    let active: ReturnType<typeof child> | undefined,
      spawns = 0;
    let reply!: (value: unknown) => void, entered!: () => void;
    const barrier = new Promise<any>((resolve) => {
      reply = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const spawn = () => {
      active = ++spawns === 1 ? first : second;
      return active;
    };
    const response = () => ({ ok: true, json: async () => ({ devices: [] }) });
    const supervisor =
      runtime === "python"
        ? createPythonRuntimeSupervisor({
            command: "python",
            spawnImplementation: spawn as never,
            runtimeClient: {
              getHealthStatus: async () => {
                if (!active) throw new Error("not started");
                if (active === first) {
                  entered();
                  return barrier;
                }
                return healthy();
              },
            },
          })
        : createComfyUiRuntimeSupervisor({
            workingDirectory: "runtime/fixture",
            spawnImplementation: spawn as never,
            fetchImplementation: (async () => {
              if (active === first) {
                entered();
                return barrier;
              }
              return response();
            }) as never,
          });
    const starting = supervisor.start();
    await waiting;
    first.emit("error", new Error("fixture spawn failure"));
    reply(runtime === "python" ? healthy() : response());
    await assert.rejects(starting, /failed/);
    await assert.rejects(supervisor.start(), /stop the owned process/);
    first.emit("close", -1, null);
    active = undefined;
    await supervisor.start();
    assert.equal(supervisor.getStatus(), "ready");
    first.emit("error", new Error("old callback"));
    assert.equal(supervisor.getStatus(), "ready");
    const stopping = supervisor.stop();
    await Promise.resolve();
    second.emit("exit", 0, "SIGTERM");
    await stopping;
  });
}
