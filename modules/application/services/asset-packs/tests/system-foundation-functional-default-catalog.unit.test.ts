import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ASSET_IMPLEMENTATION_DEPLOYMENT_PROFILES } from "../../../../contracts/asset-implementation";
import {
  SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS,
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  readSystemFoundationFunctionalDefault,
} from "../index";

describe("system foundation functional-default catalog", () => {
  it("maps every exact immutable foundation definition once", () => {
    assert.equal(
      SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS.length,
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length,
    );
    assert.equal(
      new Set(
        SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS.map((item) => item.definitionId),
      ).size,
      SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS.length,
    );

    for (const entry of SYSTEM_FOUNDATION_PACK_MANIFEST.assets) {
      const descriptor = readSystemFoundationFunctionalDefault(
        String(entry.definition.definitionId),
        entry.definition.version,
      );
      assert.ok(descriptor, entry.entryId);
      assert.equal(descriptor.definitionVersion, entry.definition.version);
      assert.equal(
        descriptor.entryKey,
        `foundation.${entry.definition.definitionId}`,
      );
      assert.deepEqual(
        descriptor.deploymentProfiles,
        ASSET_IMPLEMENTATION_DEPLOYMENT_PROFILES,
      );
      assert.equal(
        JSON.stringify(descriptor.previewFixture).length < 10_000,
        true,
      );
      assert.equal(
        JSON.stringify(descriptor.previewConfiguration).length < 10_000,
        true,
      );
      assert.deepEqual(descriptor.requiredCapabilities, []);
    }
  });

  it("keeps security and policy defaults fail closed and authority free", () => {
    const policyDefaults = SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS.filter(
      (item) =>
        item.definitionId.startsWith("builtin.security.") ||
        item.facetKind === "policy",
    );
    assert.ok(policyDefaults.length >= 4);
    for (const descriptor of policyDefaults) {
      assert.equal(descriptor.failClosed, true, descriptor.definitionId);
      assert.equal(descriptor.previewKind, "policy", descriptor.definitionId);
      assert.deepEqual(descriptor.requiredCapabilities, []);
      assert.match(JSON.stringify(descriptor.previewFixture), /deny/i);
    }
  });

  it("includes functional form, data-preview, and conversational construction paths", () => {
    for (const definitionId of [
      "builtin.feature.record-form",
      "builtin.feature.data-preview",
      "conversation.basic-assistant-system",
    ]) {
      assert.ok(
        readSystemFoundationFunctionalDefault(definitionId),
        definitionId,
      );
    }
  });
});
