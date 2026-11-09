import assert from "node:assert/strict";
import { test } from "node:test";
import { composeDesktopHost } from "../composeDesktopHost";
test("actual Desktop status neither composes an absent foundation nor loses a rejected composition", async () => {
  const previous = process.env.PYTHON_RUNTIME_BASE_URL;
  process.env.PYTHON_RUNTIME_BASE_URL = "https://invalid.example.invalid:9999";
  try {
    const host = composeDesktopHost();
    const initial = await host.readPythonRuntimeStatus();
    assert.equal(initial.startupDiagnostics?.outcome, "not-observed");
    assert.equal(initial.supervisorStatus, "stopped");
    await assert.rejects(host.startPythonRuntime());
    const failed = await host.readPythonRuntimeStatus();
    assert.equal(failed.supervisorStatus, "failed"); assert.equal(failed.startupDiagnostics?.phase, "composition");
    assert.equal(failed.startupDiagnostics?.pythonVersion, undefined);
    assert.deepEqual((await host.readPythonRuntimeStatus()).startupDiagnostics, failed.startupDiagnostics);
    await assert.rejects(host.startPythonRuntime());
    assert.deepEqual((await host.readPythonRuntimeStatus()).startupDiagnostics, failed.startupDiagnostics);
  } finally { if (previous === undefined) delete process.env.PYTHON_RUNTIME_BASE_URL; else process.env.PYTHON_RUNTIME_BASE_URL = previous; }
});
