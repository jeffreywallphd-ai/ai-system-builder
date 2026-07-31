import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { normalizeAssetCompositionPlanId } from "../../../../contracts/asset-composition";
import {
  normalizeRuntimeInventorySourceId,
  normalizeRuntimeReadinessBindingId,
  type RuntimeInventory,
  type RuntimeReadinessBinding,
} from "../../../../contracts/runtime-readiness";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  createLocalRuntimeInventoryRepositoryAdapter,
  createLocalRuntimeReadinessBindingRepositoryAdapter,
  LocalRuntimeReadinessRecordStoreError,
} from "..";

const wsA = createWorkspaceId("workspace.a");
const wsB = createWorkspaceId("workspace.b");

function binding(ws: string, id: string): RuntimeReadinessBinding {
  return {
    readinessBindingId: normalizeRuntimeReadinessBindingId(id),
    targetWorkspaceId: createWorkspaceId(ws),
    compositionPlanId: normalizeAssetCompositionPlanId("plan.a"),
    status: "blocked",
    requirements: [],
    providerCandidates: [],
    bindingCandidates: [],
    bindings: [],
    blockers: [],
    diagnostics: [],
    provenance: [],
    createdAt: "2026-05-20T00:00:00.000Z",
    updatedAt: "2026-05-20T00:00:00.000Z",
  };
}

function inventory(ws: string, id: string): RuntimeInventory {
  return {
    targetWorkspaceId: createWorkspaceId(ws),
    inventorySourceId: normalizeRuntimeInventorySourceId(id),
    inventorySourceKind: "manual",
    discoveredProviderCandidates: [],
    discoveredCapabilities: [],
    inventoryStatus: "checked",
    diagnostics: [],
    blockers: [],
    checkedAt: "2026-05-20T00:00:00.000Z",
  };
}

describe("local runtime readiness repositories", () => {
  it("saves reads and isolates readiness bindings", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "rr-"));
    const repo = createLocalRuntimeReadinessBindingRepositoryAdapter({ rootDir });

    await repo.saveRuntimeReadinessBindingRecord(binding(wsA, "rb.1"));
    await repo.saveRuntimeReadinessBindingRecord(binding(wsB, "rb.1"));

    assert.equal((await repo.listRuntimeReadinessBindingRecords({ targetWorkspaceId: wsA })).records.length, 1);
    assert.equal(
      (await repo.readRuntimeReadinessBindingRecord(wsB, normalizeRuntimeReadinessBindingId("rb.1")))?.targetWorkspaceId,
      wsB,
    );
  });

  it("saves reads and isolates inventory", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "rr-"));
    const repo = createLocalRuntimeInventoryRepositoryAdapter({ rootDir });

    await repo.saveRuntimeInventoryRecord(inventory(wsA, "src.1"));
    await repo.saveRuntimeInventoryRecord(inventory(wsB, "src.1"));

    assert.equal((await repo.listRuntimeInventoryRecords({ targetWorkspaceId: wsA })).records.length, 1);
    assert.equal(
      (await repo.readRuntimeInventoryRecord(wsB, normalizeRuntimeInventorySourceId("src.1")))?.targetWorkspaceId,
      wsB,
    );
  });

  it("fails safely on manifest schema mismatch", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "rr-"));
    const repo = createLocalRuntimeInventoryRepositoryAdapter({ rootDir });
    const storeDir = join(rootDir, "runtime-readiness");

    await mkdir(storeDir, { recursive: true });
    await writeFile(
      join(storeDir, "runtime-readiness-manifest.json"),
      JSON.stringify({ schemaVersion: 99, storeKind: "runtime-readiness-local-store" }),
    );

    await assert.rejects(
      () => repo.listRuntimeInventoryRecords({ targetWorkspaceId: wsA }),
      LocalRuntimeReadinessRecordStoreError,
    );
  });
});
