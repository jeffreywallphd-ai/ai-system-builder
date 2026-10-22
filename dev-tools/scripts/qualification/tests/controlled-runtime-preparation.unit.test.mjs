import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createControlledRuntimeEnvironmentPreparer } from "../visual-composer/controlled-runtime-preparation.mjs";

test("controlled server preparation accepts only the exact isolated worker launch", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "controlled-preparation-"));
  const runRoot = path.join(repoRoot, "artifacts/qualification/visual-composer/d/test-run/thin-runtime");
  await mkdir(runRoot, { recursive: true });
  const environment = { PYTHON_RUNTIME_HOST: "127.0.0.1", PYTHON_RUNTIME_PORT: "43173",
    PYTHON_RUNTIME_BASE_URL: "http://127.0.0.1:43173", HF_HUB_CACHE: path.join(runRoot, "controlled-model-cache") };
  const context = { command: process.execPath, args: ["dev-tools/scripts/qualification/visual-composer/controlled-conversation-runtime-worker.mjs"], cwd: repoRoot, env: environment };
  try {
    const prepare = createControlledRuntimeEnvironmentPreparer({ repoRoot, runRoot, environment });
    await prepare(context);
    for (const mismatch of [
      { command: "python" }, { args: [...context.args, "--extra"] },
      { cwd: os.tmpdir() }, { env: { ...environment, HF_HUB_CACHE: repoRoot } },
      { env: { ...environment, PYTHON_RUNTIME_BASE_URL: "http://127.0.0.1:43172" } },
      { env: { ...environment, PYTHON_RUNTIME_HOST: "0.0.0.0" } },
    ]) await assert.rejects(prepare({ ...context, ...mismatch }));
    assert.throws(() => createControlledRuntimeEnvironmentPreparer({ repoRoot, runRoot: os.tmpdir(), environment }));
    assert.throws(() => createControlledRuntimeEnvironmentPreparer({ repoRoot, runRoot, environment: { ...environment, PYTHON_RUNTIME_HOST: "0.0.0.0" } }));
  } finally { await rm(repoRoot, { recursive: true, force: true }); }
});
