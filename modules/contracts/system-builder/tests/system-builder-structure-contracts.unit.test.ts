import { describe, expect, it } from "../../../testing/node-test";

import {
  ASSET_PLACEMENT_SCHEMA_VERSION,
  normalizeAssetId,
  type AssetPlacement,
} from "../../asset";
import {
  SYSTEM_BUILDER_STRUCTURE_SCHEMA_VERSION,
  classifySystemBuilderStructure,
  normalizeSystemBuilderProfile,
  normalizeSystemBuilderStructure,
} from "..";

const placement: AssetPlacement = {
  schemaVersion: ASSET_PLACEMENT_SCHEMA_VERSION,
  placementId: "placement.shell",
  parentInstanceRef: {
    kind: "asset-instance",
    id: normalizeAssetId("instance.system"),
  },
  slotId: "application-shell" as AssetPlacement["slotId"],
  childInstanceRef: {
    kind: "asset-instance",
    id: normalizeAssetId("instance.shell"),
  },
  order: 0,
};

describe("System Builder structure contracts", () => {
  it("normalizes canonical profiles and exact layout preset references", () => {
    expect(normalizeSystemBuilderProfile(" Interactive ")).toBe("interactive");
    expect(
      normalizeSystemBuilderStructure({
        schemaVersion: SYSTEM_BUILDER_STRUCTURE_SCHEMA_VERSION,
        profile: "interactive",
        layoutPresetRef: {
          kind: "asset-definition-version",
          id: normalizeAssetId("builtin.layout.application.standard"),
          version: "2.0.0",
        },
      }),
    ).toMatchObject({
      profile: "interactive",
      layoutPresetRef: { version: "2.0.0" },
    });
  });

  it("classifies historical omissions as legacy without inventing placements", () => {
    const historical = { placements: undefined };
    expect(classifySystemBuilderStructure(historical)).toEqual({
      status: "legacy-flat",
    });
    expect(historical.placements).toBeUndefined();
  });

  it("requires a supported descriptor whenever placements exist", () => {
    expect(() =>
      classifySystemBuilderStructure({ placements: [placement] }),
    ).toThrow(/structure descriptor/i);
    expect(() =>
      normalizeSystemBuilderStructure({
        schemaVersion: "system-builder-structure.v2" as never,
        profile: "interactive",
      }),
    ).toThrow(/schema version/i);
    expect(() => normalizeSystemBuilderProfile("desktop-app")).toThrow(
      /unsupported/i,
    );
  });
});
