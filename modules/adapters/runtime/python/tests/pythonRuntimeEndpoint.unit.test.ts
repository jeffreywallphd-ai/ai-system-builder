import { describe, expect, it } from "../../../../testing/node-test";

import {
  normalizePythonRuntimeLoopbackBaseUrl,
  resolvePythonRuntimeLoopbackEndpoint,
} from "../config/pythonRuntimeEndpoint";

describe("Python runtime loopback endpoint", () => {
  it("canonicalizes supported loopback names to the host-owned interface", () => {
    expect(normalizePythonRuntimeLoopbackBaseUrl("http://localhost:43111"))
      .toBe("http://127.0.0.1:43111");
    expect(normalizePythonRuntimeLoopbackBaseUrl("http://[::1]:43112"))
      .toBe("http://127.0.0.1:43112");
  });

  it("rejects remote, wildcard, credentialed, TLS, path, query, fragment, and privileged endpoints", () => {
    for (const value of [
      "http://0.0.0.0:43111",
      "http://192.168.1.20:43111",
      "http://example.com:43111",
      "http://user:secret@127.0.0.1:43111",
      "https://127.0.0.1:43111",
      "http://127.0.0.1:43111/runtime",
      "http://127.0.0.1:43111?token=secret",
      "http://127.0.0.1:43111/#fragment",
      "http://127.0.0.1:80",
    ]) {
      expect(() => normalizePythonRuntimeLoopbackBaseUrl(value)).toThrow();
    }
  });

  it("derives one canonical bind and client endpoint and rejects conflicting host inputs", () => {
    expect(resolvePythonRuntimeLoopbackEndpoint({
      env: { PYTHON_RUNTIME_BASE_URL: "http://localhost:43112" },
      defaultPort: "43111",
    })).toEqual({
      host: "127.0.0.1",
      port: "43112",
      baseUrl: "http://127.0.0.1:43112",
    });
    expect(() => resolvePythonRuntimeLoopbackEndpoint({
      env: { PYTHON_RUNTIME_HOST: "0.0.0.0", PYTHON_RUNTIME_PORT: "43112" },
      defaultPort: "43111",
    })).toThrow();
    expect(() => resolvePythonRuntimeLoopbackEndpoint({
      env: { PYTHON_RUNTIME_BASE_URL: "http://127.0.0.1:43112", PYTHON_RUNTIME_PORT: "43113" },
      defaultPort: "43111",
    })).toThrow();
  });
});
