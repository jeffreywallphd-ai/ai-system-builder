import { createHash } from "node:crypto";

import { describe, expect, it } from "../../../../testing/node-test";
import { validateAssetDefinition } from "../../asset/validate-asset-definition.service";
import {
  SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS,
  SYSTEM_FOUNDATION_LAYOUT_PRESETS,
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
  SYSTEM_FOUNDATION_PAGE_LAYOUT_IDS,
} from "../system-packs";

describe("System Foundation predefined layout release", () => {
  it("keeps the 1.0.0 manifest immutable while publishing a complete 2.0.0 release", () => {
    expect(SYSTEM_FOUNDATION_PACK_MANIFEST.version).toBe("1.0.0");
    expect(SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length).toBe(105);
    expect(
      createHash("sha256")
        .update(JSON.stringify(SYSTEM_FOUNDATION_PACK_MANIFEST))
        .digest("hex"),
    ).toBe("1433b92aa8ed0fa4f963f1874ace22a4634275d89501e1b95e8a72aa4ec9a2e7");

    expect(SYSTEM_FOUNDATION_PACK_V2_MANIFEST.version).toBe("2.0.0");
    expect(SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.length).toBe(119);
    expect(
      SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.every(
        (entry) => entry.definition.version === "2.0.0",
      ),
    ).toBe(true);
    expect(
      new Set(
        SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.map(
          (entry) => entry.entryId,
        ),
      ).size,
    ).toBe(SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.length);
  });

  it("publishes all eight application shells and six bounded page layouts", () => {
    expect(SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS.length).toBe(8);
    expect(SYSTEM_FOUNDATION_PAGE_LAYOUT_IDS.length).toBe(6);
    expect(SYSTEM_FOUNDATION_LAYOUT_PRESETS.length).toBe(14);

    const ids = new Set(
      SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.map((entry) =>
        String(entry.definition.definitionId),
      ),
    );
    for (const id of [
      ...SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS,
      ...SYSTEM_FOUNDATION_PAGE_LAYOUT_IDS,
    ]) {
      expect(ids.has(id)).toBe(true);
    }

    const root = SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.find(
      (entry) => entry.definition.definitionId === "builtin.system.system",
    )?.definition;
    expect(root?.slots?.length).toBe(1);
    expect(root?.slots?.[0]).toMatchObject({
      slotId: "application-shell",
      cardinality: { minItems: 1, maxItems: 1 },
    });
    expect(root?.slots?.[0]?.acceptedDefinitionRefs?.length).toBe(8);
  });

  it("uses declared logical slots, rectangular responsive areas, and accessible source order", () => {
    for (const preset of SYSTEM_FOUNDATION_LAYOUT_PRESETS) {
      const declared = preset.slots.map((slot) => slot.slotId);
      expect(preset.sourceOrder).toEqual(declared);
      expect(
        declared.some((slotId) => /(?:^|-)(?:left|right)(?:-|$)/.test(slotId)),
      ).toBe(false);
      expect(
        preset.responsive.compact.areas.every((row) => row.length === 1),
      ).toBe(true);
      for (const variant of Object.values(preset.responsive)) {
        const width = variant.areas[0]?.length ?? 0;
        expect(width).toBeGreaterThan(0);
        expect(variant.areas.every((row) => row.length === width)).toBe(true);
        expect(
          variant.areas.flat().every((area) => declared.includes(area as never)),
        ).toBe(true);
      }
    }
  });

  it("passes canonical definition validation for every 2.0.0 asset", () => {
    for (const entry of SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets) {
      const validation = validateAssetDefinition(entry.definition);
      expect(
        validation.issues.filter((issue) => issue.severity === "error"),
      ).toEqual([]);
    }
  });
});
