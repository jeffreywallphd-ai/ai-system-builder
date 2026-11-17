import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

test("the Playwright worker imports the managed Assets restart fixture without starting it", () => {
  // Keep the temporary spec in the workspace for its fixed relative import and
  // node_modules resolution. These exact test-owned files are always removed.
  const parent = path.resolve(root, ".local-codex");
  try {mkdirSync(parent);} catch (error) {if (error.code !== "EEXIST") throw error;}
  assert.ok(lstatSync(parent).isDirectory());
  assert.equal(realpathSync(parent), parent);
  const directory = mkdtempSync(path.join(parent, "asset-restart-loader-"));
  const spec = path.join(directory, "fixture-loader.spec.ts");
  const config = path.join(directory, "playwright.config.ts");
  const resultPath = path.join(directory, "result");
  const vars = new Set(["path", "systemroot", "windir", "tmp", "temp", "tmpdir", "localappdata", "userprofile"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => vars.has(key.toLowerCase())));
  try {
    writeFileSync(config, 'import {defineConfig} from "@playwright/test";\nexport default defineConfig({testDir:".",testMatch:"fixture-loader.spec.ts",workers:1,reporter:"line"});\n', {flag:"wx"});
    writeFileSync(spec, `import {test, expect} from "@playwright/test";
test("loads the managed restart fixture", async () => {
  const entry = await import("../../dev-tools/scripts/qualification/visual-composer/managed-reference-host");
  expect(typeof entry.startManagedReferenceHost).toBe("function");
});
`, {flag:"wx"});
    const result = spawnSync(process.execPath, ["node_modules/playwright/cli.js", "test", "--config", config, "--output", resultPath], {
      cwd: root, env: {...env, CI:"1", FORCE_COLOR:"0", PLAYWRIGHT_NO_COPY_PROMPT:"1"}, encoding:"utf8",
      timeout: 30_000, maxBuffer: 32 * 1024, windowsHide:true,
    });
    assert.equal(result.status, 0, "The fixture must import in the real Playwright worker.");
    assert.ok(/1 passed\b/.test(result.stdout), "The loader case must actually run.");
  } finally {
    for (const file of [spec, config, path.join(resultPath, ".last-run.json")]) {
      try {unlinkSync(file);} catch (error) {if (error.code !== "ENOENT") throw error;}
    }
    try {rmdirSync(resultPath);} catch (error) {if (error.code !== "ENOENT") throw error;}
    rmdirSync(directory);
  }
});
