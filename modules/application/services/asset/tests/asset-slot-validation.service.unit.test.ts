import { describe, expect, it } from "../../../../testing/node-test";

import {
  ASSET_SLOT_DEFINITION_SCHEMA_VERSION,
  normalizeAssetId,
  normalizeAssetSlotDefinition,
  type AssetDefinition,
} from "../../../../contracts/asset";
import { validateAssetDefinition } from "../validate-asset-definition.service";

function definition(): AssetDefinition {
  return {
    definitionId: normalizeAssetId("builtin.layout.test"),
    assetType: "ui-component",
    assetFamily: "structural",
    version: "2.0.0",
    displayName: "Test layout",
    description: "Test slot-aware layout.",
    lifecycleStatus: "published",
    provenance: { sourceKind: "system-generated" },
    slots: [
      normalizeAssetSlotDefinition({
        schemaVersion: ASSET_SLOT_DEFINITION_SCHEMA_VERSION,
        slotId: "content" as never,
        displayName: "Content",
        cardinality: { minItems: 1, maxItems: 8 },
        acceptedAssetTypes: ["page", "ui-component"],
      }),
    ],
    aiContext: {
      purpose: "Contain compatible visual children.",
      userFacingSummary: "A bounded layout.",
      developerFacingSummary: "A declarative slot-aware definition.",
      capabilities: [{ capabilityId: "layout", summary: "Contains children." }],
      limitations: [
        { limitationId: "no-code", summary: "Does not execute code." },
      ],
    },
  };
}

describe("slot-aware asset definition validation", () => {
  it("accepts canonical slot definitions", () => {
    expect(validateAssetDefinition(definition()).status).not.toBe("invalid");
  });

  it("rejects noncanonical and unsupported slot definitions safely", () => {
    const noncanonical = {
      ...definition(),
      slots: [{ ...definition().slots![0], slotId: " Content " }],
    } as AssetDefinition;
    const invalid = {
      ...definition(),
      slots: [
        {
          ...definition().slots![0],
          schemaVersion: "asset-slot-definition.v9",
        },
      ],
    } as unknown as AssetDefinition;

    expect(
      validateAssetDefinition(noncanonical).issues.some(
        (issue) => issue.path?.[0] === "slots",
      ),
    ).toBe(true);
    expect(
      validateAssetDefinition(invalid).issues.some(
        (issue) => issue.path?.[0] === "slots" && !issue.message.includes("v9"),
      ),
    ).toBe(true);
  });
});
