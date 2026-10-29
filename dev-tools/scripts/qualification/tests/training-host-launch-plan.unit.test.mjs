import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import trainingHostSetup from "../visual-composer/training-host-global-setup.mjs";

test("missing declared inputs return a pending profile before package or app startup", async () => {
  const previous = process.env.VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION, ready = process.env.VISUAL_COMPOSER_TRAINING_READY;
  try {
    delete process.env.VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION;
    process.env.VISUAL_COMPOSER_TRAINING_READY = "stale";
    const cleanup = await trainingHostSetup({ projects: [{ name: "packaged-desktop" }] });
    assert.equal(process.env.VISUAL_COMPOSER_TRAINING_READY, undefined);
    assert.equal(typeof cleanup, "function"); await cleanup();
  } finally {
    if (previous === undefined) delete process.env.VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION; else process.env.VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION = previous;
    if (ready === undefined) delete process.env.VISUAL_COMPOSER_TRAINING_READY; else process.env.VISUAL_COMPOSER_TRAINING_READY = ready;
  }
});
import { createVisualComposerHostLaunchPlan } from "../visual-composer/visual-composer-host-lifecycle.mjs";
import { createTrainingHostLaunchPlan, createTrainingCaseEnvironment, trainingAcquisition, TRAINING_PYTHON_RELATIVE, TRAINING_WORKER_ARGS } from "../visual-composer/training-host-launch-plan.mjs";

const repoRoot = path.resolve("synthetic training repository with spaces"), runId = "synthetic-training-host-run-0123456789";
const acquisition = ".local-codex/model-qualification/qwen-01234567-89ab-cdef-0123-456789abcdef/acquisition.json";
const environment = { PATH: "synthetic-path", TEMP: "inherited-temp", PYTHON_RUNTIME_COMMAND: "private-override", python_runtime_args: "private-args", hf_hub_offline: "0", HF_TOKEN: "synthetic-private-credential", openai_api_key: "synthetic-private-other", ELECTRON_RUN_AS_NODE: "1" };
test("fixed Desktop training reuses the host plan and preserves ordinary server and browser launch", async () => {
  const original = createVisualComposerHostLaunchPlan({ repoRoot, runId, environment });
  const plan = await createTrainingHostLaunchPlan({ repoRoot, runId, environment, acquisition });
  assert.deepEqual(plan.server, original.server); assert.deepEqual(plan.thinClient, original.thinClient);
  assert.equal(plan.desktop.executablePath, original.desktop.executablePath);
  for (const env of [plan.desktop.env, plan.desktop.seed.env]) {
    assert.equal(env.PYTHON_RUNTIME_COMMAND, path.join(repoRoot, TRAINING_PYTHON_RELATIVE)); assert.equal(env.PYTHON_RUNTIME_ARGS, TRAINING_WORKER_ARGS);
    assert.equal(env.PYTHON_RUNTIME_WORKER_DIR, path.join(repoRoot, "out/ai-system-builder-win32-x64/resources/worker"));
    assert.equal(env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO, "training-model-host"); assert.equal(env.VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION, acquisition);
    for (const key of ["HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE", "PIP_NO_INDEX", "PIP_REQUIRE_HASHES"]) assert.equal(env[key], "1");
    assert.equal(env.CUDA_VISIBLE_DEVICES, undefined); assert.equal(env.HIP_VISIBLE_DEVICES, undefined);
    assert(!Object.keys(env).some(key => ["hf_token", "openai_api_key", "python_runtime_args", "hf_hub_offline"].includes(key)));
  }
  assert.equal(plan.desktop.seed.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(original.desktop.env.PYTHON_RUNTIME_COMMAND, process.execPath);
});
test("a literal training slot gets distinct private cache and temporary roots without touching files", () => {
  const dataRoot = path.join(repoRoot, "artifacts/qualification/visual-composer/d/test-run/desktop/training");
  const env = createTrainingCaseEnvironment({ ...environment, hf_hub_cache: "private-old-cache", Temp: "private-old-temp" }, repoRoot, dataRoot, acquisition);
  assert.equal(env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT, dataRoot); assert.equal(env.HF_HUB_CACHE, path.join(dataRoot, "controlled-model-cache"));
  assert.equal(env.TEMP, path.join(dataRoot, "training-temp")); assert.equal(env.TMP, env.TEMP);
  for (const key of ["HF_HOME", "HF_DATASETS_CACHE", "TRANSFORMERS_CACHE", "TORCH_HOME", "TORCHINDUCTOR_CACHE_DIR", "TRITON_CACHE_DIR", "XDG_CACHE_HOME"]) assert(env[key].startsWith(env.HF_HUB_CACHE + path.sep));
  assert(!("hf_hub_cache" in env)); assert(!("Temp" in env)); assert.equal(env.PATH, environment.PATH);
});
test("caller paths and other model families cannot become a launch selector", () => {
  for (const value of [undefined, "", "../private", acquisition.replace("qwen-", "qwen15-"), acquisition.replace("/acquisition.json", "/model.py"), `${acquisition}\n`, acquisition.replaceAll("/", "\\")]) {
    assert.throws(() => trainingAcquisition(value), /fixed training launch plan is invalid/);
    assert.throws(() => createTrainingHostLaunchPlan({ repoRoot, runId, acquisition: value }));
  }
  for (const value of [path.resolve(".local-codex/private/training"), path.join(repoRoot, "artifacts/qualification/visual-composer/d/test-run/desktop/other"), "relative/training", `${repoRoot}\n`]) assert.throws(() => createTrainingCaseEnvironment(environment, repoRoot, value, acquisition));
});
