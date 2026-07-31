import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  findCanonicalMetadataFailures,
  findContextRoutingFailures,
  findMarkdownLinkFailures,
} from "../docs/check-doc-drift.mjs";

const createFixtureRoot = async () => mkdtemp(path.join(tmpdir(), "documentation-drift-guard-"));

const writeFixture = async (root, relativePath, contents) => {
  const absolutePath = path.join(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
  return absolutePath;
};

test("documentation link guard validates paths and Markdown anchors", async () => {
  const root = await createFixtureRoot();
  await writeFixture(root, "docs/target.md", "# Target\n\n## Existing Section\n");
  const sourcePath = await writeFixture(
    root,
    "docs/source.md",
    "[valid](target.md#existing-section)\n[missing path](absent.md)\n[missing anchor](target.md#absent)\n",
  );

  const failures = findMarkdownLinkFailures(root, [sourcePath]);

  assert.equal(failures.length, 2);
  assert.ok(failures.some((failure) => failure.includes("missing repository path")));
  assert.ok(failures.some((failure) => failure.includes("missing Markdown anchor")));
});

test("documentation metadata guard reports absent architecture metadata", async () => {
  const root = await createFixtureRoot();
  await writeFixture(root, "docs/architecture/example.md", "# Example\n\n- Status: current\n");

  const failures = findCanonicalMetadataFailures(root);

  assert.equal(failures.length, 2);
  assert.ok(failures.some((failure) => failure.includes("Related decisions")));
  assert.ok(failures.some((failure) => failure.includes("Verification")));
});

test("context routing guard reports unrouted packs and missing canonical sources", async () => {
  const root = await createFixtureRoot();
  await writeFixture(root, "docs/context/prompt-routing.md", "# Routing\n");
  await writeFixture(
    root,
    "docs/context/packs/example.pack.md",
    "# Example\n\n## Canonical Source Docs\n\n- `docs/architecture/missing.md`\n",
  );

  const failures = findContextRoutingFailures(root);

  assert.equal(failures.length, 2);
  assert.ok(failures.some((failure) => failure.includes("missing canonical source")));
  assert.ok(failures.some((failure) => failure.includes("is not routed")));
});
