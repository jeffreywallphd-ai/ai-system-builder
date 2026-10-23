import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { exactVitestFiles } from "../vitest-exact-runner.mjs";

const core = new URL("../vitest-exact-runner.mjs", import.meta.url).href;
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const fixtureParent = path.resolve(repositoryRoot, ".local-codex/t");
mkdirSync(fixtureParent, { recursive: true });

function fixture(run) {
  const root = realpathSync(mkdtempSync(path.join(fixtureParent, "exact-vitest-")));
  const put = (relative, source) => {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  };
  try {
    put("package.json", '{"type":"module"}');
    put("artifacts/test-reports/.keep", "");
    return run({ root, put });
  } finally {
    assert.equal(path.dirname(realpathSync(root)), realpathSync(fixtureParent));
    rmSync(root, { recursive: true });
  }
}

function execute(root, files) {
  const environment = { ...process.env, FORCE_COLOR: "0" };
  delete environment.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ["--input-type=module", "-e",
    `import {runExactVitest} from ${JSON.stringify(core)};
try { const result=await runExactVitest({root:${JSON.stringify(root)},files:${JSON.stringify(files)},reportRelativePath:"artifacts/test-reports/result.json"});
 console.log("EXACT-RESULT:"+JSON.stringify(result)); process.exitCode=result.exitCode;
} catch { console.log("EXACT-RESULT:"+JSON.stringify({exitCode:1}));process.exitCode=1;}`],
    { cwd: root, env: environment, encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true });
}

function aggregateFixture(root, put, prefix = "") {
  for (const name of ["run-vitest-tests.mjs", "vitest-exact-runner.mjs", "non-browser-test-runner-core.mjs"]) {
    const destination = `${prefix}dev-tools/scripts/testing/${name}`;
    put(destination, "");
    copyFileSync(new URL(`../${name}`, import.meta.url), path.join(root, destination));
  }
}

function executeAggregate(root, suite) {
  const environment = { ...process.env, FORCE_COLOR: "0" };
  delete environment.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [path.join(root, "dev-tools/scripts/testing/run-vitest-tests.mjs"), `--suite=${suite}`],
    { cwd: root, env: environment, encoding: "utf8", timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true });
}

test("real Vitest runs only exact current files, excluding same-name saved copies and ambient config", { timeout: 70000 }, () => fixture(({ root, put }) => {
  const selected = "apps/example/tests/journey.unit.test.ts";
  put(selected, 'import {it,expect} from "vitest";it("selected current journey",()=>expect(2+2).toBe(4));it.skip("pending check",()=>{});');
  for (const prefix of [".local-codex/checkpoint", "artifacts/preview", "unselected-copy"]) {
    put(`${prefix}/${selected}`, 'throw new Error("SAVED-COPY-MUST-NOT-EXECUTE");');
  }
  put("modules/example/tests/unselected.unit.test.ts", 'throw new Error("UNSELECTED-MUST-NOT-EXECUTE");');
  put("vitest.config.mjs", 'throw new Error("AMBIENT-CONFIG-MUST-NOT-EXECUTE");');
  put("artifacts/test-reports/result.json", '{"success":true,"numPassedTests":999,"testResults":[]}');
  const result = execute(root, [selected]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(path.join(root, "artifacts/test-reports/result.json"), "utf8"));
  assert.equal(report.numPassedTests, 1);
  assert.equal(report.numPendingTests, 1);
  assert.equal(report.testResults.length, 1);
  assert.ok(!`${result.stdout}${result.stderr}`.includes("MUST-NOT-EXECUTE"));
  assert.match(result.stdout, /"status":"exact"/);
}));

test("real Vitest failures and all-skipped runs cannot qualify", { timeout: 130000 }, () => fixture(({ root, put }) => {
  const selected = "modules/example/tests/failed.unit.test.ts";
  put(selected, 'import {it,expect} from "vitest";it("actual failed assertion",()=>expect(true).toBe(false));');
  const failed = execute(root, [selected]);
  assert.equal(failed.error, undefined);
  assert.equal(failed.status, 1);
  put(selected, 'import {it} from "vitest";it.skip("not executed",()=>{});');
  const skipped = execute(root, [selected]);
  assert.equal(skipped.error, undefined);
  assert.equal(skipped.status, 1);
  const report = JSON.parse(readFileSync(path.join(root, "artifacts/test-reports/result.json"), "utf8"));
  assert.equal(report.numPassedTests, 0);
  assert.equal(report.numPendingTests, 1);
}));

test("canonical source selection denies missing, duplicate, glob, foreign and traversal paths", () => fixture(({ root, put }) => {
  const selected = "modules/example/tests/one.unit.test.ts";
  put(selected, "");
  assert.deepEqual(exactVitestFiles(root, [selected]), [path.join(root, selected)]);
  for (const files of [[], [selected, selected], ["modules/missing.test.ts"], ["../escape.test.ts"],
    [".local-codex/modules/one.test.ts"], ["modules/**/one.test.ts"], ["modules/../one.test.ts"],
    ["modules\\one.test.ts"], ["modules/one.test.ts\n"], ["modules/one.spec.ts"]]) {
    assert.throws(() => exactVitestFiles(root, files));
  }
  symlinkSync(path.join(root, "modules/example"), path.join(root, "modules/alias"), "junction");
  assert.throws(() => exactVitestFiles(root, ["modules/alias/tests/one.unit.test.ts"]));
}));

test("real unhandled errors cannot qualify a passing assertion", { timeout: 70000 }, () => fixture(({ root, put }) => {
  const selected = "modules/example/tests/unhandled.unit.test.ts";
  put(selected, 'import {it,expect} from "vitest";it("observes async error",async()=>{setTimeout(()=>{throw new Error("bounded fixture unhandled error");},0);await new Promise(resolve=>setTimeout(resolve,30));expect(true).toBe(true);});');
  const result = execute(root, [selected]);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /"unhandledErrors":1/);
}));

test("the actual aggregate wrapper preserves suite ownership and exact report coverage", { timeout: 130000 }, () => fixture(({ root, put }) => {
  aggregateFixture(root, put);
  const standard = "apps/example/tests/journey.unit.test.ts";
  const integration = "modules/example/tests/journey.integration.test.ts";
  put(standard, 'import {it,expect} from "vitest";it("current standard",()=>expect(true).toBe(true));');
  put(integration, 'import {it,expect} from "vitest";it("current integration",()=>expect(true).toBe(true));');
  put("apps/example/tests/ai.unit.test.ts", '// @test-suite ai\nimport {it} from "vitest";it("must not enter standard or E2E",()=>{throw new Error("AI-SIBLING-MUST-NOT-EXECUTE");});');
  put(`.local-codex/old/${standard}`, 'throw new Error("SAVED-COPY-MUST-NOT-EXECUTE");');
  put(`artifacts/old/${integration}`, 'throw new Error("SAVED-COPY-MUST-NOT-EXECUTE");');
  put("vitest.config.mjs", 'throw new Error("AMBIENT-CONFIG-MUST-NOT-EXECUTE");');
  for (const [suite, selected] of [["standard", standard], ["e2e", integration]]) {
    const result = executeAggregate(root, suite);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(path.join(root, `artifacts/test-reports/vitest-${suite}-test-report.json`), "utf8"));
    assert.equal(report.success, true);
    assert.deepEqual(report.discoveredFiles, [selected]);
    assert.equal(report.selection.status, "exact");
    assert.equal(report.selection.collectedFiles, 1);
    assert.equal(report.numPassedTests, 1);
    assert.equal(report.testResults.length, 1);
  }
}));

test("actual aggregate refuses redirected report directories before changing sibling sentinel bytes", () => fixture(({ root, put }) => {
  aggregateFixture(root, put, "project/");
  put("project/package.json", '{"type":"module"}');
  put("project/modules/.keep", "");
  put("project/apps/example/current.unit.test.ts", 'import {it} from "vitest";it("selected",()=>{});');
  put("project/artifacts/.keep", "");
  const sentinel = "outside/test-reports/vitest-standard-test-report.json";
  put(sentinel, "owned sibling sentinel must remain byte-for-byte intact");
  symlinkSync(path.join(root, "outside/test-reports"), path.join(root, "project/artifacts/test-reports"), "junction");
  const result = executeAggregate(path.join(root, "project"), "standard");
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(readFileSync(path.join(root, sentinel), "utf8"), "owned sibling sentinel must remain byte-for-byte intact");
}));

test("actual empty standard and E2E replace stale passes; empty AI is explicitly delegated with zero execution", () => fixture(({ root, put }) => {
  aggregateFixture(root, put);
  put("modules/.keep", ""); put("apps/.keep", "");
  for (const suite of ["standard", "e2e", "ai"]) {
    const reportFile = `artifacts/test-reports/vitest-${suite}-test-report.json`;
    put(reportFile, '{"success":true,"numPassedTests":999}');
    const result = executeAggregate(root, suite);
    assert.equal(result.error, undefined);
    assert.equal(result.status, suite === "ai" ? 0 : 1);
    const report = JSON.parse(readFileSync(path.join(root, reportFile), "utf8"));
    assert.equal(report.success, suite === "ai");
    assert.equal(report.numPassedTests, 0);
    assert.equal(report.numTotalTests, 0);
    assert.equal(report.selection.status, suite === "ai" ? "empty-delegated" : "empty");
  }
}));
