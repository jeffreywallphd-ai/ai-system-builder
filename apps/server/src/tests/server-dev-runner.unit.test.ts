import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";

import { describe, expect, it, testDouble } from "../../../../modules/testing/node-test";

describe("server dev runner", () => {
  it("keeps the server workspace dev script on the repository dev runner", () => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve("apps/server/package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.dev).toBe("node ../../dev-tools/scripts/server/dev-server.mjs");
  });

  it("uses in-process TypeScript watch plus the emitted CommonJS server instead of a subprocess watcher", () => {
    const source = readFileSync(
      path.resolve("dev-tools/scripts/server/dev-server.mjs"),
      "utf8",
    );

    expect(source).toContain("ts.createWatchCompilerHost");
    expect(source).toContain("ts.createWatchProgram");
    expect(source).toContain("dist\", \"apps\", \"server\", \"src\", \"createServer.js");
    expect(source).not.toContain("node:child_process");
    expect(source).not.toContain("tsx watch");
    expect(source).not.toContain("esbuild");
  });

  it("keeps Hugging Face model browsing fetch types compatible with server TypeScript", () => {
    const source = readFileSync(
      path.resolve("modules/adapters/model/huggingface/createHuggingFaceModelBrowseDetailsAdapter.ts"),
      "utf8",
    );

    expect(source).toContain("type HuggingFaceFetchInput = Parameters<typeof fetch>[0];");
    expect(source).not.toContain("RequestInfo");
  });

  it("keeps browser-only shared UI out of the server compiler source set", () => {
    const tsconfig = JSON.parse(
      readFileSync(path.resolve("apps/server/tsconfig.json"), "utf8"),
    ) as { exclude?: string[] };

    expect(tsconfig.exclude).toContain("../../modules/ui/**");
  });

  it("does not override an explicit ComfyUI Python command in the dev runner", async () => {
    const { resolveBundledDevPythonCommand } = await import("../../../../dev-tools/scripts/server/dev-server.mjs");
    expect(resolveBundledDevPythonCommand({ USERPROFILE: "C:/Users/example", COMFYUI_PYTHON_COMMAND: "python3.12" } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(resolveBundledDevPythonCommand({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("awaits the compiled async server factory before creating the listener", async () => {
    const { startCompiledServer } = await import("../../../../dev-tools/scripts/server/dev-server.mjs");
    const env = { PORT: "43110" };
    const createdServer = {
      app: {},
      config: {
        port: 43110,
        storageRootDirectory: "storage-root",
        runtimeRootDirectory: "runtime-root",
        security: { httpsEnabled: true },
      },
      loggingPort: {
        log: testDouble.fn(),
      },
    };
    const listener = Object.assign(new EventEmitter(), {
      listen: testDouble.fn((port: number, callback: () => void) => {
        callback();
        return listener;
      }),
      close: testDouble.fn((callback: (error?: Error) => void) => {
        callback();
      }),
    });
    const createServer = testDouble.fn(async (options: { env: typeof env; restartServer?: () => void }) => {
      expect(options.env).toBe(env);
      expect(options.restartServer).toBeUndefined();
      return createdServer;
    });
    const createServerListener = testDouble.fn((actualCreatedServer: typeof createdServer) => {
      expect(actualCreatedServer).toBe(createdServer);
      return listener;
    });
    const requireFromRoot = Object.assign(
      testDouble.fn(() => ({
        createServer,
        createServerListener,
      })),
      {
        cache: {
          [path.resolve("dist/apps/server/src/createServer.js")]: {},
        },
      },
    );
    const stderr = { write: testDouble.fn() };

    const startedListener = await startCompiledServer({
      paths: {
        distRootDirectory: path.resolve("dist"),
        serverCreateServerPath: path.resolve("apps/server/src/createServer.ts"),
      },
      env,
      stderr,
      requireFromRoot,
    });

    expect(startedListener).toBe(listener);
    expect(createServer).toHaveBeenCalledOnce();
    expect(createServerListener).toHaveBeenCalledWith(createdServer);
    expect(listener.listen).toHaveBeenCalledWith(43110, expect.any(Function));
    expect(createdServer.loggingPort.log).toHaveBeenCalledWith({
      timestamp: expect.any(String),
      level: "info",
      verbosity: "normal",
      event: "server.https.listening",
      host: "server",
      component: "server-host",
      message: "Server HTTPS listener started.",
      data: {
        port: 43110,
        transport: "https",
        storageRootDirectory: "storage-root",
        runtimeRootDirectory: "runtime-root",
      },
    });
  });
});
