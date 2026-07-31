import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createInMemoryStructuredDocumentStore } from "../../shared";
import {
  importJsonStructuredData,
  inventoryJsonStructuredData,
} from "../json-structured-data-import";

test("inventory only includes enumerated structured JSON families", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "json-inventory-"));
  try {
    await mkdir(path.join(root, "workspaces"), { recursive: true });
    await mkdir(path.join(root, "system-builder", "revisions"), {
      recursive: true,
    });
    await mkdir(path.join(root, "runtime-cache"), { recursive: true });
    await writeFile(path.join(root, "workspaces", "index.json"), '[{"workspaceId":"workspace-a"}]');
    await writeFile(
      path.join(root, "system-builder", "revisions", "system-1.r2.json"),
      '{"revisionId":"system-1.r2","foundationVersion":"3.0.0","selectedConfiguration":{"themeColorPrimary":"#2563eb"}}',
    );
    await writeFile(path.join(root, "runtime-cache", "not-structured.json"), '{"secret":"excluded"}');
    const inventory = await inventoryJsonStructuredData(root);
    assert.deepEqual(
      inventory.files.map((file) => file.relativePath),
      [
        "system-builder/revisions/system-1.r2.json",
        "workspaces/index.json",
      ],
    );
    assert.equal(inventory.totalRecords, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("import copies rollback sources, reconciles values, and is restart-safe", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "json-import-"));
  const rollback = await mkdtemp(path.join(tmpdir(), "json-rollback-"));
  try {
    await mkdir(path.join(root, "asset-authoring"), { recursive: true });
    await writeFile(path.join(root, "asset-authoring", "drafts.json"), '[{"draftId":"draft-a"}]');
    const documents = createInMemoryStructuredDocumentStore(() => "2026-07-16T12:00:00.000Z");
    const first = await importJsonStructuredData({ sourceRootDirectory: root, rollbackRootDirectory: rollback, documents, now: () => "2026-07-16T12:00:00.000Z" });
    assert.equal(first.status, "imported");
    const imported = await documents.readDocument<unknown[]>("asset-authoring", "drafts.json");
    assert.deepEqual(imported?.value, [{ draftId: "draft-a" }]);
    assert.equal(await readFile(path.join(first.marker!.rollbackDirectory!, "asset-authoring", "drafts.json"), "utf8"), '[{"draftId":"draft-a"}]');
    const retry = await importJsonStructuredData({ sourceRootDirectory: root, rollbackRootDirectory: rollback, documents });
    assert.equal(retry.status, "already-imported");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(rollback, { recursive: true, force: true });
  }
});

test("import fails closed when JSON changes after cutover", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "json-import-drift-"));
  const rollback = await mkdtemp(path.join(tmpdir(), "json-rollback-drift-"));
  try {
    await mkdir(path.join(root, "conversations"), { recursive: true });
    const source = path.join(root, "conversations", "threads.json");
    await writeFile(source, "[]");
    const documents = createInMemoryStructuredDocumentStore();
    await importJsonStructuredData({ sourceRootDirectory: root, rollbackRootDirectory: rollback, documents });
    await writeFile(source, '[{"threadId":"thread-a"}]');
    await assert.rejects(
      () => importJsonStructuredData({ sourceRootDirectory: root, rollbackRootDirectory: rollback, documents }),
      /refusing an implicit re-import or dual-write cutover/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(rollback, { recursive: true, force: true });
  }
});
