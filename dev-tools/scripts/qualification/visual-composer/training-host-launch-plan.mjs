import path from "node:path";

export const TRAINING_PYTHON_RELATIVE = "artifacts/tmp/lancedb-python312-ai-runtime/Scripts/python.exe";
export const TRAINING_WORKER_ARGS = "-I -B ../../../../dev-tools/scripts/qualification/visual-composer/training-qualification-worker.py";
const deny = () => { throw new Error("The fixed training launch plan is invalid."); };
const runtimeKeys = new Set([
  "PYTHON_RUNTIME_COMMAND", "PYTHON_RUNTIME_ARGS", "PYTHON_RUNTIME_WORKER_DIR", "PYTHON_RUNTIME_QUALIFICATION_SCENARIO",
  "VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION", "HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE",
  "PIP_NO_INDEX", "PIP_REQUIRE_HASHES", "PIP_DISABLE_PIP_VERSION_CHECK", "PIP_CONFIG_FILE", "CUDA_VISIBLE_DEVICES", "HIP_VISIBLE_DEVICES",
  "OMP_NUM_THREADS", "MKL_NUM_THREADS",
]);
const secrets = new Set(["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "HUGGINGFACEHUB_API_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]);
export function trainingAcquisition(input) {
  if (typeof input !== "string" || !/^\.local-codex\/model-qualification\/qwen-[a-f0-9-]{36}\/acquisition\.json$/.test(input)) deny();
  return input;
}
function root(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\0\r\n]/.test(value) || path.resolve(value) !== value) deny();
  return value;
}
function runtimeEnvironment(environment, repoRoot, acquisition) {
  const result = {};
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value === "string" && !runtimeKeys.has(key.toUpperCase()) && !secrets.has(key.toUpperCase())) result[key] = value;
  }
  return Object.assign(result, {
    PYTHON_RUNTIME_COMMAND: path.join(repoRoot, TRAINING_PYTHON_RELATIVE),
    PYTHON_RUNTIME_ARGS: TRAINING_WORKER_ARGS,
    PYTHON_RUNTIME_WORKER_DIR: path.join(repoRoot, "out/ai-system-builder-win32-x64/resources/worker"),
    PYTHON_RUNTIME_QUALIFICATION_SCENARIO: "training-model-host",
    VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION: trainingAcquisition(acquisition),
    HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1", PIP_NO_INDEX: "1", PIP_REQUIRE_HASHES: "1",
    PIP_DISABLE_PIP_VERSION_CHECK: "1", PIP_CONFIG_FILE: "NUL",
    OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1",
  });
}
/** Trusted qualification composition only. Input admission and dependency probes run separately. */
export function createTrainingHostLaunchPlan({ acquisition, ...options }) {
  trainingAcquisition(acquisition);
  // Loading pure case bindings in Playwright's CommonJS collector must not load
  // the ESM lifecycle's import.meta entry point. Only trusted setup needs it.
  return import("./visual-composer-host-lifecycle.mjs").then(({ createVisualComposerHostLaunchPlan }) => {
    const plan = createVisualComposerHostLaunchPlan(options), repoRoot = root(plan.repoRoot);
    plan.desktop.env = runtimeEnvironment(plan.desktop.env, repoRoot, acquisition);
    plan.desktop.seed.env = runtimeEnvironment(plan.desktop.seed.env, repoRoot, acquisition);
    return plan;
  });
}
export function createTrainingCaseEnvironment(environment, repoRoot, dataRoot, acquisition) {
  root(repoRoot); root(dataRoot); trainingAcquisition(acquisition);
  const fence = path.join(repoRoot, "artifacts/qualification/visual-composer/d"), relative = path.relative(fence, dataRoot);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`) || path.basename(dataRoot) !== "training" || relative.split(path.sep).length > 5) deny();
  const cache = path.join(dataRoot, "controlled-model-cache"), temp = path.join(dataRoot, "training-temp");
  const roots = new Set(["HF_HUB_CACHE", "HF_HOME", "HF_DATASETS_CACHE", "TRANSFORMERS_CACHE", "TORCH_HOME", "TORCHINDUCTOR_CACHE_DIR", "TRITON_CACHE_DIR", "XDG_CACHE_HOME", "TEMP", "TMP"]);
  const base = runtimeEnvironment(environment, repoRoot, acquisition);
  for (const key of Object.keys(base)) if (roots.has(key.toUpperCase())) delete base[key];
  return Object.assign(base, {
    VISUAL_COMPOSER_DESKTOP_DATA_ROOT: dataRoot, HF_HUB_CACHE: cache, HF_HOME: path.join(cache, "hf-home"),
    HF_DATASETS_CACHE: path.join(cache, "datasets"), TRANSFORMERS_CACHE: path.join(cache, "transformers"),
    TORCH_HOME: path.join(cache, "torch"), TORCHINDUCTOR_CACHE_DIR: path.join(cache, "torch-inductor"),
    TRITON_CACHE_DIR: path.join(cache, "triton"), XDG_CACHE_HOME: path.join(cache, "xdg"), TEMP: temp, TMP: temp,
  });
}
