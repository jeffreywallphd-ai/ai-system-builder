import assert from "node:assert/strict";
import { describe, it } from "../../../testing/node-test";
import { normalizeAssetId, normalizeAssetReferenceKind } from "../../asset";
import { createWorkspaceId } from "../../workspace";
import * as contracts from "..";

describe("effective-asset-projection contracts", () => {
  const workspaceId = createWorkspaceId("workspace.alpha");
  const assetRef = { kind: normalizeAssetReferenceKind("asset-definition"), id: normalizeAssetId("asset.alpha"), version: "1.0.0" };

  it("normalizes valid IDs and rejects unsafe IDs without echoing raw values", () => {
    assert.equal(contracts.normalizeEffectiveAssetProjectionId(" projection.alpha "), "projection.alpha");
    for (const invalid of ["", " ", "../x", "https://x", "ghp_secret", "path/x"]) {
      assert.throws(() => contracts.normalizeEffectiveAssetProjectionId(invalid), (e: unknown) => {
        assert.ok(e instanceof Error);
        if (invalid.trim().length > 0) {
          assert.equal(e.message.includes(invalid), false);
        }
        return true;
      });
    }
  });

  it("normalizes supported status/policy/source and rejects unsupported runtime-like values", () => {
    assert.equal(contracts.normalizeEffectiveAssetProjectionStatus(" READY "), "ready");
    assert.equal(contracts.normalizeEffectiveAssetProjectionPolicy("safe-fields-only"), "safe-fields-only");
    assert.equal(contracts.normalizeEffectiveAssetProjectionSourceKind("workspace-authored"), "workspace-authored");
    assert.throws(() => contracts.normalizeEffectiveAssetProjectionStatus("auto-sync"));
    assert.throws(() => contracts.normalizeEffectiveAssetProjectionPolicy("provider-payload-materialization"));
    assert.throws(() => contracts.normalizeEffectiveAssetProjectionSourceKind("workspace-live-link"));
  });

  it("accepts only safe projected fields and safe nested metadata", () => {
    assert.equal(contracts.normalizeSafeEffectiveAssetProjectedField("display-name"), "display-name");
    assert.throws(() => contracts.normalizeSafeEffectiveAssetProjectedField("prompt-text"));
    assert.throws(() => contracts.normalizeSafeEffectiveAssetProjectedField("workflow-json"));
    assert.throws(() => contracts.normalizeSafeEffectiveAssetProjectedFieldPatch({ "safe-metadata": { "token.secret": "x" } as any }));
  });

  it("requires explicit workspace ids on commands and normalizes projection records", () => {
    const cmd = contracts.normalizeCreateEffectiveAssetProjectionCommand({
      targetWorkspaceId: workspaceId,
      source: { sourceKind: "workspace-authored", targetWorkspaceId: workspaceId, effectiveAssetReference: assetRef },
      target: { targetWorkspaceId: workspaceId, effectiveAssetReference: assetRef, intendedPolicy: "safe-fields-only" },
      policy: "safe-fields-only",
    });
    assert.equal(cmd.targetWorkspaceId, workspaceId);

    const record = contracts.normalizeEffectiveAssetProjectionRecord({
      projectionId: "projection.alpha" as any,
      targetWorkspaceId: workspaceId,
      source: { sourceKind: "workspace-authored-draft", targetWorkspaceId: workspaceId, effectiveAssetReference: assetRef },
      target: { targetWorkspaceId: workspaceId, effectiveAssetReference: assetRef, intendedPolicy: "draft-preview-only" },
      effectiveAssetReference: assetRef,
      sourceKind: "workspace-authored-draft",
      status: "draft-only",
      policy: "draft-preview-only",
      projectedFields: { "display-name": "Draft" },
      diagnostics: [], blockers: [], provenance: { kind: "projected-from-authored-draft-preview", targetWorkspaceId: workspaceId, operationAt: "2026-05-20T00:00:00.000Z" },
      createdAt: "2026-05-20T00:00:00.000Z", updatedAt: "2026-05-20T00:00:00.000Z",
    });
    assert.equal(record.status, "draft-only");
  });

  it("result shapes are discriminated and diagnostics are sanitized", () => {
    const failure: contracts.CreateEffectiveAssetProjectionResult = { status: "failure", failure: { kind: "validation", code: "effective-projection-source-required", diagnostics: [{ code: "effective-projection-source-required", message: "raw /tmp/x" }] } };
    assert.equal(failure.status, "failure");
    assert.equal(contracts.normalizeEffectiveAssetProjectionDiagnostic(failure.failure.diagnostics[0]).message.includes("/tmp"), false);
  });

  it("exports from family and root barrel", async () => {
    assert.equal(typeof contracts.normalizeEffectiveAssetProjectionId, "function");
    const root = await import("../../index");
    assert.equal(typeof root.effectiveAssetProjections.normalizeEffectiveAssetProjectionId, "function");
  });
});
