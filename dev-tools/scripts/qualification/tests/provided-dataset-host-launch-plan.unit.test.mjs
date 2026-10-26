import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
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

test("provided specs and the real resolver load after the ESM global setup without launching apps", { timeout: 45_000 }, () => {
  const require = createRequire(import.meta.url);
  const composer = fileURLToPath(new URL("../visual-composer/", import.meta.url));
  const repo = path.resolve(composer, "../../../..");
  const temporaryParent = realpathSync(os.tmpdir());
  const temporary = mkdtempSync(path.join(temporaryParent, "provided-module-interop-"));
  let result;
  try {
    for (const name of ["cases", "temp", "home"]) mkdirSync(path.join(temporary, name));
    const setup = path.join(temporary, "setup.mjs"), config = path.join(temporary, "config.cjs");
    const report = path.join(temporary, "report.json");
    const modules = ["visual-composer-qualification-core.mjs", "provided-dataset-host-launch-plan.mjs", "visual-composer-global-setup.mjs"];
    writeFileSync(setup, `export default async () => {\n${modules.map(name =>
      `  await import(${JSON.stringify(pathToFileURL(path.join(composer, name)).href)});`).join("\n")}\n};\n`);
    writeFileSync(path.join(temporary, "cases/resolver.spec.ts"), `
const { test, expect } = require(${JSON.stringify(require.resolve("@playwright/test"))});
import { resolveProvidedServerRestartMarker } from ${JSON.stringify(path.join(composer, "e2e/provided-dataset-version-journey.ts"))};
test("canonical resolver executes after ESM preload", async () => {
  const core = await import(${JSON.stringify(pathToFileURL(path.join(composer, "visual-composer-qualification-core.mjs")).href)});
  const repo = ${JSON.stringify(repo)}, runId = "provided-module-regression";
  const roots = core.resolveVisualComposerQualificationPaths(repo, runId);
  expect(await resolveProvidedServerRestartMarker(runId, repo)).toBe(require("node:path").join(roots.thinRuntimeRoot, "provided-server-session-2.json"));
  await expect(resolveProvidedServerRestartMarker("../not-a-run", repo)).rejects.toThrow("Qualification run id is invalid.");
});\n`);
    writeFileSync(config, `module.exports = ${JSON.stringify({
      globalSetup: setup, outputDir: path.join(temporary, "results"), workers: 1, retries: 0,
      timeout: 15_000, globalTimeout: 30_000, reporter: [["json", { outputFile: report }]],
      use: { screenshot: "off", trace: "off", video: "off" },
      projects: [
        { name: "thin-collection", testDir: path.join(composer, "e2e"), testMatch: "thin-client-dataset-versions.e2e.spec.ts" },
        { name: "desktop-collection", testDir: path.join(composer, "e2e"), testMatch: "packaged-desktop-dataset-versions.e2e.spec.ts" },
        { name: "resolver-consumer", testDir: path.join(temporary, "cases"), testMatch: "resolver.spec.ts" },
      ],
    })};\n`);
    const env = Object.fromEntries(["SystemRoot", "WINDIR"].filter(key => process.env[key] !== undefined)
      .map(key => [key, process.env[key]]));
    Object.assign(env, { PATH: path.dirname(process.execPath), NODE_OPTIONS: "",
      HOME: path.join(temporary, "home"), USERPROFILE: path.join(temporary, "home"),
      TEMP: path.join(temporary, "temp"), TMP: path.join(temporary, "temp"), TMPDIR: path.join(temporary, "temp"),
      HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", PIP_NO_INDEX: "1", PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" });
    assert.equal(env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO, undefined);
    assert.equal(env.PYTHON_RUNTIME_ARGS, undefined);
    result = spawnSync(process.execPath, ["--max-old-space-size=256", require.resolve("@playwright/test/cli"),
      "test", "--config", config], { cwd: repo, env, windowsHide: true, encoding: "utf8", timeout: 40_000, maxBuffer: 1024 * 1024 });
    assert.equal(result.error, undefined, "The app-free collector must finish within its bounds.");
    assert.equal(result.status, 0, "The actual specs must collect after the ESM setup.");
    assert.ok(lstatSync(report).isFile() && lstatSync(report).size <= 1024 * 1024);
    const recorded = JSON.parse(readFileSync(report, "utf8"));
    assert.equal(recorded.errors.length, 0);
    assert.deepEqual(Object.fromEntries(["expected", "skipped", "unexpected", "flaky"].map(key => [key, recorded.stats[key]])),
      { expected: 1, skipped: 2, unexpected: 0, flaky: 0 });
    const results = [];
    const collect = suites => { for (const suite of suites) {
      for (const spec of suite.specs ?? []) for (const item of spec.tests) results.push({ title: spec.title, project: item.projectName, results: item.results });
      collect(suite.suites ?? []);
    } };
    collect(recorded.suites);
    assert.equal(results.length, 3);
    assert.ok(results.some(item => item.project === "resolver-consumer" && item.results.length === 1 && item.results[0].status === "passed"));
    for (const project of ["thin-collection", "desktop-collection"]) {
      const item = results.find(result => result.project === project);
      assert.ok(item && item.results.length === 1 && item.results[0].status === "skipped");
    }
  } finally {
    // A timeout or output overflow can leave ownership uncertain. Preserve that
    // fixture for diagnosis instead of deleting underneath an unknown writer.
    if (result && !result.error && Number.isInteger(result.status)) {
      assert.equal(path.dirname(temporary), temporaryParent);
      assert.equal(realpathSync(temporary), temporary);
      let entries = 0;
      const regularTree = folder => { for (const name of readdirSync(folder)) {
        const file = path.join(folder, name), info = lstatSync(file);
        assert.ok(++entries <= 1024 && !info.isSymbolicLink());
        if (info.isDirectory()) regularTree(file); else assert.ok(info.isFile());
      } };
      regularTree(temporary);
      rmSync(temporary, { recursive: true, force: true });
    }
  }
});
