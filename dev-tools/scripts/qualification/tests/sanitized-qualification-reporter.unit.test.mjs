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
test("browser launch diagnostics report fixed failure reasons without copying startup output", () => fixture(root => {
  const reporter = new Reporter();
  const privateOutput = "unlabelled synthetic private content Z3K5, Q:/fixture-profile/Private Directory, --synthetic-flag";
  const cases = [
    ["browserType.launch: Executable doesn't exist at Q:/synthetic", "executable unavailable"],
    ["browserType.launch: spawn Q:/synthetic EACCES", "permission denied"],
    ["browserType.launch: Target page, context or browser has been closed\n[pid=123][err] Cannot create default profile directory", "profile directory unavailable"],
    ["TimeoutError: browserType.launchPersistentContext: Timeout 15000ms exceeded.", "launch timed out"],
    ["browserType.launch: Target page, context or browser has been closed", "browser closed before launch completed"],
    ["browserType.launch: Unrecognized startup response", "cause undetermined"],
  ];
  for (const [index, [message]] of cases.entries()) {
    reporter.onTestEnd({ titlePath: () => [`synthetic case ${index}`], parent: { project: () => ({ name: "fixture" }) } }, {
      status: "failed", duration: 1, errors: [{ message: `${message}\n${privateOutput}` }],
    });
  }
  assert.deepEqual(reporter.onEnd({ status: "failed" }), { status: "failed" });
  const result = evidence(root);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.checks.slice(0, cases.length).map(check => check.diagnostic),
    cases.map(([, reason]) => `Browser startup: ${reason}.`));
  assert.doesNotMatch(JSON.stringify(result), /Z3K5|Q:\/fixture-profile|--synthetic-flag|\[pid=123\]/);
}));
test("a global browser startup failure stays failed and reports only its category", () => fixture(root => {
  const reporter = new Reporter(); child(reporter);
  reporter.onError({ message: "browserType.launchPersistentContext: Timeout 15000ms exceeded.\nUnlabelled private startup marker Z8K2" });
  reporter.onError({ message: "Unknown unrelated global marker Z8K9" });
  assert.deepEqual(reporter.onEnd({ status: "passed" }), { status: "failed" });
  const result = evidence(root);
  const diagnostic = result.checks[1].diagnostic;
  assert.match(diagnostic, /global errors: 2/);
  assert.match(diagnostic, /launch timed out \(1\)/);
  assert.doesNotMatch(JSON.stringify(result), /Z8K2|Z8K9|15000|browserType/);
}));
test("a browser startup result discards sibling errors that can contain raw launcher fragments", () => fixture(root => {
  const reporter = new Reporter();
  reporter.onTestEnd({ titlePath: () => ["synthetic startup"], parent: { project: () => ({ name: "fixture" }) } }, {
    status: "failed", duration: 1, errors: [
      { message: "Unprefixed startup fragment Z9K1" },
      { message: "browserType.launch: Timeout 15000ms exceeded." },
      { value: "Unprefixed child process output Z9K2" },
      { message: "TimeoutError: browserType.launch: Timeout 15000ms exceeded." },
    ],
  });
  reporter.onEnd({ status: "failed" });
  const result = evidence(root);
  assert.equal(result.checks[0].diagnostic, "Browser startup: launch timed out.");
  assert.doesNotMatch(JSON.stringify(result), /Z9K1|Z9K2/);
}));
test("launch diagnostics inspect only bounded startup text and ignore unrecognized prefixes", () => fixture(root => {
  const reporter = new Reporter();
  const synthetic = { titlePath: () => ["synthetic child"], parent: { project: () => ({ name: "fixture" }) } };
  reporter.onTestEnd(synthetic, { status: "failed", duration: 1, errors: [{ message:
    `browserType.launch: Unrecognized startup response\n${"x".repeat(9000)}\nCannot create default profile directory` }] });
  reporter.onTestEnd(synthetic, { status: "failed", duration: 1, errors: [{ message:
    "Assertion failed after browserType.launch: ordinary feature failure" }] });
  reporter.onEnd({ status: "failed" });
  const result = evidence(root);
  assert.equal(result.checks[0].diagnostic, "Browser startup: cause undetermined.");
  assert.equal(result.checks[1].diagnostic, "Assertion failed after browserType.launch: ordinary feature failure");
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
