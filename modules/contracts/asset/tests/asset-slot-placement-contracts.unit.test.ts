import { describe, expect, it } from "../../../testing/node-test";

import {
  ASSET_PLACEMENT_SCHEMA_VERSION,
  ASSET_SLOT_DEFINITION_SCHEMA_VERSION,
  MAX_ASSET_PLACEMENTS_PER_COMPOSITION,
  MAX_ASSET_SLOT_CHILDREN,
  normalizeAssetId,
  normalizeAssetPlacement,
  normalizeAssetPlacements,
  normalizeAssetSlotDefinition,
  normalizeAssetSlotDefinitions,
  type AssetPlacement,
  type AssetSlotDefinition,
} from "..";

function slot(
  slotId = "main-content",
  overrides: Partial<AssetSlotDefinition> = {},
): AssetSlotDefinition {
  return {
    schemaVersion: ASSET_SLOT_DEFINITION_SCHEMA_VERSION,
    slotId: slotId as AssetSlotDefinition["slotId"],
    displayName: " Main content ",
    cardinality: { minItems: 1, maxItems: 8 },
    acceptedAssetTypes: ["page", "ui-component"],
    ...overrides,
  };
}

function placement(
  placementId: string,
  childId: string,
  order: number,
  overrides: Partial<AssetPlacement> = {},
): AssetPlacement {
  return {
    schemaVersion: ASSET_PLACEMENT_SCHEMA_VERSION,
    placementId,
    parentInstanceRef: {
      kind: "asset-instance",
      id: normalizeAssetId("instance.parent"),
    },
    slotId: "main-content" as AssetPlacement["slotId"],
    childInstanceRef: {
      kind: "asset-instance",
      id: normalizeAssetId(childId),
    },
    order,
    ...overrides,
  };
}

describe("asset slot definition contracts", () => {
  it("normalizes a bounded exact slot definition and round-trips as JSON", () => {
    const normalized = normalizeAssetSlotDefinition(
      slot(" Main-Content ", {
        acceptedAssetTypes: undefined,
        acceptedDefinitionRefs: [
          {
            kind: "asset-definition-version",
            id: normalizeAssetId("builtin.shell.page"),
            version: "2.0.0",
          },
        ],
      }),
    );

    expect(normalized.slotId).toBe("main-content");
    expect(normalized.displayName).toBe("Main content");
    expect(normalized.acceptedDefinitionRefs?.[0]).toMatchObject({
      id: "builtin.shell.page",
      version: "2.0.0",
    });
    expect(JSON.parse(JSON.stringify(normalized))).toEqual(normalized);
  });

  it("rejects unknown schemas, unsafe ids, invalid cardinality, and duplicates", () => {
    expect(() =>
      normalizeAssetSlotDefinition({
        ...slot(),
        schemaVersion: "asset-slot-definition.v2" as never,
      }),
    ).toThrow(/schema version/i);
    expect(() => normalizeAssetSlotDefinition(slot("../content"))).toThrow(
      /slot id/i,
    );
    expect(() =>
      normalizeAssetSlotDefinition(
        slot("content", {
          cardinality: { minItems: 2, maxItems: 1 },
        }),
      ),
    ).toThrow(/cardinality/i);
    expect(() => normalizeAssetSlotDefinitions([slot(), slot()])).toThrow(
      /unique/i,
    );
    expect(() =>
      normalizeAssetSlotDefinition(
        slot("content", {
          acceptedAssetTypes: undefined,
          acceptedDefinitionRefs: [
            {
              kind: "asset-definition",
              id: normalizeAssetId("builtin.shell.page"),
            },
          ],
        }),
      ),
    ).toThrow(/exact definition version/i);
  });
});

describe("asset placement contracts", () => {
  it("normalizes and JSON round-trips ordered containment separately from bindings", () => {
    const normalized = normalizeAssetPlacement(
      placement(" placement.page ", "instance.page", 0),
    );
    expect(normalized).toMatchObject({
      placementId: "placement.page",
      slotId: "main-content",
      order: 0,
    });
    expect("bindingKind" in normalized).toBe(false);
    expect(JSON.parse(JSON.stringify(normalized))).toEqual(normalized);
  });

  it("rejects unsupported schemas, duplicate children, positions, self placement, and bounds", () => {
    expect(() =>
      normalizeAssetPlacement({
        ...placement("placement.one", "instance.child", 0),
        schemaVersion: "asset-placement.v2" as never,
      }),
    ).toThrow(/schema version/i);
    expect(() =>
      normalizeAssetPlacement(
        placement("placement.one", "instance.child", MAX_ASSET_SLOT_CHILDREN),
      ),
    ).toThrow(/order/i);
    expect(() =>
      normalizeAssetPlacements([
        placement("placement.one", "instance.child", 0),
        placement("placement.two", "instance.child", 1),
      ]),
    ).toThrow(/one placement parent/i);
    expect(() =>
      normalizeAssetPlacements([
        placement("placement.one", "instance.child-a", 0),
        placement("placement.two", "instance.child-b", 0),
      ]),
    ).toThrow(/order must be unique/i);
    expect(() =>
      normalizeAssetPlacement(
        placement("placement.self", "instance.parent", 0),
      ),
    ).toThrow(/cannot contain itself/i);
    expect(() =>
      normalizeAssetPlacements(
        Array.from(
          { length: MAX_ASSET_PLACEMENTS_PER_COMPOSITION + 1 },
          (_, index) =>
            placement(
              `placement.${index}`,
              `instance.child.${index}`,
              index % 64,
            ),
        ),
      ),
    ).toThrow(/at most/i);
  });
});
