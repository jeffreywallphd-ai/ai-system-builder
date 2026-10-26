import assert from "node:assert/strict";
import path from "node:path";
import { createVisualComposerHostLaunchPlan } from "./visual-composer-host-lifecycle.mjs";

// Trusted qualification composition only; no product or public CLI selector.
// The owning fixed operator separately binds the installed Python's exact bytes.
export function createOcrHostLaunchPlan({ pythonExecutable, ...options }) {
  assert.equal(typeof pythonExecutable, "string");
  assert.ok(path.isAbsolute(pythonExecutable));
  assert.ok(["python", "python.exe"].includes(path.basename(pythonExecutable).toLowerCase()));
  assert.ok(!/[\0\r\n]/.test(pythonExecutable));
  const plan = createVisualComposerHostLaunchPlan(options);
  const workerDirectory = path.join(plan.repoRoot, "out/ai-system-builder-win32-x64/resources/worker");
  for (const env of [plan.server.env, plan.desktop.env, plan.desktop.seed.env]) {
    Object.assign(env, {
      PYTHON_RUNTIME_COMMAND: pythonExecutable,
      // Hosts tokenize this existing setting on spaces. A fixed relative path
      // keeps repositories with spaces valid without changing that contract.
      PYTHON_RUNTIME_ARGS: "-I -B ../../../../dev-tools/scripts/qualification/visual-composer/ocr-qualification-worker.py",
      PYTHON_RUNTIME_WORKER_DIR: workerDirectory,
      PYTHON_RUNTIME_QUALIFICATION_SCENARIO: "ocr-documents",
      HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", PIP_NO_INDEX: "1",
    });
  }
  return plan;
}
