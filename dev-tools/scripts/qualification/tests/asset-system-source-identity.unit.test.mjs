import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readAssetSystemSourceIdentity, assertAssetSystemSourceIdentity } from "../asset-system-source-identity.mjs";

test("source identity includes new source, detects drift, and excludes unrelated ignored data", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "probe-source-"));
  execFileSync("git", ["init", "--quiet", root]);
  await mkdir(path.join(root, "modules"));
  await writeFile(path.join(root, "modules", "fixture.ts"), "export const value = 1;\n");
  const initial = await readAssetSystemSourceIdentity(root);
  await assertAssetSystemSourceIdentity(root, initial);
  await writeFile(path.join(root, "unrelated.json"), "{}");
  assert.equal(await readAssetSystemSourceIdentity(root), initial);
  await writeFile(path.join(root, "modules", "fixture.ts"), "export const value = 2;\n");
  await assert.rejects(assertAssetSystemSourceIdentity(root, initial), /Source changed/);
  assert.notEqual(await readAssetSystemSourceIdentity(root), initial);
});

test("root dependency declarations and resolution bind observations and deny drift", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "probe-dependency-source-"));
  try {
    execFileSync("git", ["init", "--quiet", root]);
    const empty = await readAssetSystemSourceIdentity(root);
    await writeFile(path.join(root, "package.json"), '{"devDependencies":{"fixture":"1.0.0"}}\n');
    const manifest = await readAssetSystemSourceIdentity(root);
    assert.notEqual(manifest, empty, "new root manifest must be bound");
    await writeFile(path.join(root, "package-lock.json"), '{"lockfileVersion":3,"packages":{}}\n');
    const locked = await readAssetSystemSourceIdentity(root);
    assert.notEqual(locked, manifest, "new authoritative lock must be bound");
    execFileSync("git", ["add", "--", "package.json", "package-lock.json"], { cwd: root });
    assert.equal(await readAssetSystemSourceIdentity(root), locked);
    for (const file of ["package.json", "package-lock.json"]) {
      const before = await readAssetSystemSourceIdentity(root);
      await writeFile(path.join(root, file), '{"changed":true}\n');
      assert.notEqual(await readAssetSystemSourceIdentity(root), before, file);
      await assert.rejects(assertAssetSystemSourceIdentity(root, before), /Source changed/);
    }
    const current = await readAssetSystemSourceIdentity(root);
    await writeFile(path.join(root, "unrelated.json"), "{}");
    assert.equal(await readAssetSystemSourceIdentity(root), current);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
