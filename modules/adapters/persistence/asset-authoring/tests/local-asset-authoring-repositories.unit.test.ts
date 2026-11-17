import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import { LocalAssetAuthoringRecordStore } from "../local-asset-authoring-record-store";

import { describe, expect, it } from "../../../../testing/node-test";
import {
  createLocalAssetDraftRepositoryAdapter,
  createLocalAssetOverrideRepositoryAdapter,
  createLocalAssetRevisionRepositoryAdapter,
  createLocalAuthoredAssetRepositoryAdapter,
} from "..";

const now = () => "2026-05-01T00:00:00.000Z";
const mk = async () => mkdtemp(join(tmpdir(), "aa-"));
const assetReference = { kind: "asset-instance", id: "asset.a", version: "1", label: "A" } as const;

describe("local asset authoring repos", () => {
  it("isolates workspace scoped data", async () => {
    const root = await mk();
    const authored = createLocalAuthoredAssetRepositoryAdapter({ rootDir: root, now });

    await authored.saveAuthoredAssetRecord({
      authoredAssetId: "a.1",
      workspaceId: "ws.a",
      assetReference,
      currentRevisionId: "rev.1",
      status: "draft",
      editableValues: { "display-name": "A" },
      provenance: { kind: "authored-from-scratch", operationAt: now() },
      createdAt: now(),
      updatedAt: now(),
    });

    const listA = await authored.listAuthoredAssetRecords({ workspaceId: "ws.a" });
    const listB = await authored.listAuthoredAssetRecords({ workspaceId: "ws.b" });

    expect(listA.records.length).toBe(1);
    expect(listB.records.length).toBe(0);
    await rm(root, { recursive: true, force: true });
  });

  it("supports draft revision override reads", async () => {
    const root = await mk();
    const drafts = createLocalAssetDraftRepositoryAdapter({ rootDir: root, now });
    const revisions = createLocalAssetRevisionRepositoryAdapter({ rootDir: root, now });
    const overrides = createLocalAssetOverrideRepositoryAdapter({ rootDir: root, now });

    await drafts.saveAssetDraftRecord({
      draftId: "d.1",
      targetWorkspaceId: "ws.a",
      draftEditableValues: { summary: "s" },
      status: "draft",
      provenance: { kind: "authored-from-scratch", operationAt: now() },
      createdAt: now(),
      updatedAt: now(),
    });
    await revisions.saveAssetRevisionRecord({
      revisionId: "r.1",
      workspaceId: "ws.a",
      authoredAssetId: "a.1",
      revision: "1",
      status: "published",
      editableValues: { summary: "ok" },
      provenance: { kind: "revised-authored-asset", operationAt: now() },
      createdAt: now(),
      updatedAt: now(),
      publishedAt: now(),
    });
    await overrides.saveAssetOverrideRecord({
      overrideId: "o.1",
      targetWorkspaceId: "ws.a",
      customizationTarget: {
        targetWorkspaceId: "ws.a",
        sourceKind: "workspace-local-asset",
        effectiveAssetReference: assetReference,
      },
      baseAssetReference: assetReference,
      overrideScope: "workspace-local",
      overrideValues: { summary: "ov" },
      status: "active",
      provenance: { kind: "edited-authored-asset", operationAt: now() },
      createdAt: now(),
      updatedAt: now(),
      conflictStatus: "open",
    });

    expect((await drafts.readAssetDraftRecord("ws.a", "d.1"))?.draftId).toBe("d.1");
    expect((await revisions.findLatestPublishedAssetRevision("ws.a", "a.1"))?.revisionId).toBe("r.1");
    expect((await overrides.listConflictedOverridesByWorkspace("ws.a")).length).toBe(1);
    await rm(root, { recursive: true, force: true });
  });
});


it("retains identical revision identities in separate workspaces", async () => {
  const root = await mk();
  try {
    const repository = createLocalAssetRevisionRepositoryAdapter({ rootDir: root, now });
    const base = { revisionId: "same.revision", authoredAssetId: "same.asset", revision: "1",
      status: "published" as const, editableValues: { summary: "owned" },
      provenance: { kind: "revised-authored-asset" as const, operationAt: now() },
      createdAt: now(), updatedAt: now(), publishedAt: now() };
    await repository.saveAssetRevisionRecord({ ...base, workspaceId: "ws.a" });
    await repository.saveAssetRevisionRecord({ ...base, workspaceId: "ws.b" });
    expect((await repository.readAssetRevisionRecord("ws.a", "same.asset", "same.revision"))?.workspaceId).toBe("ws.a");
    expect((await repository.readAssetRevisionRecord("ws.b", "same.asset", "same.revision"))?.workspaceId).toBe("ws.b");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("batches authored and revision reads once per collection with ordered misses and workspace isolation", async () => {
  const backing = createInMemoryStructuredDocumentStore(); const reads: string[] = [];
  const documents = new Proxy(backing, {get(target, key) {
    if (key === "readDocument") return async (namespace: string, id: string) => {reads.push(`${namespace}/${id}`); return target.readDocument(namespace, id);};
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  }});
  const options = {rootDir: "batch-authoring-fixture", documents, now};
  const store = new LocalAssetAuthoringRecordStore(options);
  const records = Array.from({length: 1000}, (_, i) => ({authoredAssetId: `authored.${i}`, workspaceId: "ws.a", assetReference: {...assetReference, id: `asset.${i}`}, currentRevisionId: `revision.${i}`, status: "published", editableValues: {summary: `Summary ${i}`}, provenance: {kind: "authored-from-scratch", operationAt: now()}, createdAt: now(), updatedAt: now()}));
  await store.writeCollection("authoredAssets", [...records, {...records[0], workspaceId: "ws.b", editableValues: {"unsupported-field": "foreign"}}]);
  const revisions = records.map(record => ({workspaceId: record.workspaceId, authoredAssetId: record.authoredAssetId, revisionId: record.currentRevisionId, revision: "1", status: "published", editableValues: record.editableValues, provenance: {kind: "revised-authored-asset", operationAt: now()}, createdAt: now(), updatedAt: now(), publishedAt: now()}));
  await store.writeCollection("revisions", [...revisions, {...revisions[0], workspaceId: "ws.b", editableValues: {"unsupported-field": "foreign"}}]);
  const authored = createLocalAuthoredAssetRepositoryAdapter(options); const repository = createLocalAssetRevisionRepositoryAdapter(options);
  reads.length = 0;
  const references = [records[99].assetReference, {...assetReference, id: "missing"}, records[3].assetReference, {...records[3].assetReference, version: "2"}];
  const found = await authored.findAuthoredAssetsByBaseReferences!("ws.a", references);
  expect(found.map(record => record?.authoredAssetId)).toEqual(["authored.99", undefined, "authored.3", undefined]);
  expect(reads.filter(id => id.endsWith("authored-assets.json")).length).toBe(1);
  reads.length = 0;
  const resolved = await repository.readAssetRevisionRecords!("ws.a", [{authoredAssetId: "authored.99", revisionId: "revision.99"}, {authoredAssetId: "wrong.asset", revisionId: "revision.3"}, {authoredAssetId: "authored.3", revisionId: "revision.3"}]);
  expect(resolved.map(record => record?.revisionId)).toEqual(["revision.99", undefined, "revision.3"]);
  expect(reads.filter(id => id.endsWith("asset-revisions.json")).length).toBe(1);
  await expect(authored.findAuthoredAssetsByBaseReferences!("ws.a", Array(251).fill(assetReference))).rejects.toThrow();
  await expect(repository.readAssetRevisionRecords!("ws.a", Array(251).fill({authoredAssetId: "a", revisionId: "r"}))).rejects.toThrow();
});
