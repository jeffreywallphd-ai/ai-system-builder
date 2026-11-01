import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import trainingHostSetup from "../visual-composer/training-host-global-setup.mjs";

// This .mjs file also runs alone without the catalog's optional --import loader.
const fixtureModule = await tsImport("../visual-composer/training-host-fixture.ts", import.meta.url);
const { trainingDependencyProbe, trainingReadOnlyArguments } = fixtureModule.default ?? fixtureModule;

test("fixed dependency probe literals match JavaScript template newline semantics", () => {
  for (const newline of ["\n", "\r\n", "\r"]) {
    const source = `const PROBE = \`${newline}line1${newline}line2${newline}\`.trim();`;
    assert.equal(trainingDependencyProbe(source, "PROBE"), "line1\nline2");
  }
  for (const source of ["", 'const PROBE = "unknown";', 'const PROBE = `a`.trim(); const PROBE = `b`.trim();'])
    assert.throws(() => trainingDependencyProbe(source, "PROBE"));
});

test("the actual Context preparer passes its exact evaluated probe to the no-install delegate", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const location = path.join(root, "modules/adapters/runtime/python/ensurePythonRuntimeContextDependencies.ts");
  const imported = await tsImport(pathToFileURL(location).href, import.meta.url);
  const context = imported.default ?? imported;
  const probes = new Set([trainingDependencyProbe(readFileSync(location, "utf8"), "CONTEXT_DEPENDENCY_PROBE_SCRIPT")]);
  let calls = 0;
  const result = await context.ensurePythonRuntimeContextDependencies({
    command: "synthetic-readonly-python", platform: "win32",
    execFileImplementation: (command, args, _options, callback) => {
      calls += 1;
      assert.equal(command, "synthetic-readonly-python");
      assert.equal(trainingReadOnlyArguments(args, probes), true);
      callback(null, "ASB_CONTEXT_DEPENDENCY_READY\n", "");
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { installed: false, version: "0.34.0" });
  assert.equal(trainingReadOnlyArguments(["-m", "pip", "install", "lancedb"], probes), false);
  assert.equal(trainingReadOnlyArguments(["-c", "unknown-probe"], probes), false);
});

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
import { createTrainingHostLaunchPlan, createTrainingCaseEnvironment, trainingAcquisition, trainingInputIdentity, TRAINING_PYTHON_RELATIVE, TRAINING_WORKER_ARGS } from "../visual-composer/training-host-launch-plan.mjs";

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

const tinyAcquisition = ".local-codex/training-inputs/tiny-01234567-89ab-cdef-0123-456789abcdef/input.json", manifestHash = "a".repeat(64);
test("generated inputs require an explicit frozen manifest hash and distinct local identity", () => {
  const identity = trainingInputIdentity(tinyAcquisition, manifestHash);
  assert.deepEqual(identity, { profile: "generated-tiny-qwen2-v1", modelId: "aisb-testing/tiny-qwen2-v1", provider: "unknown", displayName: "Generated tiny training input", manifestHash });
  assert(Object.isFrozen(identity)); assert.equal(trainingAcquisition(tinyAcquisition), tinyAcquisition);
  for (const value of [undefined, "", "0".repeat(63), "A".repeat(64), manifestHash + "\n", {}]) assert.throws(() => trainingInputIdentity(tinyAcquisition, value));
  assert.throws(() => trainingInputIdentity(acquisition, manifestHash));
  for (const value of [tinyAcquisition.replace("tiny-", "other-"), tinyAcquisition.replace("input.json", "acquisition.json"), tinyAcquisition.replace("01234567-89ab", "0123456789ab"), `${tinyAcquisition}\n`]) assert.throws(() => trainingAcquisition(value));
});

test("only the generated profile fixes device visibility and carries the declared hash into its isolated case", async () => {
  const dirty = { ...environment, CUDA_VISIBLE_DEVICES: "9", hip_visible_devices: "untrusted", visual_composer_training_input_sha256: "untrusted" };
  const plan = await createTrainingHostLaunchPlan({ repoRoot, runId, environment: dirty, acquisition: tinyAcquisition, manifestHash });
  for (const env of [plan.desktop.env, plan.desktop.seed.env]) {
    assert.equal(env.CUDA_VISIBLE_DEVICES, "0"); assert.equal(env.HIP_VISIBLE_DEVICES, "");
    assert.equal(env.VISUAL_COMPOSER_TRAINING_INPUT_SHA256, manifestHash);
    assert(!("hip_visible_devices" in env)); assert(!("visual_composer_training_input_sha256" in env)); assert(!("HF_TOKEN" in env));
  }
  const dataRoot = path.join(repoRoot, "artifacts/qualification/visual-composer/d/test-run/desktop/training");
  const child = createTrainingCaseEnvironment(plan.desktop.env, repoRoot, dataRoot, tinyAcquisition);
  assert.equal(child.VISUAL_COMPOSER_TRAINING_INPUT_SHA256, manifestHash);
  assert.equal(child.CUDA_VISIBLE_DEVICES, "0"); assert.equal(child.HIP_VISIBLE_DEVICES, "");
  assert.equal(child.TEMP, path.join(dataRoot, "training-temp"));
  assert.throws(() => createTrainingHostLaunchPlan({ repoRoot, runId, environment: dirty, acquisition: tinyAcquisition }));
});

const packagedRoot = path.join(repoRoot, ".local-codex/q/abc123ef/o/ai-system-builder-win32-x64");
test("a declared tiny training package keeps the wrapper in the original source even with repository spaces", async () => {
  const plan = await createTrainingHostLaunchPlan({ repoRoot, runId, environment, acquisition: tinyAcquisition, manifestHash, packagedRoot });
  const worker = path.join(packagedRoot, "resources/worker");
  for (const env of [plan.desktop.env, plan.desktop.seed.env]) {
    assert.equal(env.PYTHON_RUNTIME_WORKER_DIR, worker);
    assert.equal(env.VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT, packagedRoot);
    const args = env.PYTHON_RUNTIME_ARGS.split(" ");
    assert.deepEqual(args.slice(0, 2), ["-I", "-B"]); assert.equal(args.length, 3);
    assert(!/[\s"'\x00-\x1f]/u.test(args[2])); assert(!path.isAbsolute(args[2]));
    assert.equal(path.resolve(worker, args[2]), path.join(repoRoot, "dev-tools/scripts/qualification/visual-composer/training-qualification-worker.py"));
  }
  const dataRoot = path.join(repoRoot, "artifacts/qualification/visual-composer/d/test-run/desktop/training");
  const child = createTrainingCaseEnvironment(plan.desktop.env, repoRoot, dataRoot, tinyAcquisition);
  assert.equal(child.PYTHON_RUNTIME_WORKER_DIR, worker);
  assert.equal(child.PYTHON_RUNTIME_ARGS, plan.desktop.env.PYTHON_RUNTIME_ARGS);
});
test("fresh package context cannot select a foreign root or extend the original model profile", async () => {
  for (const value of ["", "relative/package", path.join(repoRoot, "out/ai-system-builder-win32-x64"), packagedRoot.replace("abc123ef", "abc123ef0"), path.join(repoRoot, ".local-codex/q/abc123ef/c/ai-system-builder-win32-x64"), packagedRoot + "\n", path.join(repoRoot, ".local-codex/q/abc123ef/o/other")]) {
    await assert.rejects(async () => createTrainingHostLaunchPlan({ repoRoot, runId, environment, acquisition: tinyAcquisition, manifestHash, packagedRoot: value }));
  }
  await assert.rejects(async () => createTrainingHostLaunchPlan({ repoRoot, runId, environment, acquisition, packagedRoot }));
});
test("ambient package hints do not change ordinary training and declared tiny context is checked again for the case", async () => {
  const dirty = { ...environment, VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT: "/foreign/package", visual_composer_training_packaged_root: "/other/package" };
  const ordinary = await createTrainingHostLaunchPlan({ repoRoot, runId, environment: dirty, acquisition });
  assert.equal(ordinary.desktop.env.PYTHON_RUNTIME_ARGS, TRAINING_WORKER_ARGS);
  assert.equal(ordinary.desktop.env.PYTHON_RUNTIME_WORKER_DIR, path.join(repoRoot, "out/ai-system-builder-win32-x64/resources/worker"));
  assert(!Object.keys(ordinary.desktop.env).some(key => key.toUpperCase() === "VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT"));
  const dataRoot = path.join(repoRoot, "artifacts/qualification/visual-composer/d/test-run/desktop/training");
  assert.throws(() => createTrainingCaseEnvironment({ ...dirty, VISUAL_COMPOSER_TRAINING_INPUT_SHA256: manifestHash }, repoRoot, dataRoot, tinyAcquisition));
});
