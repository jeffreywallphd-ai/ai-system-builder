import path from "node:path";
import { spawnSync } from "node:child_process";
import { createTrainingHostLaunchPlan } from "./training-host-launch-plan.mjs";
import { startVisualComposerQualification } from "./visual-composer-global-setup.mjs";
import { readAssetSystemSourceIdentity, assertAssetSystemSourceIdentity } from "../asset-system-source-identity.mjs";

/** Dedicated opt-in; missing inputs do not build, launch or qualify an app. */
export default async function trainingHostSetup(config) {
  delete process.env.VISUAL_COMPOSER_TRAINING_READY;
  if (process.platform !== "win32" || !process.env.VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION) return async () => {};
  if (config.projects.length !== 1 || config.projects[0].name !== "packaged-desktop") throw new Error("Training requires its fixed Desktop project.");
  const plan = await createTrainingHostLaunchPlan({ acquisition: process.env.VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION });
  const source = await readAssetSystemSourceIdentity(plan.repoRoot);
  const result = spawnSync(process.execPath, ["--import", "tsx", path.join(plan.repoRoot, "dev-tools/scripts/qualification/visual-composer/training-host-fixture.ts"), "--inspect-prerequisites"], {
    cwd: plan.repoRoot, env: plan.desktop.env, windowsHide: true, encoding: "utf8", timeout: 5 * 60_000, maxBuffer: 8192,
  });
  await assertAssetSystemSourceIdentity(plan.repoRoot, source);
  let facts;
  try { facts = JSON.parse(result.stdout); } catch { /* Fixed unavailable state below. */ }
  if (result.error || result.status !== 0 || facts?.schemaVersion !== "training-host-readiness-v1" || facts?.status !== "inputs-and-dependencies-verified" || facts?.accuracyExecuted !== false) {
    process.stdout.write("Training host qualification is pending: fixed local inputs or dependencies are unavailable. No installation or app launch was attempted.\n");
    return async () => assertAssetSystemSourceIdentity(plan.repoRoot, source);
  }
  const teardown = await startVisualComposerQualification(config, plan);
  // Fixed trusted runtime flags do not flow through the ordinary host projection.
  for (const [key, value] of Object.entries(plan.desktop.env)) {
    if (/^(?:PYTHON_RUNTIME_QUALIFICATION_SCENARIO|VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION|HF_HUB_OFFLINE|TRANSFORMERS_OFFLINE|HF_DATASETS_OFFLINE|PIP_NO_INDEX|PIP_REQUIRE_HASHES|PIP_DISABLE_PIP_VERSION_CHECK|PIP_CONFIG_FILE|CUDA_VISIBLE_DEVICES|HIP_VISIBLE_DEVICES|OMP_NUM_THREADS|MKL_NUM_THREADS)$/.test(key)) process.env[key] = value;
  }
  process.env.VISUAL_COMPOSER_TRAINING_READY = "1";
  return teardown;
}
