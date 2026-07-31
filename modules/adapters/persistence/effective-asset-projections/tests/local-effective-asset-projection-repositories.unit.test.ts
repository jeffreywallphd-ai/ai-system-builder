import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { normalizeAssetId, type AssetReference } from "../../../../contracts/asset";
import {
  normalizeEffectiveAssetProjectionId,
  normalizeEffectiveAssetProjectionSnapshotId,
  type EffectiveAssetProjectionRecord,
} from "../../../../contracts/effective-asset-projections";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  createLocalEffectiveAssetProjectionRepositoryAdapter,
  createLocalEffectiveAssetProjectionSnapshotRepositoryAdapter,
  LocalEffectiveAssetProjectionRecordStoreError,
} from "..";

const wsA = createWorkspaceId("workspace.a");
const wsB = createWorkspaceId("workspace.b");

function effectiveAssetReference(id: string): AssetReference {
  return {
    kind: "asset-definition-version",
    id: normalizeAssetId(id),
    version: "1.0.0",
    label: id,
  };
}

function makeProjection(overrides: Partial<EffectiveAssetProjectionRecord> = {}): EffectiveAssetProjectionRecord {
  const targetWorkspaceId = overrides.targetWorkspaceId ?? wsA;
  const effectiveReference = overrides.effectiveAssetReference ?? effectiveAssetReference("effective.a");

  return {
    projectionId: normalizeEffectiveAssetProjectionId("projection.a"),
    targetWorkspaceId,
    source: {
      sourceKind: "workspace-local",
      targetWorkspaceId,
      effectiveAssetReference: effectiveReference,
    },
    target: {
      targetWorkspaceId,
      effectiveAssetReference: effectiveReference,
      intendedPolicy: "safe-fields-only",
    },
    sourceKind: "workspace-local",
    status: "ready",
    policy: "safe-fields-only",
    projectedFields: {
      "display-name": "A",
      summary: "summary",
    },
    diagnostics: [],
    blockers: [],
    provenance: {
      kind: "projected-from-workspace-local-asset",
      targetWorkspaceId,
      effectiveAssetReference: effectiveReference,
      operationAt: "2026-05-20T00:00:00.000Z",
    },
    effectiveAssetReference: effectiveReference,
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("local effective asset projection persistence", () => {
  it("saves, reads, filters, and isolates by workspace", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "eap-"));
    const repo = createLocalEffectiveAssetProjectionRepositoryAdapter({ rootDir });
    const a = makeProjection();
    const b = makeProjection({
      projectionId: normalizeEffectiveAssetProjectionId("projection.b"),
      targetWorkspaceId: wsB,
      effectiveAssetReference: effectiveAssetReference("effective.b"),
      updatedAt: "2026-05-20T01:00:00.000Z",
    });

    await repo.saveEffectiveAssetProjectionRecord(a);
    await repo.saveEffectiveAssetProjectionRecord(b);

    assert.equal((await repo.readEffectiveAssetProjectionRecord(wsA, a.projectionId))?.projectionId, a.projectionId);
    assert.equal((await repo.listEffectiveAssetProjectionRecords({ targetWorkspaceId: wsA })).records.length, 1);
    assert.equal(
      (await repo.readEffectiveAssetProjectionRecordByEffectiveAssetReference(wsA, a.effectiveAssetReference))
        ?.projectionId,
      a.projectionId,
    );
  });

  it("fails safely on manifest mismatch", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "eap-"));
    const repo = createLocalEffectiveAssetProjectionRepositoryAdapter({ rootDir });
    const storeDir = join(rootDir, "effective-asset-projections");

    await mkdir(storeDir, { recursive: true });
    await writeFile(
      join(storeDir, "effective-asset-projection-manifest.json"),
      JSON.stringify({ schemaVersion: 99, storeKind: "effective-asset-projections-local-store" }),
    );

    await assert.rejects(
      () => repo.listEffectiveAssetProjectionRecords({ targetWorkspaceId: wsA }),
      LocalEffectiveAssetProjectionRecordStoreError,
    );
  });

  it("supports snapshots scoped by workspace", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "eap-"));
    const repo = createLocalEffectiveAssetProjectionSnapshotRepositoryAdapter({ rootDir });
    const snap = {
      ...makeProjection(),
      projectionSnapshotId: normalizeEffectiveAssetProjectionSnapshotId("snapshot.a"),
    };

    await repo.saveEffectiveAssetProjectionSnapshotRecord(snap);

    assert.equal(
      (await repo.readEffectiveAssetProjectionSnapshotRecord(wsA, snap.projectionSnapshotId))?.projectionSnapshotId,
      snap.projectionSnapshotId,
    );
    assert.equal((await repo.listEffectiveAssetProjectionSnapshotRecords({ targetWorkspaceId: wsB })).records.length, 0);
  });
});
