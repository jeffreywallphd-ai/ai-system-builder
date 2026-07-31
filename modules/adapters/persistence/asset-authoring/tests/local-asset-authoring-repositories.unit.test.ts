import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
