import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, readFile } from "node:fs/promises";
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
  LocalEffectiveAssetProjectionRecordStore,
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

it('validates fixed collection schemas before writes and mutation callbacks and preserves unsafe stored bytes',async()=>{
 const rootDir=await mkdtemp(join(tmpdir(),'eap-strict-'));
 const store=new LocalEffectiveAssetProjectionRecordStore({rootDir});
 const projection=makeProjection();
 await store.writeCollection('projections',[projection]);
 const file=join(rootDir,'effective-asset-projections','effective-asset-projections.json');
 const valid=await readFile(file,'utf8');
 await assert.rejects(()=>store.writeCollection('projections',[{...projection,providerPayload:'private'}]),LocalEffectiveAssetProjectionRecordStoreError);
 assert.equal(await readFile(file,'utf8'),valid);
 await assert.rejects(()=>store.writeCollection('snapshots',[projection]),LocalEffectiveAssetProjectionRecordStoreError);
 const unsafe=JSON.stringify([{...projection,provenance:{...projection.provenance,providerPayload:'private'}}]);
 await writeFile(file,unsafe,'utf8');
 await assert.rejects(()=>store.readCollection('projections'),LocalEffectiveAssetProjectionRecordStoreError);
 let calls=0;
 await assert.rejects(()=>store.mutateCollection('projections',records=>{calls++;return{records,result:undefined};}),LocalEffectiveAssetProjectionRecordStoreError);
 assert.equal(calls,0);assert.equal(await readFile(file,'utf8'),unsafe);
 await writeFile(file,valid,'utf8');
 await assert.rejects(()=>store.mutateCollection('projections',()=>({records:[{...projection,rawPayload:'private'}],result:undefined})),LocalEffectiveAssetProjectionRecordStoreError);
 assert.equal(await readFile(file,'utf8'),valid);
 const unsafeDiagnostic={...projection,diagnostics:[{code:'effective-projection-source-missing',message:'Failed',metadata:{detail:'echo synthetic; bash'}}]};
 await assert.rejects(()=>store.writeCollection('projections',[unsafeDiagnostic]),LocalEffectiveAssetProjectionRecordStoreError);
 await writeFile(file,JSON.stringify([unsafeDiagnostic]),'utf8');
 calls=0;
 await assert.rejects(()=>store.readCollection('projections'),LocalEffectiveAssetProjectionRecordStoreError);
 await assert.rejects(()=>store.mutateCollection('projections',records=>{calls++;return {records,result:undefined};}),LocalEffectiveAssetProjectionRecordStoreError);
 assert.equal(calls,0);
 assert.equal(await readFile(file,'utf8'),JSON.stringify([unsafeDiagnostic]));
 const mismatch={...projection,target:{...projection.target,targetWorkspaceId:wsB}};
 await writeFile(file,JSON.stringify([mismatch]),'utf8');
 await assert.rejects(()=>store.readCollection('projections'),LocalEffectiveAssetProjectionRecordStoreError);
 calls=0;
 await assert.rejects(()=>store.mutateCollection('projections',records=>{calls++;return {records,result:undefined};}),LocalEffectiveAssetProjectionRecordStoreError);
 assert.equal(calls,0);assert.equal(await readFile(file,'utf8'),JSON.stringify([mismatch]));
});
