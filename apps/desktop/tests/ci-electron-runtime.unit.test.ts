import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CI explicitly installs the pinned Electron runtime after the script-free dependency install", async () => {
  const workflow = await readFile(".github/workflows/ci.yml", "utf8");

  assert.match(
    workflow,
    /npm ci --ignore-scripts --no-audit --no-fund\n\s+- name: Install pinned Electron runtime for integration tests\n\s+run: npm rebuild electron --no-audit --no-fund/,
  );
});
