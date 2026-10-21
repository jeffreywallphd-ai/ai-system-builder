import test from "node:test";
import assert from "node:assert/strict";
import {
  RuntimeReadinessValidationService,
  ValidateRuntimeReadinessBindingUseCase,
} from "../index";

const workspaceId = "workspace.main" as never;
const readinessBindingId = "readiness.binding.1" as never;
const compositionPlanId = "composition.plan.1" as never;
const planVersion = "2026-05-21T00:00:00.000Z";
const makePlan = (): any => ({
  planId: compositionPlanId,
  targetWorkspaceId: workspaceId,
  status: "valid",
  updatedAt: planVersion,
  blockers: [],
});

const makeBinding = (): any => ({
  readinessBindingId,
  targetWorkspaceId: workspaceId,
  compositionPlanId,
  compositionPlanValidationAt: planVersion,
  status: "draft",
  requirements: [
    {
      requirementId: "runtime.requirement.1",
      targetWorkspaceId: workspaceId,
      compositionPlanId,
      capabilityKind: "model",
      capabilityKey: "model",
      isRequired: true,
      label: "Model",
      diagnostics: [],
      blockers: [],
    },
  ],
  providerCandidates: [
    {
      providerCandidateId: "runtime.provider-candidate.1",
      providerKind: "manual",
      inventorySourceId: "runtime.inventory-source.1",
      capabilities: [
        {
          capabilityId: "runtime.capability.1",
          capabilityKind: "model",
          capabilityKey: "model",
          label: "model",
          availabilityStatus: "available",
          diagnostics: [],
          blockers: [],
        },
      ],
      availabilityStatus: "available",
      displayLabel: "provider",
      diagnostics: [],
      blockers: [],
    },
  ],
  bindingCandidates: [
    {
      bindingCandidateId: "runtime.binding-candidate.1",
      targetWorkspaceId: workspaceId,
      requirementId: "runtime.requirement.1",
      providerCandidateId: "runtime.provider-candidate.1",
      capabilityId: "runtime.capability.1",
      matchStatus: "matched",
      diagnostics: [],
      blockers: [],
    },
  ],
  bindings: [
    {
      bindingId: "runtime.binding.1",
      targetWorkspaceId: workspaceId,
      readinessBindingId,
      requirementId: "runtime.requirement.1",
      selectedProviderCandidateId: "runtime.provider-candidate.1",
      selectedCapabilityId: "runtime.capability.1",
      status: "selected",
      diagnostics: [],
      blockers: [],
      provenance: [],
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:00:00.000Z",
    },
  ],
  blockers: [],
  diagnostics: [],
  provenance: [],
  createdAt: "2026-05-21T00:00:00.000Z",
  updatedAt: "2026-05-21T00:00:00.000Z",
});

test("validates readiness binding to ready-for-setup and appends provenance", async () => {
  const saved: any[] = [];
  const useCase = new ValidateRuntimeReadinessBindingUseCase({
    bindingRepository: {
      readRuntimeReadinessBindingRecord: async () => makeBinding(),
      saveRuntimeReadinessBindingRecord: async (record: any) => (
        saved.push(record),
        record
      ),
    } as any,
    validationService: new RuntimeReadinessValidationService(),
    compositionRepository: {
      readAssetCompositionPlanRecord: async () => makePlan(),
    },
    now: () => "2026-05-21T01:00:00.000Z",
  });
  const result = await useCase.execute({
    targetWorkspaceId: workspaceId,
    readinessBindingId,
  } as any);
  assert.equal(result.status, "success");
  assert.equal(result.value.status, "ready-for-setup");
  assert.equal(result.value.updatedAt, "2026-05-21T01:00:00.000Z");
  assert.equal(result.value.provenance.at(-1)?.kind, "readiness-validated");
  assert.equal(saved.length, 1);
});

test("fresh authoritative composition preconditions survive otherwise-ready providers", async () => {
  const variants = [
    undefined,
    ...[
      "draft",
      "invalid",
      "archived",
      "blocked",
      "conflicted",
      "unsupported",
      "stale",
    ].map((status) => ({ ...makePlan(), status })),
    { ...makePlan(), updatedAt: "2026-05-22T00:00:00.000Z" },
    { ...makePlan(), updatedAt: undefined },
    { ...makePlan(), targetWorkspaceId: "workspace.foreign" },
    { ...makePlan(), planId: "composition.foreign" },
    { ...makePlan(), archivedAt: planVersion },
    {
      ...makePlan(),
      blockers: [{ code: "fixture-blocked", message: "Blocked plan" }],
    },
  ];
  for (const plan of variants) {
    const binding = makeBinding();
    const useCase = new ValidateRuntimeReadinessBindingUseCase({
      bindingRepository: {
        readRuntimeReadinessBindingRecord: async () => binding,
        saveRuntimeReadinessBindingRecord: async (record: any) => record,
      } as any,
      validationService: new RuntimeReadinessValidationService(),
      compositionRepository: {
        readAssetCompositionPlanRecord: async () => plan,
      },
    });
    const result = await useCase.execute({
      targetWorkspaceId: workspaceId,
      readinessBindingId,
    } as any);
    assert.equal(result.status, "success");
    assert.notEqual(
      result.value.status,
      "ready-for-setup",
      JSON.stringify(plan),
    );
    assert.ok(result.value.blockers.length > 0);
  }
});

test("unavailable authority and substituted binding identity never save or progress", async () => {
  for (const mode of [
    "missing-authority",
    "authority-error",
    "binding-workspace",
    "binding-id",
  ] as const) {
    const binding = makeBinding();
    let saves = 0,
      planReads = 0;
    if (mode === "binding-workspace")
      binding.targetWorkspaceId = "workspace.foreign";
    if (mode === "binding-id") binding.readinessBindingId = "readiness.foreign";
    const useCase = new ValidateRuntimeReadinessBindingUseCase({
      bindingRepository: {
        readRuntimeReadinessBindingRecord: async () => binding,
        saveRuntimeReadinessBindingRecord: async (record: any) => {
          saves++;
          return record;
        },
      } as any,
      validationService: new RuntimeReadinessValidationService(),
      ...(mode === "missing-authority"
        ? {}
        : {
            compositionRepository: {
              readAssetCompositionPlanRecord: async () => {
                planReads++;
                throw new Error("private adapter failure");
              },
            },
          }),
    });
    const result = await useCase.execute({
      targetWorkspaceId: workspaceId,
      readinessBindingId,
    } as any);
    assert.equal(result.status, "failure");
    assert.equal(saves, 0);
    assert.equal(
      JSON.stringify(result).includes("private adapter failure"),
      false,
    );
    if (mode.startsWith("binding-")) assert.equal(planReads, 0);
  }
});

test("corrected current plan and provider recover while repeated failures stay deduplicated", async () => {
  let binding = makeBinding();
  const plan = { ...makePlan(), status: "blocked" };
  binding.providerCandidates[0].availabilityStatus = "not-configured";
  const useCase = new ValidateRuntimeReadinessBindingUseCase({
    bindingRepository: {
      readRuntimeReadinessBindingRecord: async () => binding,
      saveRuntimeReadinessBindingRecord: async (record: any) => {
        binding = record;
        return record;
      },
    } as any,
    validationService: new RuntimeReadinessValidationService(),
    compositionRepository: { readAssetCompositionPlanRecord: async () => plan },
  });
  const command = { targetWorkspaceId: workspaceId, readinessBindingId } as any;
  const first = await useCase.execute(command),
    repeated = await useCase.execute(command);
  assert.equal(first.status, "success");
  assert.equal(repeated.status, "success");
  assert.equal(first.value.status, "blocked");
  assert.deepEqual(repeated.value.blockers, first.value.blockers);
  assert.equal(
    repeated.value.blockers.filter(
      (b: any) => b.code === "runtime-readiness-provider-not-configured",
    ).length,
    1,
  );
  plan.status = "valid";
  binding.providerCandidates[0].availabilityStatus = "available";
  const recovered = await useCase.execute(command);
  assert.equal(recovered.status, "success");
  assert.equal(recovered.value.status, "ready-for-setup");
  assert.deepEqual(recovered.value.blockers, []);
  assert.equal(recovered.value.bindings[0].status, "selected");
});

test("validator retains supplied authoritative blockers without duplicates", () => {
  const binding = makeBinding();
  const blocker = {
    code: "runtime-readiness-composition-plan-stale",
    message: "Current plan evidence is stale.",
    safeDetails: {
      retryAllowed: false,
      remaining: 0,
      context: { reason: "current" },
    },
  };
  binding.blockers = [blocker, { ...blocker }];
  const result = new RuntimeReadinessValidationService().validate(
    binding,
    workspaceId,
  );
  assert.equal(result.status, "stale");
  assert.deepEqual(result.blockers, [blocker]);
});

test("provider recovery does not promote invalid or unmatched selection", () => {
  for (const mode of [
    "invalid",
    "candidate",
    "unmatched",
    "blocked-candidate",
  ]) {
    const binding = makeBinding();
    if (mode === "unmatched")
      binding.bindingCandidates[0].matchStatus = "invalid";
    else if (mode === "blocked-candidate")
      binding.bindingCandidates[0].blockers = [
        {
          code: "runtime-readiness-permission-required",
          message: "Selection is blocked.",
        },
      ];
    else binding.bindings[0].status = mode;
    const result = new RuntimeReadinessValidationService().validate(
      binding,
      workspaceId,
    );
    assert.notEqual(result.status, "ready-for-setup", mode);
    assert.notEqual(result.bindings[0].status, "selected", mode);
  }
  const binding = makeBinding();
  binding.bindings[0].status = "invalid";
  binding.providerCandidates[0].availabilityStatus = "unavailable";
  const service = new RuntimeReadinessValidationService();
  const unavailable = service.validate(binding, workspaceId);
  binding.bindings = unavailable.bindings;
  binding.providerCandidates[0].availabilityStatus = "available";
  assert.equal(
    service.validate(binding, workspaceId).bindings[0].status,
    "invalid",
  );
});

test("requires explicit workspace and readiness binding id", async () => {
  const useCase = new ValidateRuntimeReadinessBindingUseCase({
    bindingRepository: {} as any,
    validationService: new RuntimeReadinessValidationService(),
  });
  const result = await useCase.execute({} as any);
  assert.equal(result.status, "failure");
  assert.equal(result.failure.code, "runtime-readiness-workspace-required");
});

test("returns not-found for missing binding and rejects archived binding", async () => {
  const useCase1 = new ValidateRuntimeReadinessBindingUseCase({
    bindingRepository: {
      readRuntimeReadinessBindingRecord: async () => undefined,
    } as any,
    validationService: new RuntimeReadinessValidationService(),
  });
  const missing = await useCase1.execute({
    targetWorkspaceId: workspaceId,
    readinessBindingId,
  } as any);
  assert.equal(missing.status, "failure");
  assert.equal(missing.failure.kind, "not-found");

  const archivedBinding = makeBinding();
  archivedBinding.status = "archived";
  const useCase2 = new ValidateRuntimeReadinessBindingUseCase({
    bindingRepository: {
      readRuntimeReadinessBindingRecord: async () => archivedBinding,
    } as any,
    validationService: new RuntimeReadinessValidationService(),
  });
  const archived = await useCase2.execute({
    targetWorkspaceId: workspaceId,
    readinessBindingId,
  } as any);
  assert.equal(archived.status, "failure");
  assert.equal(
    archived.failure.code,
    "runtime-readiness-composition-plan-not-valid",
  );
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
  binding.providerCandidates[0].capabilities[0].availabilityStatus =
    "unavailable";
  result = service.validate(binding, workspaceId);
  assert.equal(result.status, "provider-unavailable");
});
