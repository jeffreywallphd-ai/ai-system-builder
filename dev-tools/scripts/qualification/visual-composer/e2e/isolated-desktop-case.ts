import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { lstatSync } from "node:fs";

// Each case exercises a fresh installed profile; a preceding case's persisted
// workspace selection must not hide startup or change another case's outcome.
export function prepareIsolatedDesktopCase(caseId: "operational" | "browse" | "meaningful" | "lifecycle" | "pdf" | "dataset" | "ingestion" | "ocr" | "tasks" | "reference" | "worker-exit" | "worker-disconnect" | "cold", sampleIndex?: number) {
  assert.ok(["operational", "browse", "meaningful", "lifecycle", "pdf", "dataset", "ingestion", "ocr", "tasks", "reference", "worker-exit", "worker-disconnect", "cold"].includes(caseId));
  assert.ok(caseId === "cold" ? Number.isInteger(sampleIndex) && sampleIndex! >= 0 && sampleIndex! < 35 : sampleIndex === undefined);
  const base = process.env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT!;
  assert.ok(base && path.isAbsolute(base));
  assert.ok(path.resolve(base).replaceAll("\\", "/").includes("/artifacts/qualification/visual-composer/d/"));
  const dataRoot = path.join(base, caseId === "cold" ? `cold-${sampleIndex}` : caseId);
  if (caseId === "operational") {
    const fence = path.resolve("artifacts/qualification/visual-composer/d");
    const relativeRoot = path.relative(fence, path.resolve(base));
    assert.ok(relativeRoot && !path.isAbsolute(relativeRoot) && relativeRoot !== ".." && !relativeRoot.startsWith(`..${path.sep}`), "Operational qualification must remain under this repository's isolated run root.");
    if (lstatSync(dataRoot, { throwIfNoEntry: false }) !== undefined) throw new Error("An existing operational profile requires a fresh qualification run.");
  }
  const result = spawnSync(process.env.VISUAL_COMPOSER_ELECTRON_NODE_EXECUTABLE!, [
    "--preserve-symlinks", "--preserve-symlinks-main", "--import", "tsx",
    path.resolve("dev-tools/scripts/qualification/visual-composer/visual-composer-desktop-seed.ts"),
  ], { cwd: process.cwd(), env: { ...process.env, VISUAL_COMPOSER_DESKTOP_DATA_ROOT: dataRoot, VISUAL_COMPOSER_LARGE_FIXTURE:caseId==="reference"?"1":"0", ELECTRON_RUN_AS_NODE: "1" }, windowsHide: true, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, "isolated desktop case identity seed must succeed");
  return { dataRoot, env: { ...process.env, VISUAL_COMPOSER_DESKTOP_DATA_ROOT: dataRoot, HF_HUB_CACHE: path.join(dataRoot, "controlled-model-cache") } };
}
