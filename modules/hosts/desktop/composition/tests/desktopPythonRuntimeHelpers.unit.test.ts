import { describe, expect, it } from "../../../../testing/node-test";

import {
  resolveDesktopPythonRuntimeCommand,
  resolveDesktopPythonRuntimeWorkerDirectory,
  resolvePythonRuntimeBaseUrl,
  resolvePythonRuntimeHostAndPort,
  shouldPreparePythonRuntimeWorkerDependencies,
} from "../desktopPythonRuntimeHelpers";

const pythonProbe = (
  version: string,
  executable: string,
  status = 0,
) =>
  ({
    status,
    stdout:
      status === 0
        ? JSON.stringify({
            major: Number(version.split(".")[0]),
            minor: Number(version.split(".")[1]),
            executable,
          })
        : "",
  }) as never;

describe("desktop Python runtime endpoint ownership", () => {
  it("uses one canonical loopback endpoint for the client and worker", () => {
    const env = { PYTHON_RUNTIME_BASE_URL: "http://localhost:45111" };
    expect(resolvePythonRuntimeBaseUrl(env)).toBe("http://127.0.0.1:45111");
    expect(resolvePythonRuntimeHostAndPort(env)).toEqual({
      host: "127.0.0.1",
      port: "45111",
    });
  });

  it("rejects attempts to expose the managed worker beyond loopback", () => {
    expect(() =>
      resolvePythonRuntimeBaseUrl({
        PYTHON_RUNTIME_BASE_URL: "http://192.168.1.50:45111",
      }),
    ).toThrow("loopback");
    expect(() =>
      resolvePythonRuntimeHostAndPort({
        PYTHON_RUNTIME_HOST: "0.0.0.0",
        PYTHON_RUNTIME_PORT: "45111",
      }),
    ).toThrow("loopback");
  });

  it("prepares dependencies only for Python worker commands", () => {
    expect(shouldPreparePythonRuntimeWorkerDependencies("python")).toBe(true);
    expect(
      shouldPreparePythonRuntimeWorkerDependencies("C:\\Python312\\python.exe"),
    ).toBe(true);
    expect(shouldPreparePythonRuntimeWorkerDependencies("python3.12")).toBe(
      true,
    );
    expect(shouldPreparePythonRuntimeWorkerDependencies("node")).toBe(false);
    expect(
      shouldPreparePythonRuntimeWorkerDependencies(
        "C:\\Program Files\\nodejs\\node.exe",
      ),
    ).toBe(false);
  });

  it("prefers an installed decoder-compatible Python over an unsupported default", () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const resolved = resolveDesktopPythonRuntimeCommand({
      platform: "win32",
      exists: (candidate) => candidate === "C:\\Python312\\python.exe",
      spawnSyncImplementation: ((command: string, args: readonly string[]) => {
        calls.push({ command, args });
        if (command === "python") {
          return pythonProbe("3.14", "C:\\Python314\\python.exe");
        }
        if (args[0] === "-3.12") {
          return pythonProbe("3.12", "C:\\Python312\\python.exe");
        }
        return pythonProbe("0.0", "", 1);
      }) as never,
    });

    expect(resolved).toBe("C:\\Python312\\python.exe");
    expect(calls.some((call) => call.args[0] === "-3.12")).toBe(true);
  });

  it("preserves an explicit command and falls back when no compatible Python is installed", () => {
    let explicitProbeCount = 0;
    expect(
      resolveDesktopPythonRuntimeCommand({
        configuredCommand: "C:\\managed\\python.exe",
        spawnSyncImplementation: (() => {
          explicitProbeCount += 1;
          return pythonProbe("3.12", "C:\\managed\\python.exe");
        }) as never,
      }),
    ).toBe("C:\\managed\\python.exe");
    expect(explicitProbeCount).toBe(0);

    expect(
      resolveDesktopPythonRuntimeCommand({
        platform: "win32",
        exists: () => false,
        spawnSyncImplementation: (() =>
          pythonProbe("3.14", "C:\\Python314\\python.exe")) as never,
      }),
    ).toBe("python");
  });

  it("uses the packaged worker when its entry point exists", () => {
    expect(
      resolveDesktopPythonRuntimeWorkerDirectory({
        resourcesPath: "C:\\Program Files\\AI System Builder\\resources",
        exists: (candidate) => candidate.endsWith("worker\\main.py"),
      }),
    ).toBe("C:\\Program Files\\AI System Builder\\resources\\worker");
  });

  it("preserves explicit worker configuration and development fallback", () => {
    expect(
      resolveDesktopPythonRuntimeWorkerDirectory({
        configuredWorkerDirectory: "custom/worker",
        cwd: "C:\\workspace",
      }),
    ).toBe("C:\\workspace\\custom\\worker");
    expect(
      resolveDesktopPythonRuntimeWorkerDirectory({
        resourcesPath: "C:\\missing",
        exists: () => false,
      }),
    ).toBe("modules/adapters/runtime/python/worker");
  });
});
