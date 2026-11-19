import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { contextDefaultPortLaunch } from "../visual-composer/headless-context-default-port.mjs";

test("default-port launcher admits one fixed real case with no arbitrary arguments", () => {
  const launch = contextDefaultPortLaunch();
  assert.equal(launch.endpointProfile, "os-selected-default");
  assert.deepEqual(launch.args, ["test", "--config=dev-tools/config/playwright.visual-composer.config.ts",
    "--project=packaged-desktop", "--workers=1", "--grep",
    "approves saves queries rebuilds and reveals real Context through MCP", "packaged-desktop-headless.e2e.spec.ts"]);
  assert.ok(Object.isFrozen(launch)); assert.ok(Object.isFrozen(launch.args));
  for (const args of [["--pass-with-no-tests"], ["--grep", ".*"], null, "arbitrary"]) {
    assert.throws(() => contextDefaultPortLaunch(args));
  }
});

test("actual default profile removes all explicit endpoint inputs and records its finite profile", () => {
  const body = readFileSync(new URL("../visual-composer/e2e/headless-context-journey.ts", import.meta.url), "utf8");
  assert.match(body, /endpointProfile === "os-selected-default" \? \{\} : contextFixtureRuntimeEndpoint\(process\.env\)/);
  assert.match(body, /for \(const key of \["PYTHON_RUNTIME_HOST", "PYTHON_RUNTIME_PORT", "PYTHON_RUNTIME_BASE_URL"\]\) delete/);
  assert.match(body, /endpointProfile, journeyPassed, cleanupPassed/);
  assert.match(body, /physicalWorkersNativeObserved\)\.toBe\(outcome\.physicalWorkersObserved\)/);
  assert.match(body, /physicalWorkersPidAbsenceObserved\)\.toBe\(0\)/);
});
