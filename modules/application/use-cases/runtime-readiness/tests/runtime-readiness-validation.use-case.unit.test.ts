import test from "node:test";
import assert from "node:assert/strict";
import { RuntimeReadinessValidationService, ValidateRuntimeReadinessBindingUseCase } from "../index";

const workspaceId = "workspace.main" as never;
const readinessBindingId = "readiness.binding.1" as never;
const compositionPlanId = "composition.plan.1" as never;

const makeBinding = (): any => ({
  readinessBindingId, targetWorkspaceId: workspaceId, compositionPlanId, status: "draft", requirements: [
    { requirementId: "runtime.requirement.1", targetWorkspaceId: workspaceId, compositionPlanId, capabilityKind: "model", capabilityKey: "model", isRequired: true, label: "Model", diagnostics: [], blockers: [] },
  ],
  providerCandidates: [{ providerCandidateId: "runtime.provider-candidate.1", providerKind: "manual", inventorySourceId: "runtime.inventory-source.1", capabilities: [{ capabilityId: "runtime.capability.1", capabilityKind: "model", capabilityKey: "model", label: "model", availabilityStatus: "available", diagnostics: [], blockers: [] }], availabilityStatus: "available", displayLabel: "provider", diagnostics: [], blockers: [] }],
  bindingCandidates: [{ bindingCandidateId: "runtime.binding-candidate.1", targetWorkspaceId: workspaceId, requirementId: "runtime.requirement.1", providerCandidateId: "runtime.provider-candidate.1", capabilityId: "runtime.capability.1", matchStatus: "matched", diagnostics: [], blockers: [] }],
  bindings: [{ bindingId: "runtime.binding.1", targetWorkspaceId: workspaceId, readinessBindingId, requirementId: "runtime.requirement.1", selectedProviderCandidateId: "runtime.provider-candidate.1", selectedCapabilityId: "runtime.capability.1", status: "selected", diagnostics: [], blockers: [], provenance: [], createdAt: "2026-05-21T00:00:00.000Z", updatedAt: "2026-05-21T00:00:00.000Z" }], blockers: [], diagnostics: [], provenance: [], createdAt: "2026-05-21T00:00:00.000Z", updatedAt: "2026-05-21T00:00:00.000Z",
});

test("validates readiness binding to ready-for-setup and appends provenance", async () => {
  const saved: any[] = [];
  const useCase = new ValidateRuntimeReadinessBindingUseCase({
    bindingRepository: { readRuntimeReadinessBindingRecord: async () => makeBinding(), saveRuntimeReadinessBindingRecord: async (record: any) => (saved.push(record), record) } as any,
    validationService: new RuntimeReadinessValidationService(),
    now: () => "2026-05-21T01:00:00.000Z",
  });
  const result = await useCase.execute({ targetWorkspaceId: workspaceId, readinessBindingId } as any);
  assert.equal(result.status, "success");
  assert.equal(result.value.status, "ready-for-setup");
  assert.equal(result.value.updatedAt, "2026-05-21T01:00:00.000Z");
  assert.equal(result.value.provenance.at(-1)?.kind, "readiness-validated");
  assert.equal(saved.length, 1);
});

test("requires explicit workspace and readiness binding id", async () => {
  const useCase = new ValidateRuntimeReadinessBindingUseCase({ bindingRepository: {} as any, validationService: new RuntimeReadinessValidationService() });
  const result = await useCase.execute({} as any);
  assert.equal(result.status, "failure");
  assert.equal(result.failure.code, "runtime-readiness-workspace-required");
});

test("returns not-found for missing binding and rejects archived binding", async () => {
  const useCase1 = new ValidateRuntimeReadinessBindingUseCase({ bindingRepository: { readRuntimeReadinessBindingRecord: async () => undefined } as any, validationService: new RuntimeReadinessValidationService() });
  const missing = await useCase1.execute({ targetWorkspaceId: workspaceId, readinessBindingId } as any);
  assert.equal(missing.status, "failure");
  assert.equal(missing.failure.kind, "not-found");

  const archivedBinding = makeBinding(); archivedBinding.status = "archived";
  const useCase2 = new ValidateRuntimeReadinessBindingUseCase({ bindingRepository: { readRuntimeReadinessBindingRecord: async () => archivedBinding } as any, validationService: new RuntimeReadinessValidationService() });
  const archived = await useCase2.execute({ targetWorkspaceId: workspaceId, readinessBindingId } as any);
  assert.equal(archived.status, "failure");
  assert.equal(archived.failure.code, "runtime-readiness-composition-plan-not-valid");
});

test("validation service detects missing references and status priority", () => {
  const service = new RuntimeReadinessValidationService();
  const binding = makeBinding();
  binding.bindings[0].requirementId = "runtime.requirement.missing";
  binding.bindingCandidates = [];
  const result = service.validate(binding, workspaceId);
  assert.equal(result.status, "invalid");
});

test("provider/capability status handling for required and optional", () => {
  const service = new RuntimeReadinessValidationService();
  const binding = makeBinding();
  binding.providerCandidates[0].availabilityStatus = "not-configured";
  let result = service.validate(binding, workspaceId);
  assert.equal(result.status, "configuration-required");

  binding.providerCandidates[0].availabilityStatus = "permission-required";
  result = service.validate(binding, workspaceId);
  assert.equal(result.status, "permission-required");

  binding.providerCandidates[0].availabilityStatus = "stale";
  result = service.validate(binding, workspaceId);
  assert.equal(result.status, "stale");

  binding.providerCandidates[0].availabilityStatus = "available";
  binding.providerCandidates[0].capabilities[0].availabilityStatus = "unavailable";
  result = service.validate(binding, workspaceId);
  assert.equal(result.status, "provider-unavailable");
});
