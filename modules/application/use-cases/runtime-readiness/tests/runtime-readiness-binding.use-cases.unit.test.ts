import test from "node:test";
import assert from "node:assert/strict";
import { CreateRuntimeReadinessBindingUseCase, RuntimeBindingCandidateSelectionService, RuntimeCapabilityMatchingService, RuntimeRequirementExtractionService } from "../index";

const workspaceId = "workspace.main" as never;
const planId = "composition.plan.main" as never;

const basePlan = {
  planId,
  targetWorkspaceId: workspaceId,
  status: "valid",
  nodes: [{ nodeId: "node.a", requiredCapabilities: [{ kind: "model", key: "model", direction: "required" }] }],
  relationships: [],
  selectedProjections: [], blockers: [], compatibilityDiagnostics: [], createdAt: "2026-05-21T00:00:00.000Z", updatedAt: "2026-05-21T00:00:00.000Z", provenance: [], planningSummary: { selectedProjectionCount: 0, nodeCount: 1, relationshipCount: 0, requiredCapabilityCount: 1, missingCapabilityCount: 0, conflictCount: 0, blockerCount: 0, warningCount: 0, planningReadiness: "planning-ready" },
} as any;

const inventory = { targetWorkspaceId: workspaceId, inventorySourceId: "inventory.main", inventorySourceKind: "manual", inventoryStatus: "checked", discoveredProviderCandidates: [{ providerCandidateId: "provider.main", providerKind: "manual", inventorySourceId: "inventory.main", capabilities: [{ capabilityId: "cap.main", capabilityKind: "model", capabilityKey: "model", label: "cap", availabilityStatus: "available", diagnostics: [], blockers: [] }], availabilityStatus: "available", displayLabel: "provider", diagnostics: [], blockers: [] }], discoveredCapabilities: [], diagnostics: [], blockers: [], checkedAt: "2026-05-21T00:00:00.000Z" } as any;

test("creates readiness binding for validated plan", async () => {
  const saved: any[] = [];
  const useCase = new CreateRuntimeReadinessBindingUseCase({
    compositionRepository: { readAssetCompositionPlanRecord: async () => structuredClone(basePlan) } as any,
    inventoryRepository: { listRuntimeInventoryRecords: async () => ({ records: [inventory] }) } as any,
    bindingRepository: { saveRuntimeReadinessBindingRecord: async (record: any) => (saved.push(record), record) } as any,
    requirementExtractionService: new RuntimeRequirementExtractionService(), capabilityMatchingService: new RuntimeCapabilityMatchingService(), candidateSelectionService: new RuntimeBindingCandidateSelectionService(),
    nextReadinessBindingId: () => "readiness.binding.1", nextRequirementId: () => "runtime.requirement.1", nextBindingCandidateId: () => "runtime.binding-candidate.1", nextBindingId: () => "runtime.binding.1", now: () => "2026-05-21T01:00:00.000Z",
  });
  const result = await useCase.execute({ targetWorkspaceId: workspaceId, compositionPlanId: planId } as any);
  assert.equal(result.status, "success");
  assert.equal(result.value.status, "ready-for-setup");
  assert.equal(saved.length, 1);
});

test("returns not-found for missing plan", async () => {
  const useCase = new CreateRuntimeReadinessBindingUseCase({ compositionRepository: { readAssetCompositionPlanRecord: async () => undefined } as any, inventoryRepository: { listRuntimeInventoryRecords: async () => ({ records: [inventory] }) } as any, bindingRepository: { saveRuntimeReadinessBindingRecord: async (record: any) => record } as any, requirementExtractionService: new RuntimeRequirementExtractionService(), capabilityMatchingService: new RuntimeCapabilityMatchingService(), candidateSelectionService: new RuntimeBindingCandidateSelectionService(), nextReadinessBindingId: () => "readiness.binding.1", nextRequirementId: () => "runtime.requirement.1", nextBindingCandidateId: () => "runtime.binding-candidate.1", nextBindingId: () => "runtime.binding.1" });
  const result = await useCase.execute({ targetWorkspaceId: workspaceId, compositionPlanId: planId } as any);
  assert.equal(result.status, "failure");
  assert.equal(result.failure.kind, "not-found");
});


test("uses consistent readiness binding id across record bindings provenance", async () => {
  const saved: any[] = [];
  const useCase = new CreateRuntimeReadinessBindingUseCase({
    compositionRepository: { readAssetCompositionPlanRecord: async () => structuredClone(basePlan) } as any,
    inventoryRepository: { listRuntimeInventoryRecords: async () => ({ records: [inventory] }) } as any,
    bindingRepository: { saveRuntimeReadinessBindingRecord: async (record: any) => (saved.push(record), record) } as any,
    requirementExtractionService: new RuntimeRequirementExtractionService(), capabilityMatchingService: new RuntimeCapabilityMatchingService(), candidateSelectionService: new RuntimeBindingCandidateSelectionService(),
    nextReadinessBindingId: () => "readiness.binding.42", nextRequirementId: () => "runtime.requirement.1", nextBindingCandidateId: () => "runtime.binding-candidate.1", nextBindingId: () => "runtime.binding.1", now: () => "2026-05-21T01:00:00.000Z",
  });
  const result = await useCase.execute({ targetWorkspaceId: workspaceId, compositionPlanId: planId } as any);
  assert.equal(result.status, "success");
  const record = saved[0];
  assert.equal(record.readinessBindingId, "readiness.binding.42");
  assert.equal(record.bindings[0].readinessBindingId, "readiness.binding.42");
  assert.equal(record.provenance[0].readinessBindingId, "readiness.binding.42");
});
