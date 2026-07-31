import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createInMemoryStructuredDocumentStore } from "../../shared";
import { exportStructuredData, writeStructuredDataExport } from "../structured-data-export";

test("structured data export is deterministic, complete, and written atomically as NDJSON", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "structured-export-"));
  try {
    const documents = createInMemoryStructuredDocumentStore(() => "2026-07-16T12:00:00.000Z");
    await documents.writeDocument("zeta", "two", { value: 2 });
    await documents.writeDocument("alpha", "one", { value: 1 });
    await documents.writeDocument("system-builder/revisions", "system-1.r2", {
      foundationVersion: "3.0.0",
      selectedConfiguration: { themeColorPrimary: "#2563eb" },
    });
    const exported = await exportStructuredData(documents, () => "2026-07-16T13:00:00.000Z");
    assert.deepEqual(
      exported.documents.map(({ namespace, key }) => `${namespace}/${key}`),
      [
        "alpha/one",
        "system-builder/revisions/system-1.r2",
        "zeta/two",
      ],
    );
    assert.deepEqual(exported.documents[1]?.value, {
      foundationVersion: "3.0.0",
      selectedConfiguration: { themeColorPrimary: "#2563eb" },
    });
    assert.equal(exported.manifest.documentCount, 3);
    assert.match(exported.manifest.sha256, /^[a-f0-9]{64}$/);

    const destination = path.join(root, "exports", "portable.ndjson");
    const written = await writeStructuredDataExport(destination, exported);
    assert.equal(written.documentCount, 3);
    const lines = (await readFile(destination, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(lines[0].kind, "ai-system-builder-structured-data-export");
    assert.equal(lines.length, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
