import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertNoSourceTreeJavaScriptArtifacts,
  buildSourceTreeContaminationMessage,
  findSourceTreeJavaScriptArtifacts,
} from "./source-tree-contamination-guard.mjs";

const createFixtureRoot = async () => mkdtemp(path.join(tmpdir(), "source-tree-guard-"));

test("source tree contamination guard detects JavaScript under modules", async () => {
  const root = await createFixtureRoot();
  await mkdir(path.join(root, "modules", "contracts", "asset"), { recursive: true });
  await writeFile(path.join(root, "modules", "contracts", "asset", "asset-id.ts"), "export type AssetId = string;\n");
  await writeFile(path.join(root, "modules", "contracts", "asset", "asset-id.js"), "\"use strict\";\n");

  assert.deepEqual(findSourceTreeJavaScriptArtifacts(root), [
    "modules/contracts/asset/asset-id.js",
  ]);
  assert.throws(
    () => assertNoSourceTreeJavaScriptArtifacts(root),
    /TypeScript output was emitted into modules\/\*\*\./,
  );
});

test("source tree contamination guard ignores JavaScript outside modules", async () => {
  const root = await createFixtureRoot();
  await mkdir(path.join(root, "dev-tools", "scripts"), { recursive: true });
  await mkdir(path.join(root, "modules", "contracts", "asset"), { recursive: true });
  await writeFile(path.join(root, "dev-tools", "scripts", "tool.mjs"), "export {};\n");
  await writeFile(path.join(root, "modules", "contracts", "asset", "asset-id.ts"), "export type AssetId = string;\n");

  assert.deepEqual(findSourceTreeJavaScriptArtifacts(root), []);
  assert.doesNotThrow(() => assertNoSourceTreeJavaScriptArtifacts(root));
});

test("source tree contamination message names intentional output locations", () => {
  const message = buildSourceTreeContaminationMessage(["modules/contracts/asset/asset-id.js"]);

  assert.match(message, /dist\//);
  assert.match(message, /artifacts\/test-runtime\//);
  assert.match(message, /modules\/contracts\/asset\/asset-id\.js/);
});

test("the authored forced-colors fixture does not exempt neighboring output", async (context) => {
  const root = await createFixtureRoot();
  context.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "modules", "ui", "shared", "styles", "tests");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "forced-colors-theme.unit.test.mjs"), "export {};\n");
  assert.doesNotThrow(() => assertNoSourceTreeJavaScriptArtifacts(root));

  await writeFile(path.join(directory, "forced-colors-theme.unit.test.js"), "export {};\n");
  assert.deepEqual(findSourceTreeJavaScriptArtifacts(root), [
    "modules/ui/shared/styles/tests/forced-colors-theme.unit.test.js",
  ]);
});
