import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

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
