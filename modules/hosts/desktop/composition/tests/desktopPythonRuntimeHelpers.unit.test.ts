import { describe, expect, it } from "../../../../testing/node-test";

import {
  resolvePythonRuntimeBaseUrl,
  resolvePythonRuntimeHostAndPort,
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
    expect(() => resolvePythonRuntimeBaseUrl({
      PYTHON_RUNTIME_BASE_URL: "http://192.168.1.50:45111",
    })).toThrow("loopback");
    expect(() => resolvePythonRuntimeHostAndPort({
      PYTHON_RUNTIME_HOST: "0.0.0.0",
      PYTHON_RUNTIME_PORT: "45111",
    })).toThrow("loopback");
  });
});
