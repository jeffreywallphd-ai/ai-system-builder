import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { AssetReference } from "../../../../contracts/asset";
import {
  createAmbiguousOverrideConflictFixture,
  createExactAssetResolutionRequest,
  createResolutionTraceFixture,
  createSemanticAssetResolutionRequest,
  exactResolutionBypassesOverridesByDefault,
  semanticResolutionCanOptIntoOverrides,
} from "../asset-resolution-planning.service";

describe("asset resolution planning service", () => {
  it("defaults exact resolution requests to bypass overrides", () => {
    const request = createExactAssetResolutionRequest(definitionVersionRef());
    assert.equal(request.mode, "exact");
    assert.equal(request.allowOverrides, false);
    assert.equal(exactResolutionBypassesOverridesByDefault(request), true);
  });

  it("allows semantic resolution requests to opt into overrides", () => {
    const request = createSemanticAssetResolutionRequest(definitionRef(), {
      scope: "workspace",
      sourceLayerPreference: ["workspace-pack", "system-default"],
      allowOverrides: true,
    });
    assert.equal(request.mode, "semantic");
    assert.equal(request.allowOverrides, true);
    assert.equal(semanticResolutionCanOptIntoOverrides(request), true);
  });

  it("creates resolution trace fixtures with applied override rule IDs", () => {
    const result = createResolutionTraceFixture({
      requestedRef: definitionRef(),
      resolvedRef: replacementRef(),
      appliedOverrideRuleIds: ["workspace.fixture.override"],
    });

    assert.deepEqual(result.appliedOverrideRuleIds, ["workspace.fixture.override"]);
    assert.equal(result.trace[0]?.appliedOverrideRuleId, "workspace.fixture.override");
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  });

  it("creates conflict diagnostic fixtures for ambiguous overrides", () => {
    const conflict = createAmbiguousOverrideConflictFixture({
      conflictId: "resolution.conflict.fixture",
      targetRef: definitionRef(),
      candidateRefs: [definitionVersionRef(), replacementRef()],
      overrideRuleIds: ["workspace.fixture.override", "user.fixture.override"],
    });
    const result = createResolutionTraceFixture({
      requestedRef: definitionRef(),
      conflicts: [conflict],
    });

    assert.equal(result.conflicts[0]?.candidateRefs.length, 2);
    assert.deepEqual(result.conflicts[0]?.overrideRuleIds, [
      "workspace.fixture.override",
      "user.fixture.override",
    ]);
  });

  it("does not include repository or pack activation behavior", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "modules/application/services/asset-packs/asset-resolution-planning.service.ts",
      ),
      "utf8",
    );
    assert.doesNotMatch(source, /\b(?:Repository|registry|activate|install|disable|save|fetch\(|node:fs|node:path)\b/i);
  });
});

function definitionRef(): AssetReference {
  return { kind: "asset-definition", id: "system.foundation.fixture" as never };
}

function definitionVersionRef(): AssetReference {
  return {
    kind: "asset-definition-version",
    id: "system.foundation.fixture" as never,
    version: "1.0.0",
  };
}

function replacementRef(): AssetReference {
  return { kind: "asset-definition", id: "workspace.foundation.fixture" as never };
}
