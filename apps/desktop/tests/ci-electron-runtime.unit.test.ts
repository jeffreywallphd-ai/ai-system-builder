import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CI explicitly installs the pinned Electron runtime after the script-free dependency install", async () => {
  const workflow = (await readFile(".github/workflows/ci.yml", "utf8")).replace(/\r\n?/g, "\n");

  assert.match(
    workflow,
    /npm ci --ignore-scripts --no-audit --no-fund\n\s+- name: Install pinned Electron runtime for integration tests\n\s+run: node node_modules\/electron\/install\.js/,
  );
});
