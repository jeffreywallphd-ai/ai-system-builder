import assert from "node:assert/strict";
import { describe, it } from "../../../testing/node-test";
import { createWorkspaceId } from "../../workspace";
import * as contracts from "..";

describe("asset composition contracts", () => {
  const ws = createWorkspaceId("workspace.alpha");
  it("normalizes identities/statuses/roles/kinds", () => {
    assert.equal(contracts.normalizeAssetCompositionPlanId("plan.alpha"), "plan.alpha");
    assert.equal(contracts.normalizeAssetCompositionPlanStatus("valid"), "valid");
    assert.equal(contracts.normalizeAssetCompositionNodeStatus("planned"), "planned");
    assert.equal(contracts.normalizeAssetCompositionCompatibilityStatus("compatible"), "compatible");
    assert.equal(contracts.normalizeAssetCompositionNodeRole("model"), "model");
    assert.equal(contracts.normalizeAssetCompositionRelationshipKind("depends-on"), "depends-on");
    assert.throws(() => contracts.normalizeAssetCompositionPlanStatus("execution-ready"));
  });
  it("supports non-throwing helpers without echoing unsafe values", () => {
    const result = contracts.tryNormalizeSelectedAssetProjectionReference({ targetWorkspaceId: ws, projectionId: "projection.a" as never, displayLabel: "prompt text" });
    assert.equal(result.status, "failure");
    if (result.status === "failure") assert.equal(result.diagnostics[0]?.message.includes("prompt text"), false);
  });
  it("normalizes plan/provenance/diagnostics safely", () => {
    const d = contracts.normalizeAssetCompositionDiagnostic({ code: "asset-composition-workspace-required", severity: "error", message: "/tmp/path", safeDetails: { reason: "bad" } });
    assert.equal(d.message.includes("/tmp"), false);
    const p = contracts.normalizeAssetCompositionProvenanceEvent({ kind: "plan-created", targetWorkspaceId: ws, operationAt: "2026-05-20T00:00:00.000Z", planId: "plan.alpha" as never });
    assert.equal(p.kind, "plan-created");
    assert.throws(() => contracts.normalizeAssetCompositionProvenanceEvent({ kind: "plan-created", targetWorkspaceId: ws, operationAt: "bad", actor: { actorType: "user", actorId: "a" } as never }));
  });
});
