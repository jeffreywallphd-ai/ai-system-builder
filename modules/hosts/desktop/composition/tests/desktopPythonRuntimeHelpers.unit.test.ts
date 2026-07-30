import { describe, expect, it } from "../../../../testing/node-test";

import {
  resolvePythonRuntimeBaseUrl,
  resolvePythonRuntimeHostAndPort,
  shouldPreparePythonRuntimeWorkerDependencies,
} from "../desktopPythonRuntimeHelpers";

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
});
