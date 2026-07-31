import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionStep } from "../../../../contracts/execution-plans";
import type { RuntimeReadinessBinding } from "../../../../contracts/runtime-readiness";
import { ExecutionPlanProviderPlanningService } from "../execution-plan-provider-planning.service";

const mkStep = (kind: ExecutionStep["kind"], summary = "safe summary"): ExecutionStep => ({
  id: "es_1" as never,
  sourceCompositionPlanId: "acp_1",
  kind,
  status: "planned",
  label: "step",
  summary,
  requiredAdapterReferenceIds: [],
  inputIds: [],
  outputIds: [],
  dependencyIds: [],
  safetyGateIds: [],
  blockers: [],
  diagnostics: [],
});

const readiness: RuntimeReadinessBinding = {
  readinessBindingId: "rrb_1" as never,
  targetWorkspaceId: "workspace.a" as never,
  compositionPlanId: "acp_1" as never,
  status: "ready",
  requirements: [],
  providerCandidates: [
    {
      providerCandidateId: "provider.image" as never,
      providerKind: "comfyui",
      inventorySourceId: "runtime.local" as never,
      availabilityStatus: "available",
      displayLabel: "ComfyUI",
      capabilities: [
        {
          capabilityId: "cap.image" as never,
          capabilityKind: "image-generation-runtime",
          capabilityKey: "image.generate",
          label: "Image generation",
          availabilityStatus: "available",
          diagnostics: [],
          blockers: [],
        },
      ],
      diagnostics: [],
      blockers: [],
    },
  ],
  bindingCandidates: [],
  bindings: [
    {
      bindingId: "binding.image" as never,
      targetWorkspaceId: "workspace.a" as never,
      readinessBindingId: "rrb_1" as never,
      requirementId: "requirement.image" as never,
      selectedProviderCandidateId: "provider.image" as never,
      selectedCapabilityId: "cap.image" as never,
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
};

test("provider planning attaches available adapter references from readiness bindings", () => {
  const service = new ExecutionPlanProviderPlanningService();
  const result = service.plan({
    planId: "ep_1",
    sourceRuntimeReadinessBindingId: "rrb_1",
    readiness,
    steps: [mkStep("generate-image"), mkStep("manual-review")],
    createAdapterReferenceId: () => "ear_1",
  });

  assert.equal(result.adapterReferences.length, 1);
  assert.equal(result.adapterReferences[0].status, "available-by-readiness");
  assert.equal(result.adapterReferences[0].capabilityKind, "image-generation-runtime");
  assert.equal(result.steps[0].requiredAdapterReferenceIds.length, 1);
  assert.equal(result.steps[1].requiredAdapterReferenceIds.length, 0);
});

test("provider planning emits setup blockers when no selected provider matches", () => {
  const service = new ExecutionPlanProviderPlanningService();
  const result = service.plan({
    planId: "ep_1",
    sourceRuntimeReadinessBindingId: "rrb_1",
    readiness: { ...readiness, bindings: [] },
    steps: [mkStep("generate-image")],
    createAdapterReferenceId: () => "ear_1",
  });

  assert.equal(result.adapterReferences[0].status, "needs-setup");
  assert.equal(result.blockers.some((b) => b.code === "execution-plan-provider-setup-required"), true);
  assert.equal(JSON.stringify(result).includes("workflow"), false);
});
