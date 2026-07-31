import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  extractModuleSpecifiers,
  findModuleDependencyViolations,
  readBoundaryConfiguration,
} from "../architecture/check-module-dependencies.mjs";

const configuration = readBoundaryConfiguration();
const createFixtureRoot = async () => mkdtemp(path.join(tmpdir(), "module-dependency-guard-"));

const writeFixture = async (root, relativePath, contents) => {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
};

test("module dependency guard detects forbidden outward imports", async () => {
  const root = await createFixtureRoot();
  await writeFixture(
    root,
    "modules/application/use-cases/example.ts",
    'import { createExampleAdapter } from "../../adapters/persistence/example";\n',
  );

  const violations = findModuleDependencyViolations({ repoRoot: root, configuration });

  assert.equal(violations.length, 1);
  assert.deepEqual(
    {
      sourceBoundary: violations[0].sourceBoundary,
      targetBoundary: violations[0].targetBoundary,
    },
    { sourceBoundary: "application", targetBoundary: "adapters" },
  );
});

test("module dependency guard allows documented inward imports", async () => {
  const root = await createFixtureRoot();
  await writeFixture(
    root,
    "modules/application/use-cases/example.ts",
    'import type { Example } from "../../contracts/example";\n',
  );

  assert.deepEqual(findModuleDependencyViolations({ repoRoot: root, configuration }), []);
});

test("module dependency guard ignores test-only architecture probes", async () => {
  const root = await createFixtureRoot();
  await writeFixture(
    root,
    "modules/contracts/tests/outer-layer.test.ts",
    'import "../../../apps/server/src/index";\n',
  );

  assert.deepEqual(findModuleDependencyViolations({ repoRoot: root, configuration }), []);
});

test("module dependency guard limits exceptions to an exact tracked source", async () => {
  const root = await createFixtureRoot();
  const exceptionConfiguration = {
    ...configuration,
    allowedViolations: [
      {
        source: "modules/contracts/api/existing.ts",
        targetBoundary: "application",
        specifier: "../../application/example",
        tracking: "docs/mismatch.md#known",
        reason: "Known relocation debt.",
      },
    ],
  };
  await writeFixture(
    root,
    "modules/contracts/api/existing.ts",
    'export type { Example } from "../../application/example";\nexport type { Other } from "../../application/other";\n',
  );
  await writeFixture(
    root,
    "modules/contracts/api/new-violation.ts",
    'export type { Example } from "../../application/example";\n',
  );

  const violations = findModuleDependencyViolations({
    repoRoot: root,
    configuration: exceptionConfiguration,
  });

  assert.deepEqual(violations.map((violation) => violation.source), [
    "modules/contracts/api/existing.ts",
    "modules/contracts/api/new-violation.ts",
  ]);
});

test("module specifier extraction covers imports, re-exports, require, and dynamic import", () => {
  assert.deepEqual(
    extractModuleSpecifiers(`
      import type { A } from "./a";
      export { B } from "./b";
      const c = require("./c");
      const d = import("./d");
    `),
    ["./a", "./b", "./c", "./d"],
  );
});
