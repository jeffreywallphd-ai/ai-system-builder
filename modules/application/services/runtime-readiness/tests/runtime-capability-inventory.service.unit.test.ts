import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RuntimeInventory } from "../../../../contracts/runtime-readiness";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { RuntimeCapabilityInventoryService } from "../runtime-capability-inventory.service";
import { RuntimeCapabilityInventorySummaryService } from "../runtime-capability-inventory-summary.service";

const mkRepo = () => {
  const records = new Map<string, RuntimeInventory>();
  return {
    repo: {
      async saveRuntimeInventoryRecord(record: RuntimeInventory) { records.set(`${record.targetWorkspaceId}:${record.inventorySourceId}`, record); return record; },
      async updateRuntimeInventoryRecord(record: RuntimeInventory) { records.set(`${record.targetWorkspaceId}:${record.inventorySourceId}`, record); return record; },
      async readRuntimeInventoryRecord(targetWorkspaceId: string, inventorySourceId: string) { return records.get(`${targetWorkspaceId}:${inventorySourceId}`); },
      async listRuntimeInventoryRecords(query: { targetWorkspaceId: string }) { return { records: [...records.values()].filter((x) => x.targetWorkspaceId === query.targetWorkspaceId) }; },
      async readLatestRuntimeInventoryRecord() { return undefined; },
    },
    records,
  };
};

const source = {
  sourceId: "src.manual" as never,
  sourceKind: "manual" as const,
  async collectRuntimeInventory({ targetWorkspaceId }: { targetWorkspaceId: string }) {
    return { targetWorkspaceId, inventorySourceId: "src.manual" as never, inventorySourceKind: "manual" as const, discoveredProviderCandidates: [], discoveredCapabilities: [{ capabilityId: "cap.a" as never, capabilityKind: "python-runtime" as const, capabilityKey: "python.3.11", label: "Python", availabilityStatus: "available" as const, diagnostics: [], blockers: [] }], diagnostics: [], blockers: [] };
  },
};

describe("RuntimeCapabilityInventoryService", () => {
  it("refreshes inventory and persists workspace-scoped record", async () => {
    const { repo, records } = mkRepo();
    const service = new RuntimeCapabilityInventoryService(repo as never, [source], () => "2026-05-21T00:00:00.000Z");
    const result = await service.refreshInventoryFromSources({ targetWorkspaceId: createWorkspaceId("workspace.a") });
    assert.equal(result.status, "success");
    assert.equal(records.size, 1);
  });

  it("sanitizes source errors", async () => {
    const { repo } = mkRepo();
    const failing = { sourceId: "src.fail" as never, sourceKind: "manual" as const, async collectRuntimeInventory() { throw new Error("token secret /tmp/path"); } };
    const service = new RuntimeCapabilityInventoryService(repo as never, [failing]);
    const result = await service.refreshInventoryFromSources({ targetWorkspaceId: "workspace.a" });
    assert.equal(result.status, "unavailable");
    assert.equal(JSON.stringify(result).includes("token"), false);
  });

  it("isolates by workspace on list/read", async () => {
    const { repo } = mkRepo();
    const service = new RuntimeCapabilityInventoryService(repo as never, [source]);
    await service.refreshInventoryFromSources({ targetWorkspaceId: "workspace.a" });
    await service.refreshInventoryFromSources({ targetWorkspaceId: "workspace.b" });
    const listA = await service.listRuntimeInventory({ targetWorkspaceId: "workspace.a" });
    assert.equal(listA.status, "success");
    if (listA.status === "success") assert.equal(listA.value.records.length, 1);
    const readMissing = await service.readRuntimeInventory({ targetWorkspaceId: "workspace.a", inventorySourceId: "src.missing" });
    assert.equal(readMissing.status, "not-found");
  });
});

describe("RuntimeCapabilityInventorySummaryService", () => {
  it("summarizes capabilities/providers safely", async () => {
    const { repo } = mkRepo();
    await repo.saveRuntimeInventoryRecord({ targetWorkspaceId: createWorkspaceId("workspace.a"), inventorySourceId: "src.manual" as never, inventorySourceKind: "manual", discoveredProviderCandidates: [{ providerCandidateId: "pc.a" as never, providerKind: "python", inventorySourceId: "src.manual" as never, capabilities: [], availabilityStatus: "available", displayLabel: "Python", diagnostics: [], blockers: [] }], discoveredCapabilities: [{ capabilityId: "cap.a" as never, capabilityKind: "python-runtime", capabilityKey: "python.3.11", label: "Python", availabilityStatus: "available", diagnostics: [], blockers: [] }], inventoryStatus: "checked", diagnostics: [], blockers: [], checkedAt: "2026-05-21T00:00:00.000Z" });
    const service = new RuntimeCapabilityInventorySummaryService(repo as never);
    const result = await service.summarizeRuntimeCapabilities({ targetWorkspaceId: "workspace.a" });
    assert.equal(result.status, "success");
    if (result.status === "success") {
      assert.equal(result.value.capabilities, 1);
      assert.equal(result.value.providerCandidates, 1);
      assert.equal("sourceRecords" in result.value, false);
    }
  });
});


it("reads latest record safely", async () => {
  const { repo } = mkRepo();
  await repo.saveRuntimeInventoryRecord({ targetWorkspaceId: createWorkspaceId("workspace.a"), inventorySourceId: "src.manual" as never, inventorySourceKind: "manual", discoveredProviderCandidates: [], discoveredCapabilities: [], inventoryStatus: "checked", diagnostics: [], blockers: [], checkedAt: "2026-05-21T00:00:00.000Z" });
  repo.readLatestRuntimeInventoryRecord = async (q: any) => (await repo.listRuntimeInventoryRecords({ targetWorkspaceId: q.targetWorkspaceId })).records[0];
  const service = new RuntimeCapabilityInventoryService(repo as never, [source]);
  const result = await service.readLatestRuntimeInventory({ targetWorkspaceId: "workspace.a", sourceId: "src.manual" });
  assert.equal(result.status, "success");
});
