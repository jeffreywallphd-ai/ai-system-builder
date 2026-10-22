import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import assert from "node:assert/strict";

import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";
import { createPythonRuntimeAdapterFoundation } from "../createPythonRuntimePort";

const TOKENS = [
  "initial-runtime-token-0123456789abcdef",
  "first-launch-token-0123456789abcdefghi",
  "second-launch-token-0123456789abcdefgh",
];

function response(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

describe("createPythonRuntimeAdapterFoundation", () => {
  it("rejects mismatched start, read and cancel identities before retaining terminal state", async () => {
    const fixture = ownedTaskFixture();
    await fixture.foundation.supervisor.start();
    fixture.replyRequestId = "foreign-task";
    await assert.rejects(() => fixture.start("owned-task"), /identity/);
    fixture.replyRequestId = undefined;
    await fixture.start("owned-task");
    for (const mismatch of ["request", "type"]) {
      if(mismatch === "request") fixture.replyRequestId = "foreign-task";
      else fixture.replyTaskType = "prepare-training-dataset";
      await assert.rejects(() => fixture.foundation.runtimePort.cancelTask("owned-task"), /identity/);
      await assert.rejects(() => fixture.foundation.runtimePort.readTaskStatus("owned-task"), /identity/);
      fixture.replyRequestId = undefined; fixture.replyTaskType = undefined;
      assert.equal((await fixture.foundation.runtimePort.readTaskStatus("owned-task")).status, "running");
    }
    fixture.children[0]!.emit("exit", 23, null);
    assert.equal((await fixture.foundation.runtimePort.readTaskStatus("owned-task")).error?.code, "python_runtime_worker_exited");
  });
  it("fails accepted unfinished work only after an owned exit, preserves observed terminals, and fences late replies", async () => {
    const fixture = ownedTaskFixture();
    await fixture.foundation.supervisor.start();
    await fixture.start("unfinished");
    await fixture.start("finished");
    fixture.statuses.set("finished", "succeeded");
    assert.equal((await fixture.foundation.runtimePort.readTaskStatus("finished")).status, "succeeded");
    fixture.transportFailure = true;
    await assert.rejects(() => fixture.foundation.runtimePort.readTaskStatus("unfinished"));
    fixture.transportFailure = false;
    assert.equal((await fixture.foundation.runtimePort.readTaskStatus("unfinished")).status, "running");
    let deliver!: (response: Response) => void;
    fixture.read = () => new Promise<Response>(resolve => { deliver = resolve; });
    const late = fixture.foundation.runtimePort.readTaskStatus("unfinished");
    fixture.children[0]!.emit("exit", 23, null);
    deliver(response(200, { requestId: "unfinished", taskType: "train-model", status: "succeeded" }));
    assert.equal((await late).error?.code, "python_runtime_worker_exited");
    assert.equal((await fixture.foundation.runtimePort.readTaskStatus("finished")).status, "succeeded");
    fixture.read = undefined;
    fixture.transportFailure = true;
    await assert.rejects(() => fixture.foundation.runtimePort.readTaskStatus("unknown"));
    fixture.transportFailure = false;
    await fixture.foundation.supervisor.start();
    await fixture.start("new-generation");
    fixture.children[0]!.emit("close", 23, null);
    assert.equal((await fixture.foundation.runtimePort.readTaskStatus("new-generation")).status, "running");
    await fixture.foundation.supervisor.stop();
    assert.equal((await fixture.foundation.runtimePort.readTaskStatus("new-generation")).status, "failed");
  });

  it("retains terminal failure when the owned worker exits during task admission", async () => {
    const fixture = ownedTaskFixture();
    await fixture.foundation.supervisor.start();
    fixture.duringAdmission = () => fixture.children[0]!.emit("exit", 23, null);
    await fixture.start("admission-race");
    assert.equal((await fixture.foundation.runtimePort.readTaskStatus("admission-race")).error?.code, "python_runtime_worker_exited");
  });

  it("retains the accepted type when a cooperative cancellation omits it", async () => {
    const fixture = ownedTaskFixture();
    await fixture.foundation.supervisor.start();
    await fixture.start("cooperative-cancel");
    assert.equal((await fixture.foundation.runtimePort.cancelTask("cooperative-cancel")).cancelled, true);
    fixture.children[0]!.emit("exit", 23, null);
    assert.deepEqual(await fixture.foundation.runtimePort.readTaskStatus("cooperative-cancel"), {
      requestId: "cooperative-cancel", taskType: "train-model", status: "cancelled",
      completedAt: (await fixture.foundation.runtimePort.readTaskStatus("cooperative-cancel")).completedAt,
      metadata: undefined,
    });
  });
  it("rotates a private bearer token for every spawned launch and does not attach to an ambient service", async () => {
    const generatedTokens = [...TOKENS];
    let activeLaunchToken: string | undefined;
    let processAlive = false;
    const observedAuthorization: string[] = [];
    const spawnedTokens: string[] = [];
    const fetchImplementation = testDouble.fn(
      async (_url: string, init?: RequestInit) => {
        const authorization =
          (init?.headers as Record<string, string> | undefined)
            ?.authorization ?? "";
        observedAuthorization.push(authorization);
        if (!processAlive || authorization !== `Bearer ${activeLaunchToken}`) {
          return response(401, { error: { code: "runtime_auth_required" } });
        }
        return response(200, {
          healthy: true,
          status: { runtimeId: "python-sidecar", status: "ready" },
        });
      },
    );
    const spawnImplementation = testDouble.fn(
      (
        _command: string,
        _args: readonly string[],
        options: { env?: NodeJS.ProcessEnv },
      ) => {
        activeLaunchToken = options.env?.PYTHON_RUNTIME_AUTH_TOKEN;
        spawnedTokens.push(activeLaunchToken ?? "");
        processAlive = true;
        const child = new EventEmitter() as EventEmitter & {
          stdout: PassThrough;
          stderr: PassThrough;
          kill(signal?: string): boolean;
        };
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = (signal) => {
          processAlive = false;
          queueMicrotask(() => child.emit("exit", 0, signal ?? "SIGTERM"));
          return true;
        };
        return child;
      },
    );
    const events: unknown[] = [];
    const foundation = createPythonRuntimeAdapterFoundation({
      client: {
        baseUrl: "http://127.0.0.1:43111",
        fetchImplementation: fetchImplementation as never,
      },
      supervisor: {
        command: "python",
        args: ["main.py"],
        env: { SAFE_SETTING: "retained" },
        spawnImplementation: spawnImplementation as never,
        startupTimeoutMs: 100,
        healthCheckIntervalMs: 1,
        onEvent: (event) => events.push(event),
      },
      generateAuthorizationToken: () => {
        const token = generatedTokens.shift();
        if (!token) throw new Error("Unexpected token request.");
        return token;
      },
    });

    await foundation.supervisor.start();
    await foundation.supervisor.stop();
    await foundation.supervisor.start();

    expect(spawnedTokens).toEqual([TOKENS[1], TOKENS[2]]);
    expect(spawnedTokens[0]).not.toBe(spawnedTokens[1]);
    expect(observedAuthorization).toContain(`Bearer ${TOKENS[0]}`);
    expect(observedAuthorization).toContain(`Bearer ${TOKENS[1]}`);
    expect(observedAuthorization).toContain(`Bearer ${TOKENS[2]}`);
    expect(JSON.stringify(events)).not.toContain("launch-token");
  });

  it("restarts the sole worker to cancel running work and preserves idempotent status", async () => {
    const generatedTokens = [
      "cancel-initial-token-0123456789abcdef",
      "cancel-launch-token-0123456789abcdefg",
      "cancel-recovery-token-0123456789abcdef",
    ];
    let activeLaunchToken: string | undefined;
    let processAlive = false;
    const spawnImplementation = testDouble.fn(
      (
        _command: string,
        _args: readonly string[],
        options: { env?: NodeJS.ProcessEnv },
      ) => {
        activeLaunchToken = options.env?.PYTHON_RUNTIME_AUTH_TOKEN;
        processAlive = true;
        const child = new EventEmitter() as EventEmitter & {
          stdout: PassThrough;
          stderr: PassThrough;
          kill(signal?: string): boolean;
        };
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = (signal) => {
          processAlive = false;
          queueMicrotask(() => child.emit("exit", 0, signal ?? "SIGTERM"));
          return true;
        };
        return child;
      },
    );
    const fetchImplementation = testDouble.fn(
      async (url: string, init?: RequestInit) => {
        const authorization = (
          init?.headers as Record<string, string> | undefined
        )?.authorization;
        if (!processAlive || authorization !== `Bearer ${activeLaunchToken}`) {
          return response(401, { error: { code: "runtime_auth_required" } });
        }
        if (url.endsWith("/health")) {
          return response(200, {
            healthy: true,
            status: { runtimeId: "python-sidecar", status: "ready" },
          });
        }
        if (url.endsWith("/tasks/start")) {
          return response(200, {
            requestId: "running-task",
            taskType: "train-model",
            accepted: true,
            status: "queued",
          });
        }
        if (url.endsWith("/tasks/running-task/cancel")) {
          return response(200, {
            requestId: "running-task",
            taskType: "train-model",
            status: "running",
            cancelled: false,
          });
        }
        throw new Error("Unexpected runtime request.");
      },
    );
    const foundation = createPythonRuntimeAdapterFoundation({
      client: {
        baseUrl: "http://127.0.0.1:43111",
        fetchImplementation: fetchImplementation as never,
      },
      supervisor: {
        command: "python",
        args: ["main.py"],
        spawnImplementation: spawnImplementation as never,
        startupTimeoutMs: 100,
        healthCheckIntervalMs: 1,
      },
      generateAuthorizationToken: () => generatedTokens.shift()!,
    });

    await foundation.supervisor.start();
    await foundation.runtimePort.startTask({
      requestId: "running-task",
      taskType: "train-model",
      payload: {},
    });
    const cancelled = await foundation.runtimePort.cancelTask("running-task");
    const status = await foundation.runtimePort.readTaskStatus("running-task");
    const cancelledAgain =
      await foundation.runtimePort.cancelTask("running-task");

    expect(spawnImplementation).toHaveBeenCalledTimes(2);
    expect(cancelled).toMatchObject({ cancelled: true, status: "cancelled" });
    expect(status).toMatchObject({ status: "cancelled" });
    expect(cancelledAgain).toMatchObject({
      cancelled: true,
      status: "cancelled",
    });
  });
});

function ownedTaskFixture() {
  let processAlive = false;
  const children: Array<EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill(signal?: string): boolean }> = [];
  const statuses = new Map<string, string>();
  const fixture = {
    children, statuses, transportFailure: false,
    read: undefined as undefined | (() => Promise<Response>),
    duringAdmission: undefined as undefined | (() => void),
    replyRequestId: undefined as string | undefined,
    replyTaskType: undefined as string | undefined,
    foundation: undefined as unknown as ReturnType<typeof createPythonRuntimeAdapterFoundation>,
    start: (requestId: string) => fixture.foundation.runtimePort.startTask({ requestId, taskType: "train-model", payload: {} }),
  };
  fixture.foundation = createPythonRuntimeAdapterFoundation({
    client: { baseUrl: "http://127.0.0.1:43111", fetchImplementation: (async (url: string, init?: RequestInit) => {
      if (fixture.transportFailure) throw new Error("Synthetic transport unavailable");
      if (url.endsWith("/health")) return processAlive
        ? response(200, { healthy: true, status: { runtimeId: "python-sidecar", status: "ready" } })
        : response(401, { error: { code: "runtime_auth_required" } });
      if (url.endsWith("/tasks/start")) {
        const request = JSON.parse(String(init?.body));
        fixture.duringAdmission?.();
        return response(200, { requestId: fixture.replyRequestId ?? request.requestId, taskType: fixture.replyTaskType ?? request.taskType, accepted: true, status: "queued" });
      }
      if (url.endsWith("/cancel")) return response(200, { requestId: fixture.replyRequestId ?? url.split("/").at(-2), taskType: fixture.replyTaskType, status: "cancelled", cancelled: true });
      if (fixture.read) return fixture.read();
      const requestId = decodeURIComponent(url.split("/").at(-1)!);
      return response(200, { requestId: fixture.replyRequestId ?? requestId, taskType: fixture.replyTaskType ?? "train-model", status: statuses.get(requestId) ?? "running" });
    }) as never },
    supervisor: { command: "python", args: ["main.py"], startupTimeoutMs: 100, healthCheckIntervalMs: 1,
      spawnImplementation: (() => {
        const child = new EventEmitter() as typeof children[number];
        processAlive = true;
        child.once("exit", () => { processAlive = false; });
        child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.kill = signal => { queueMicrotask(() => child.emit("exit", 0, signal ?? "SIGTERM")); return true; };
        children.push(child); return child;
      }) as never },
  });
  return fixture;
}
