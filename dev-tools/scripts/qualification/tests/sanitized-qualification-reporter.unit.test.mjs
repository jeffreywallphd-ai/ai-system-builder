import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import Reporter from "../visual-composer/sanitized-qualification-reporter.mjs";

const require = createRequire(import.meta.url);
function fixture(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), "canvas-reporter-"));
  const oldCwd = process.cwd();
  const names = ["VISUAL_COMPOSER_QUALIFICATION_RUN_ID", "VISUAL_COMPOSER_QUALIFICATION_ENVIRONMENT_ID", "VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION"];
  const old = names.map(name => process.env[name]);
  try {
    process.chdir(root);
    process.env[names[0]] = "reporter-fixture";
    process.env[names[1]] = "synthetic-local";
    process.env[names[2]] = "source.synthetic";
    return run(root);
  } finally {
    process.chdir(oldCwd);
    names.forEach((name, i) => { if (old[i] === undefined) delete process.env[name]; else process.env[name] = old[i]; });
    rmSync(root, { recursive: true, force: true });
  }
}
function child(reporter) {
  reporter.onTestEnd({ titlePath: () => ["synthetic child"], parent: { project: () => ({ name: "fixture" }) } }, { status: "passed", duration: 1, errors: [] });
}
function evidence(root, run = "reporter-fixture") { return JSON.parse(readFileSync(path.join(root, "artifacts/qualification/visual-composer/runs", run, "evidence.json"), "utf8")); }

for (const status of ["failed", "timedout", "interrupted", undefined]) {
  test(`passing child cannot mask ${status ?? "missing"} runner status`, () => fixture(root => {
    const reporter = new Reporter(); child(reporter);
    assert.deepEqual(reporter.onEnd(status ? { status } : undefined), { status: "failed" });
    const result = evidence(root);
    assert.equal(result.status, "failed");
    assert.equal(result.checks[0].status, "passed", "retain actual child outcome");
    assert.equal(result.checks[1].id, "visual-composer.runner-completion");
    assert.equal(result.checks[1].status, "failed");
  }));
}
test("global errors fail evidence without retaining private error content", () => fixture(root => {
  const reporter = new Reporter(); child(reporter);
  reporter.onError({ message: "synthetic-private-global-error token=synthetic-value" });
  reporter.onEnd({ status: "passed" });
  const result = evidence(root);
  assert.equal(result.status, "failed");
  assert.ok(!JSON.stringify(result).includes("synthetic-private-global-error"));
  assert.ok(!JSON.stringify(result).includes("synthetic-value"));
}));
test("an empty test run never produces a vacuous pass", () => fixture(root => {
  new Reporter().onEnd({ status: "passed" });
  assert.equal(evidence(root).status, "failed");
}));
test("a genuine passing run retains its passing child evidence", () => fixture(root => {
  const reporter = new Reporter(); child(reporter); reporter.onEnd({ status: "passed" });
  const result = evidence(root); assert.equal(result.status, "passed"); assert.equal(result.checks.length, 1);
}));
test("actual Playwright teardown failure cannot publish passing evidence", { timeout: 30_000 }, () => fixture(root => {
  // The repository runner stages tests; dependencies still resolve through the
  // module tree, while the reporter stays adjacent to this exact staged test.
  const reporterPath = fileURLToPath(new URL("../visual-composer/sanitized-qualification-reporter.mjs", import.meta.url));
  const playwrightPath = require.resolve("@playwright/test");
  const config = path.join(root, "playwright.config.cjs");
  const teardown = path.join(root, "teardown.cjs");
  writeFileSync(teardown, 'module.exports = async () => { throw new Error("synthetic teardown failure"); };\n');
  writeFileSync(config, `module.exports = { testDir: ${JSON.stringify(root)}, outputDir: ${JSON.stringify(path.join(root, "results"))}, testMatch: 'fixture.spec.cjs', workers: 1, retries: 0, globalTeardown: ${JSON.stringify(teardown)}, reporter: [[${JSON.stringify(reporterPath)}]] };\n`);
  writeFileSync(path.join(root, "fixture.spec.cjs"), `const { test, expect } = require(${JSON.stringify(playwrightPath)}); test('passing synthetic child', () => expect(1).toBe(1));\n`);
  const result = spawnSync(process.execPath, [require.resolve("@playwright/test/cli"), "test", `--config=${config}`], { cwd: root, env: { ...process.env }, encoding: "utf8", windowsHide: true, timeout: 20_000, maxBuffer: 128 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, "actual runner must fail its teardown");
  const recorded = evidence(root);
  assert.equal(recorded.status, "failed");
  assert.ok(recorded.checks.some(check => check.id.includes("passing synthetic child") && check.status === "passed"));
  assert.ok(recorded.checks.some(check => check.id === "visual-composer.runner-completion" && check.status === "failed"));
}));
