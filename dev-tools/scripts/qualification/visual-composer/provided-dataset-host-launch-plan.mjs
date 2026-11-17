import assert from "node:assert/strict";
import path from "node:path";
import { createVisualComposerHostLaunchPlan } from "./visual-composer-host-lifecycle.mjs";

// Private, separately reviewed qualification composition. No public selector.
export function createProvidedDatasetHostLaunchPlan({ pythonExecutable, sourceRevision, ...options }) {
  assert.equal(typeof pythonExecutable, "string");
  assert.ok(path.isAbsolute(pythonExecutable));
  assert.ok(["python", "python.exe"].includes(path.basename(pythonExecutable).toLowerCase()));
  assert.ok(!/[\0\r\n]/.test(pythonExecutable));
  assert.match(sourceRevision ?? "", /^source\.[a-f0-9]{64}$/);
  const plan = createVisualComposerHostLaunchPlan(options);
  plan.server.args[plan.server.args.length - 1] = path.join(plan.repoRoot,
    "dev-tools/scripts/qualification/visual-composer/provided-dataset-server-entry.ts");
  for (const env of [plan.server.env, plan.desktop.env, plan.desktop.seed.env]) {
    Object.assign(env, {
      PYTHON_RUNTIME_COMMAND: pythonExecutable,
      PYTHON_RUNTIME_ARGS: "-I -B ../../../../dev-tools/scripts/qualification/visual-composer/provided-dataset-qualification-worker.py",
      PYTHON_RUNTIME_WORKER_DIR: path.join(plan.repoRoot, "out/ai-system-builder-win32-x64/resources/worker"),
      PYTHON_RUNTIME_QUALIFICATION_SCENARIO: "dataset-profile",
      HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", PIP_NO_INDEX: "1",
      VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION: sourceRevision,
    });
  }
  return plan;
}
