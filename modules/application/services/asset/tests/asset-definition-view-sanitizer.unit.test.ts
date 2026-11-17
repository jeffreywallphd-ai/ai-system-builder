import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeAssetDefinitionList, sanitizeAssetDefinitionView } from "../asset-definition-view-sanitizer";
import { sanitizeAssetMetadata } from "../asset-safe-metadata";

test("canonical authoring summaries survive definition projections without weakening metadata filtering", () => {
  const card = { definitionId: "definition.a", assetAuthoringEffectiveSourceSummary: {
    targetWorkspaceId: "workspace.a", authoredAssetId: "authored.a", effectiveSourceKind: "workspace-authored",
    assetReference: { kind: "asset-definition", id: "definition.a" }, providerPayload: "private",
    diagnostics: [{ message: "Safe message", metadata: { token: "private" } }],
  }, metadata: { assetAuthoringEffectiveSourceSummary: "private", authorization: "private" } } as any;
  for (const projected of [sanitizeAssetDefinitionView(card), sanitizeAssetDefinitionList({items: [card]}).items[0]]) {
    assert.equal(projected.assetAuthoringEffectiveSourceSummary.authoredAssetId, "authored.a");
    assert.equal(projected.assetAuthoringEffectiveSourceSummary.effectiveSourceKind, "workspace-authored");
    assert.ok(!JSON.stringify(projected).includes("private"));
  }
  assert.equal(sanitizeAssetMetadata({assetAuthoringEffectiveSourceSummary: "private", auth: "private"}), undefined);
});
