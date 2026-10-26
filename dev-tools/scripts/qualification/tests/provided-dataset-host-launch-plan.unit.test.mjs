import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createProvidedDatasetHostLaunchPlan } from "../visual-composer/provided-dataset-host-launch-plan.mjs";
import { createVisualComposerHostLaunchPlan } from "../visual-composer/visual-composer-host-lifecycle.mjs";

const root = path.resolve("synthetic repository with spaces");
const python = path.resolve("installed runtime", process.platform === "win32" ? "python.exe" : "python");
test("provided-data plan retains host identity/auth and uses the real fixed packaged processor", () => {
  const ordinary = createVisualComposerHostLaunchPlan({ repoRoot: root, runId: "provided-plan-test" });
  const plan = createProvidedDatasetHostLaunchPlan({ pythonExecutable: python, sourceRevision: `source.${"a".repeat(64)}`, repoRoot: root, runId: "provided-plan-test" });
  assert.equal(plan.server.command, ordinary.server.command);
  assert.deepEqual(plan.server.args.slice(0, -1), ordinary.server.args.slice(0, -1));
  assert.equal(path.basename(plan.server.args.at(-1)), "provided-dataset-server-entry.ts");
  for (const env of [plan.server.env, plan.desktop.env, plan.desktop.seed.env]) {
    assert.equal(env.PYTHON_RUNTIME_COMMAND, python);
    assert.equal(env.PYTHON_RUNTIME_ARGS, "-I -B ../../../../dev-tools/scripts/qualification/visual-composer/provided-dataset-qualification-worker.py");
    assert.equal(env.PYTHON_RUNTIME_WORKER_DIR, path.join(root, "out/ai-system-builder-win32-x64/resources/worker"));
    assert.equal(env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO, "dataset-profile");
    assert.equal(env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, `source.${"a".repeat(64)}`);
    for (const key of ["HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "PIP_NO_INDEX"]) assert.equal(env[key], "1");
    assert.equal(env.PYTHON_RUNTIME_HOST, "127.0.0.1");
  }
  assert.equal(plan.server.env.AI_SYSTEM_BUILDER_DEDICATED_ORGANIZATION_ID, "qualification.local");
  assert.notEqual(plan.server.env.PYTHON_RUNTIME_PORT, plan.desktop.env.PYTHON_RUNTIME_PORT);
  assert.equal(ordinary.server.env.PYTHON_RUNTIME_COMMAND, process.execPath);
});
test("provided-data plan rejects shells, relative paths and control characters", () => {
  for (const value of [undefined, "python", path.resolve("python.cmd"), `${python}\n`, `${python}\0`]) {
    assert.throws(() => createProvidedDatasetHostLaunchPlan({ pythonExecutable: value, sourceRevision: `source.${"a".repeat(64)}`, repoRoot: root }));
  }
});
test("provided-data plan requires a current exact source identity", () => {
  for (const sourceRevision of [undefined, "", "source." + "g".repeat(64), "HEAD"]) {
    assert.throws(() => createProvidedDatasetHostLaunchPlan({ pythonExecutable: python, sourceRevision, repoRoot: root }));
  }
});
