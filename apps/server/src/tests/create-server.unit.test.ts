import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "../../../../modules/testing/node-test";
import type { StructuredLogEvent } from "../../../../modules/contracts/logging";

import {
  DEFAULT_SERVER_PORT,
  DEFAULT_SERVER_LOCAL_STATE_DIRECTORY_NAME,
  DEFAULT_SERVER_RUNTIME_ROOT_DIRECTORY_NAME,
  DEFAULT_SERVER_STORAGE_ROOT_DIRECTORY_NAME,
  createServer,
  resolveDefaultServerRuntimeRootDirectory,
  resolveDefaultServerStorageRootDirectory,
  resolveServerAppRootDirectory,
  resolveServerRuntimeConfig,
} from "../createServer";

describe("resolveServerRuntimeConfig", () => {
  it("uses stable server-owned defaults when environment overrides are absent in CJS runtime", () => {
    const config = resolveServerRuntimeConfig({});
    expect(config.port).toBe(DEFAULT_SERVER_PORT);
    expect(config.storageRootDirectory).toBe(
      path.resolve(
        "apps",
        "server",
        DEFAULT_SERVER_STORAGE_ROOT_DIRECTORY_NAME,
      ),
    );
    expect(config.runtimeRootDirectory).toBe(
      path.resolve(
        "apps",
        "server",
        DEFAULT_SERVER_LOCAL_STATE_DIRECTORY_NAME,
        DEFAULT_SERVER_RUNTIME_ROOT_DIRECTORY_NAME,
      ),
    );
    expect(config.runtimeRootDirectory).not.toContain(
      config.storageRootDirectory,
    );
  });

  it("resolves default server roots from the app workspace cwd without duplicating apps/server", () => {
    const serverAppRootDirectory = path.resolve("apps", "server");
    const config = resolveServerRuntimeConfig(
      {},
      { cwd: serverAppRootDirectory },
    );

    expect(
      resolveServerAppRootDirectory({ cwd: serverAppRootDirectory, env: {} }),
    ).toBe(serverAppRootDirectory);
    expect(config.storageRootDirectory).toBe(
      path.join(
        serverAppRootDirectory,
        DEFAULT_SERVER_STORAGE_ROOT_DIRECTORY_NAME,
      ),
    );
    expect(config.runtimeRootDirectory).toBe(
      path.join(
        serverAppRootDirectory,
        DEFAULT_SERVER_LOCAL_STATE_DIRECTORY_NAME,
        DEFAULT_SERVER_RUNTIME_ROOT_DIRECTORY_NAME,
      ),
    );
    expect(config.storageRootDirectory).not.toContain(
      path.join("apps", "server", "apps", "server"),
    );
    expect(config.runtimeRootDirectory).not.toContain(
      path.join("apps", "server", "apps", "server"),
    );
  });

  it("honors SERVER_STORAGE_ROOT override when provided without moving runtime root", () => {
    const config = resolveServerRuntimeConfig({
      SERVER_STORAGE_ROOT: " ./tmp/server-root ",
    });

    expect(config.storageRootDirectory).toBe(path.resolve("./tmp/server-root"));
    expect(config.runtimeRootDirectory).toBe(
      resolveDefaultServerRuntimeRootDirectory(),
    );
  });

  it("honors SERVER_RUNTIME_ROOT override when provided", () => {
    const config = resolveServerRuntimeConfig({
      SERVER_RUNTIME_ROOT: " ./tmp/server-runtime ",
    });

    expect(config.runtimeRootDirectory).toBe(
      path.resolve("./tmp/server-runtime"),
    );
  });

  it("exposes stable default storage/runtime roots in CJS runtime", () => {
    expect(resolveDefaultServerStorageRootDirectory()).toBe(
      path.resolve(
        "apps",
        "server",
        DEFAULT_SERVER_STORAGE_ROOT_DIRECTORY_NAME,
      ),
    );
    expect(resolveDefaultServerRuntimeRootDirectory()).toBe(
      path.resolve(
        "apps",
        "server",
        DEFAULT_SERVER_LOCAL_STATE_DIRECTORY_NAME,
        DEFAULT_SERVER_RUNTIME_ROOT_DIRECTORY_NAME,
      ),
    );
  });

  it("createServer passes runtime root to registerApi", () => {
    const source = readFileSync(
      path.resolve("apps/server/src/createServer.ts"),
      "utf8",
    );
    expect(source).toContain(
      "runtimeRootDirectory: config.runtimeRootDirectory",
    );
    expect(source).toContain(
      "storageRootDirectory: config.storageRootDirectory",
    );
  });

  it("createServer exposes the composed server logging port", async () => {
    const emittedEvents: StructuredLogEvent[] = [];
    const { loggingPort } = await createServer({
      env: {},
      now: () => "2026-05-03T00:00:00.000Z",
      logSink: (_serializedEvent, event) => {
        emittedEvents.push(event);
      },
    });
    emittedEvents.splice(0, emittedEvents.length);

    await loggingPort.log({
      timestamp: "",
      level: "info",
      verbosity: "normal",
      event: "server.test",
      message: "Server test event.",
      component: "server-test",
    });

    expect(emittedEvents).toEqual([
      {
        timestamp: "2026-05-03T00:00:00.000Z",
        level: "info",
        verbosity: "normal",
        event: "server.test",
        message: "Server test event.",
        component: "server-test",
        host: "server",
      },
    ]);
  });

  it("enables case-sensitive API routing", async () => {
    const { app } = await createServer({ env: {} });

    expect(app.enabled("case sensitive routing")).toBe(true);
  });

  it("rejects the explicit qualification runtime seam before production composition", async () => {
    await expect(
      createServer({
        env: { NODE_ENV: "production" },
        runtimeDatabases: {} as never,
      }),
    ).rejects.toThrow(
      "The explicit runtime database seam is unavailable in production server startup.",
    );
  });

  it("createServer passes explicit environment into server runtime composition", async () => {
    const previousPythonRuntimeBaseUrl = process.env.PYTHON_RUNTIME_BASE_URL;
    process.env.PYTHON_RUNTIME_BASE_URL = "http://127.0.0.1:49999";
    const emittedEvents: StructuredLogEvent[] = [];
    const testRootDirectory = await mkdtemp(
      path.join(tmpdir(), "aisb-server-env-"),
    );
    const storageRootDirectory = path.join(testRootDirectory, "storage");
    const runtimeRootDirectory = path.join(testRootDirectory, "runtime");

    try {
      await createServer({
        env: {
          SERVER_STORAGE_ROOT: storageRootDirectory,
          SERVER_RUNTIME_ROOT: runtimeRootDirectory,
          PYTHON_RUNTIME_BASE_URL: "http://127.0.0.1:43112",
          PYTHON_RUNTIME_COMMAND: "python-custom",
          PYTHON_RUNTIME_ARGS: "worker.py --ready",
          PYTHON_RUNTIME_WORKER_DIR: "modules/adapters/runtime/python/worker",
        },
        logSink: (_serializedEvent, event) => {
          emittedEvents.push(event);
        },
      });
    } finally {
      if (previousPythonRuntimeBaseUrl === undefined) {
        delete process.env.PYTHON_RUNTIME_BASE_URL;
      } else {
        process.env.PYTHON_RUNTIME_BASE_URL = previousPythonRuntimeBaseUrl;
      }
      await rm(testRootDirectory, { recursive: true, force: true });
    }

    const pythonRuntimeLog = emittedEvents.find(
      (event) => event.event === "runtime.python.server.configuration",
    );
    expect(pythonRuntimeLog?.data).toMatchObject({
      serverStorageRootDirectory: storageRootDirectory,
      serverRuntimeRootDirectory: runtimeRootDirectory,
      pythonRuntimeRootDirectory: path.join(
        runtimeRootDirectory,
        "models",
        "huggingface",
      ),
      pythonRuntimeRootSource: "SERVER_RUNTIME_ROOT",
      pythonRuntimeMode: "worker-sidecar",
      pythonRuntimeEndpointScope: "loopback",
      pythonRuntimeCommandConfigured: true,
      pythonRuntimeArgsConfigured: true,
      taskRegistryOwnership: "server",
    });
    const pythonRuntimeData = pythonRuntimeLog?.data ?? {};
    expect("pythonRuntimeBaseUrl" in pythonRuntimeData).toBe(false);
    expect("pythonRuntimeCommand" in pythonRuntimeData).toBe(false);
    expect("pythonRuntimeArgs" in pythonRuntimeData).toBe(false);
    expect("pythonRuntimeWorkerDirectory" in pythonRuntimeData).toBe(false);
  });

  it("index startup log uses structured server host logging", () => {
    const source = readFileSync(
      path.resolve("apps/server/src/index.ts"),
      "utf8",
    );
    expect(source).toContain("loggingPort.log");
    expect(source).toContain("createServerListener");
    expect(source).toContain("server.http.listening");
    expect(source).toContain('process.once("SIGINT", beginShutdown)');
    expect(source).toContain('process.once("SIGTERM", beginShutdown)');
    expect(source).toContain("config.runtimeRootDirectory");
    expect(source).not.toContain("console.log");
    expect(source).not.toContain("[server] listening");
  });
});
