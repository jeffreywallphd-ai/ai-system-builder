import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import {createFunctionalHostEnvironment,functionalHostLayout} from "../functional-host-launch-plan.mjs";
import {createSettingsHostEnvironment,settingsHostLayout} from "../settings-host-launch-plan.mjs";

// Each case exercises a fresh installed profile; a preceding case's persisted
// workspace selection must not hide startup or change another case's outcome.
export function prepareIsolatedDesktopCase(caseId: "functional-model-reference" | "settings-public-values" | "settings-secret-defaults" | "image-create-register" | "image-task-recovery" | "training" | "operational" | "operational-native400" | "ingestion-native400" | "dataset-native400" | "structured-output-native400" | "browse-native400" | "lifecycle-native400" | "ocr-native400" | "assets" | "assets-zoom" | "browse" | "meaningful" | "lifecycle" | "pdf" | "dataset" | "ingestion" | "ocr" | "tasks" | "reference" | "worker-exit" | "worker-disconnect" | "cold", sampleIndex?: number) {
  assert.ok(["functional-model-reference", "settings-public-values", "settings-secret-defaults", "image-create-register", "image-task-recovery", "training", "operational", "operational-native400", "ingestion-native400", "dataset-native400", "structured-output-native400", "browse-native400", "lifecycle-native400", "ocr-native400", "assets", "assets-zoom", "browse", "meaningful", "lifecycle", "pdf", "dataset", "ingestion", "ocr", "tasks", "reference", "worker-exit", "worker-disconnect", "cold"].includes(caseId));
  assert.ok(caseId === "cold" ? Number.isInteger(sampleIndex) && sampleIndex! >= 0 && sampleIndex! < 35 : sampleIndex === undefined);
  const base = process.env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT!;
  assert.ok(base && path.isAbsolute(base));
  assert.ok(path.resolve(base).replaceAll("\\", "/").includes("/artifacts/qualification/visual-composer/d/"));
  const functionalCase=caseId==="functional-model-reference";
  const settingsCase=caseId==="settings-public-values"?"public-values":caseId==="settings-secret-defaults"?"secret-defaults":undefined;
  const run=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!,source=process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION!;
  if(functionalCase&&base!==functionalHostLayout(process.cwd(),run,source).desktopDataRoot)throw new Error("Functional tests require their exact fresh run root.");
  if(settingsCase&&base!==settingsHostLayout(process.cwd(),run,source).desktopDataRoot)throw new Error("Settings requires its exact fresh run root.");
  const environment=functionalCase?createFunctionalHostEnvironment(process.env,process.cwd(),run,source,"packaged-desktop","model-reference"):settingsCase?createSettingsHostEnvironment(process.env,process.cwd(),run,source,"packaged-desktop",settingsCase):process.env;
  const dataRoot = path.join(base, caseId === "cold" ? `cold-${sampleIndex}` : caseId);
  if (functionalCase || settingsCase || caseId === "image-create-register" || caseId === "image-task-recovery" || caseId === "training" || caseId === "operational" || caseId === "operational-native400" || caseId === "ingestion-native400" || caseId === "dataset-native400" || caseId === "structured-output-native400" || caseId === "browse-native400" || caseId === "lifecycle-native400" || caseId === "ocr-native400" || caseId === "assets" || caseId === "assets-zoom") {
    const fence = path.resolve("artifacts/qualification/visual-composer/d");
    const relativeRoot = path.relative(fence, path.resolve(base));
    assert.ok(relativeRoot && !path.isAbsolute(relativeRoot) && relativeRoot !== ".." && !relativeRoot.startsWith(`..${path.sep}`), "Operational qualification must remain under this repository's isolated run root.");
    if ((functionalCase || settingsCase || caseId === "training" || caseId === "image-create-register" || caseId === "image-task-recovery") && realpathSync(base) !== path.resolve(base)) throw new Error("Training qualification requires its existing physical run root.");
    if (lstatSync(dataRoot, { throwIfNoEntry: false }) !== undefined) throw new Error("An existing operational profile requires a fresh qualification run.");
  }
  const result = spawnSync(process.env.VISUAL_COMPOSER_ELECTRON_NODE_EXECUTABLE!, [
    "--preserve-symlinks", "--preserve-symlinks-main", "--import", "tsx",
    path.resolve("dev-tools/scripts/qualification/visual-composer/visual-composer-desktop-seed.ts"),
  ], { cwd: process.cwd(), env: { ...environment, VISUAL_COMPOSER_DESKTOP_DATA_ROOT: dataRoot, VISUAL_COMPOSER_LARGE_FIXTURE:caseId==="reference"?"1":"0", ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, "isolated desktop case identity seed must succeed");
  return { dataRoot, env: { ...environment, VISUAL_COMPOSER_DESKTOP_DATA_ROOT: dataRoot, HF_HUB_CACHE: path.join(dataRoot, "controlled-model-cache") } };
}
