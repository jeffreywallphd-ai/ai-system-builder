import { describe, expect, it } from "../../../../testing/node-test";
import type {
  AssetInstance,
  AssetPlacement,
} from "../../../../contracts/asset";
import {
  ASSET_PLACEMENT_SCHEMA_VERSION,
  normalizeAssetId,
  normalizeAssetSlotId,
} from "../../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../../contracts/system-builder";
import type { SystemComposerDraft } from "../systemComposerDraft";
import {
  instanceDragData,
  paletteDragData,
  resolveSystemComposerDrop,
  slotDropData,
  targetForSystemComposerDrop,
} from "../systemComposerDrag";

describe("System composer drag resolution", () => {
  it("resolves a compatible palette asset into an append-only canonical add intent", () => {
    const fixture = createFixture(3);
    const resolution = resolveSystemComposerDrop({
      source: paletteDragData(fixture.card),
      destination: slotDropData({
        parentInstanceId: "instance.layout",
        slotId: "content",
        label: "Content slot",
      }),
      draft: fixture.draft,
      catalog: fixture.catalog,
      compatibleAssets: [fixture.card],
      compatibilityTarget: {
        parentInstanceId: "instance.layout",
        slotId: "content",
      },
      protectedInstanceIds: new Set(),
    });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.value).toMatchObject({
      kind: "add",
      asset: fixture.card,
      target: {
        parentInstanceId: "instance.layout",
        slotId: "content",
        order: 2,
      },
    });
    expect(JSON.stringify(resolution.value)).not.toContain("sensor");
  });

  it("resolves sortable instances before the hovered sibling without changing identity", () => {
    const fixture = createFixture(3);
    const first = fixture.draft.placements[0]!;
    const second = fixture.draft.placements[1]!;
    const resolution = resolveSystemComposerDrop({
      source: instanceDragData({
        instanceId: "instance.card.two",
        definitionId: fixture.card.definitionId,
        version: fixture.card.version,
        label: "Card two",
        placement: second,
      }),
      destination: instanceDragData({
        instanceId: "instance.card.one",
        definitionId: fixture.card.definitionId,
        version: fixture.card.version,
        label: "Card one",
        placement: first,
      }),
      draft: fixture.draft,
      catalog: fixture.catalog,
      compatibleAssets: [],
      protectedInstanceIds: new Set(),
    });

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.value).toMatchObject({
      kind: "place",
      instanceId: "instance.card.two",
      target: {
        parentInstanceId: "instance.layout",
        slotId: "content",
        order: 0,
      },
    });
    expect(
      targetForSystemComposerDrop(
        instanceDragData({
          instanceId: "instance.card.one",
          definitionId: fixture.card.definitionId,
          version: fixture.card.version,
          label: "Card one",
          placement: first,
        }),
        fixture.draft.placements,
      ),
    ).toEqual({
      parentInstanceId: "instance.layout",
      slotId: "content",
      order: 0,
    });
  });

  it("rejects protected, incompatible, full, and invalid destinations", () => {
    const protectedFixture = createFixture(3);
    const protectedSource = instanceDragData({
      instanceId: "instance.card.one",
      definitionId: protectedFixture.card.definitionId,
      version: protectedFixture.card.version,
      label: "Card one",
      placement: protectedFixture.draft.placements[0]!,
    });
    const destination = slotDropData({
      parentInstanceId: "instance.layout",
      slotId: "content",
      label: "Content slot",
    });
    const protectedResolution = resolveSystemComposerDrop({
      source: protectedSource,
      destination,
      draft: protectedFixture.draft,
      catalog: protectedFixture.catalog,
      compatibleAssets: [protectedFixture.card],
      compatibilityTarget: {
        parentInstanceId: "instance.layout",
        slotId: "content",
      },
      protectedInstanceIds: new Set(["instance.card.one"]),
    });
    expect(protectedResolution.ok).toBe(false);
    if (!protectedResolution.ok) {
      expect(protectedResolution.message.includes("required")).toBe(true);
    }

    const fullFixture = createFixture(2);
    const fullResolution = resolveSystemComposerDrop({
      source: paletteDragData(fullFixture.card),
      destination,
      draft: fullFixture.draft,
      catalog: fullFixture.catalog,
      compatibleAssets: [fullFixture.card],
      compatibilityTarget: {
        parentInstanceId: "instance.layout",
        slotId: "content",
      },
      protectedInstanceIds: new Set(),
    });
    expect(fullResolution.ok).toBe(false);
    if (!fullResolution.ok) {
      expect(fullResolution.message.includes("limit")).toBe(true);
    }

    const incompatibleFixture = createFixture(3);
    const incompatibleResolution = resolveSystemComposerDrop({
      source: paletteDragData(incompatibleFixture.card),
      destination,
      draft: incompatibleFixture.draft,
      catalog: incompatibleFixture.catalog,
      compatibleAssets: [],
      compatibilityTarget: {
        parentInstanceId: "instance.layout",
        slotId: "content",
      },
      protectedInstanceIds: new Set(),
    });
    expect(incompatibleResolution.ok).toBe(false);
    if (!incompatibleResolution.ok) {
      expect(incompatibleResolution.message.includes("not compatible")).toBe(
        true,
      );
    }

    const invalidResolution = resolveSystemComposerDrop({
      source: paletteDragData(incompatibleFixture.card),
      destination: undefined,
      draft: incompatibleFixture.draft,
      catalog: incompatibleFixture.catalog,
      compatibleAssets: [incompatibleFixture.card],
      protectedInstanceIds: new Set(),
    });
    expect(invalidResolution.ok).toBe(false);
    if (!invalidResolution.ok) {
      expect(invalidResolution.message.includes("canvas region")).toBe(true);
    }
  });

  it("fails closed for malformed external drag payloads without exposing their values", () => {
    const fixture = createFixture(3);
    const draftBefore = JSON.stringify(fixture.draft);
    const protectedValue = "../protected-drag-value";

    const malformedSource = resolveSystemComposerDrop({
      source: {
        kind: "instance",
        instanceId: protectedValue,
        definitionId: fixture.card.definitionId,
        version: fixture.card.version,
        label: protectedValue,
        parentInstanceId: "instance.layout",
        slotId: "content",
        order: -1,
      },
      destination: slotDropData({
        parentInstanceId: "instance.layout",
        slotId: "content",
        label: "Content slot",
      }),
      draft: fixture.draft,
      catalog: fixture.catalog,
      compatibleAssets: [fixture.card],
      protectedInstanceIds: new Set(),
    });
    expect(malformedSource).toEqual({
      ok: false,
      message: "The dragged asset is unavailable.",
    });

    const inventedDestination = resolveSystemComposerDrop({
      source: paletteDragData(fixture.card),
      destination: slotDropData({
        parentInstanceId: protectedValue,
        slotId: "invented-slot",
        label: protectedValue,
      }),
      draft: fixture.draft,
      catalog: fixture.catalog,
      compatibleAssets: [fixture.card],
      compatibilityTarget: {
        parentInstanceId: protectedValue,
        slotId: "invented-slot",
      },
      protectedInstanceIds: new Set(),
    });
    expect(inventedDestination).toEqual({
      ok: false,
      message: "The requested canvas region is unavailable.",
    });

    expect(
      JSON.stringify([malformedSource, inventedDestination]),
    ).not.toContain(protectedValue);
    expect(JSON.stringify(fixture.draft)).toBe(draftBefore);
  });
});

function createFixture(maxItems: number): {
  readonly draft: SystemComposerDraft;
  readonly card: SystemBuilderComposerAsset;
  readonly catalog: readonly SystemBuilderComposerAsset[];
} {
  const layout = asset("builtin.layout.application.minimal", [
    { slotId: "content", maxItems },
  ]);
  const card = asset("builtin.container.card");
  const draft: SystemComposerDraft = {
    instances: [
      instance("instance.layout", layout.definitionId),
      instance("instance.card.one", card.definitionId),
      instance("instance.card.two", card.definitionId),
    ],
    placements: [
      placement("instance.layout", "content", "instance.card.one", 0),
      placement("instance.layout", "content", "instance.card.two", 1),
    ],
    bindings: [],
  };
  return { draft, card, catalog: [layout, card] };
}

function instance(instanceId: string, definitionId: string): AssetInstance {
  return {
    instanceId: normalizeAssetId(instanceId),
    definitionRef: {
      kind: "asset-definition-version",
      id: normalizeAssetId(definitionId),
      version: "2.0.0",
    },
    displayName: instanceId,
    lifecycleStatus: "draft",
    selectedConfiguration: {},
    provenance: { sourceKind: "system-generated" },
  };
}

function placement(
  parentId: string,
  slotId: string,
  childId: string,
  order: number,
): AssetPlacement {
  return {
    schemaVersion: ASSET_PLACEMENT_SCHEMA_VERSION,
    placementId: normalizeAssetId(`placement.${childId}`),
    parentInstanceRef: {
      kind: "asset-instance",
      id: normalizeAssetId(parentId),
    },
    slotId: normalizeAssetSlotId(slotId),
    childInstanceRef: { kind: "asset-instance", id: normalizeAssetId(childId) },
    order,
  };
}

function asset(
  definitionId: string,
  slots: readonly { readonly slotId: string; readonly maxItems: number }[] = [],
): SystemBuilderComposerAsset {
  return {
    definitionRef: {
      kind: "asset-definition-version",
      id: normalizeAssetId(definitionId),
      version: "2.0.0",
    },
    definitionId,
    version: "2.0.0",
    displayName: definitionId,
    description: `${definitionId} description`,
    assetType: "ui-component",
    assetFamily: "structural",
    lifecycleStatus: "published",
    builtIn: true,
    ports: [],
    slots: slots.map((slot) => ({
      schemaVersion: "asset-slot-definition.v1",
      slotId: normalizeAssetSlotId(slot.slotId),
      displayName: slot.slotId,
      cardinality: { minItems: 0, maxItems: slot.maxItems },
      acceptedAssetTypes: ["ui-component"],
    })),
    compatibility: { status: "compatible" },
    implementationAvailability: "trusted-system-foundation",
    previewAvailability: "trusted-declarative",
  };
}
