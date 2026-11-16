import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { checkDesktopPythonRuntimeInstallation, resolveDesktopPythonRuntimeLaunch } from "../desktopPythonRuntimeInstallation";

test("checks an intentionally configured alternate worker entry locally", () => {
  const launch = resolveDesktopPythonRuntimeLaunch({
    PYTHON_RUNTIME_COMMAND: process.execPath,
    PYTHON_RUNTIME_ARGS: "dev-tools/scripts/qualification/visual-composer/controlled-conversation-runtime-worker.mjs",
    PYTHON_RUNTIME_WORKER_DIR: process.cwd(),
  });
  assert.equal(checkDesktopPythonRuntimeInstallation(launch), "ready");
  assert.equal(checkDesktopPythonRuntimeInstallation({ ...launch, args: ["missing.mjs"] }), "incomplete");
  assert.equal(checkDesktopPythonRuntimeInstallation({ ...launch, args: ["../unowned.mjs"] }), "incomplete");
  const missingExecutable = resolve(launch.cwd, "missing-launcher", process.platform === "win32" ? "node.exe" : "node");
  assert.equal(checkDesktopPythonRuntimeInstallation({ ...launch, command: missingExecutable }), "missing");
});

test("blocks a managed launch without the bundled worker entry point", () => {
  const launch = resolveDesktopPythonRuntimeLaunch({
    PYTHON_RUNTIME_COMMAND: "python",
    PYTHON_RUNTIME_WORKER_DIR: resolve("missing-worker-fixture"),
  });
  assert.equal(checkDesktopPythonRuntimeInstallation(launch), "incomplete");
});

test("checks the selected Python worker script before probing its interpreter", () => {
  const cwd = resolve("dev-tools/scripts/qualification");
  const launch = resolveDesktopPythonRuntimeLaunch({
    PYTHON_RUNTIME_COMMAND: "../python",
    PYTHON_RUNTIME_ARGS: "-I -B visual-composer/ocr-qualification-worker.py",
    PYTHON_RUNTIME_WORKER_DIR: cwd,
  });
  assert.equal(launch.command, resolve(cwd, "../python"));
  assert.equal(checkDesktopPythonRuntimeInstallation(launch, {}, () => "ready"), "ready");
  for (const args of [[], ["-I", "missing.py"], ["-c", "visual-composer/ocr-qualification-worker.py"],
    ["-S", "visual-composer/ocr-qualification-worker.py"]]) {
    assert.equal(checkDesktopPythonRuntimeInstallation({ ...launch, args }, {}, () => {
      assert.fail("should not probe Python for an invalid worker script");
    }), "incomplete");
  }
});
