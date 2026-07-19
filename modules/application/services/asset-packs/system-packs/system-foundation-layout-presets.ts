import type {
  AssetDefinition,
  AssetJsonValue,
  AssetPackAssetEntry,
  AssetReference,
  AssetSlotDefinition,
  AssetType,
} from "../../../../contracts/asset";
import {
  ASSET_SLOT_DEFINITION_SCHEMA_VERSION,
  normalizeAssetId,
  normalizeAssetSlotDefinition,
} from "../../../../contracts/asset";

import {
  SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  SYSTEM_FOUNDATION_PACK_ID,
  SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
} from "./system-foundation-pack.constants";

export const SYSTEM_FOUNDATION_LAYOUT_SCHEMA_VERSION =
  "system-foundation-layout.v1" as const;

export const SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS = [
  "builtin.layout.application.minimal",
  "builtin.layout.application.standard",
  "builtin.layout.application.navigation",
  "builtin.layout.application.navigation-footer",
  "builtin.layout.application.full-height-navigation",
  "builtin.layout.application.split-workspace",
  "builtin.layout.application.review-workspace",
  "builtin.layout.application.immersive",
] as const;

export const SYSTEM_FOUNDATION_PAGE_LAYOUT_IDS = [
  "builtin.layout.page.single",
  "builtin.layout.page.header-content",
  "builtin.layout.page.main-aside",
  "builtin.layout.page.aside-main",
  "builtin.layout.page.equal-split",
  "builtin.layout.page.three-panel",
] as const;

export type SystemFoundationApplicationLayoutId =
  (typeof SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS)[number];
export type SystemFoundationPageLayoutId =
  (typeof SYSTEM_FOUNDATION_PAGE_LAYOUT_IDS)[number];
export type SystemFoundationLayoutId =
  SystemFoundationApplicationLayoutId | SystemFoundationPageLayoutId;

export type SystemFoundationLayoutKind = "application-shell" | "page-layout";
export type SystemFoundationLayoutToken =
  "single" | "start-content" | "content-end" | "equal-split" | "three-panel";

export interface SystemFoundationLayoutVariant {
  readonly columnPattern: SystemFoundationLayoutToken;
  readonly areas: readonly (readonly string[])[];
}

export interface SystemFoundationLayoutPreset {
  readonly schemaVersion: typeof SYSTEM_FOUNDATION_LAYOUT_SCHEMA_VERSION;
  readonly presetId: SystemFoundationLayoutId;
  readonly kind: SystemFoundationLayoutKind;
  readonly displayName: string;
  readonly description: string;
  readonly sourceOrder: readonly string[];
  readonly responsive: {
    readonly compact: SystemFoundationLayoutVariant;
    readonly regular: SystemFoundationLayoutVariant;
    readonly wide: SystemFoundationLayoutVariant;
  };
  readonly slots: readonly AssetSlotDefinition[];
}

interface LayoutSpec {
  readonly id: SystemFoundationLayoutId;
  readonly kind: SystemFoundationLayoutKind;
  readonly displayName: string;
  readonly description: string;
  readonly slots: readonly AssetSlotDefinition[];
  readonly regular: SystemFoundationLayoutVariant;
  readonly wide?: SystemFoundationLayoutVariant;
}

const applicationContentRefs = SYSTEM_FOUNDATION_PAGE_LAYOUT_IDS.map(exactRef);
const visualChildTypes: readonly AssetType[] = ["ui-component", "feature"];

const applicationSpecs: readonly LayoutSpec[] = [
  application(
    "builtin.layout.application.minimal",
    "Minimal",
    "One edge-to-edge content region for a focused application.",
    [applicationContentSlot()],
    variant("single", [["content"]]),
  ),
  application(
    "builtin.layout.application.standard",
    "Standard",
    "A top bar followed by the application content region.",
    [visualSlot("top-bar", "Top bar", 0, 1), applicationContentSlot()],
    variant("single", [["top-bar"], ["content"]]),
  ),
  application(
    "builtin.layout.application.navigation",
    "Navigation",
    "A top bar, logical start sidebar, and application content region.",
    [
      visualSlot("top-bar", "Top bar", 0, 1),
      visualSlot("start-sidebar", "Start sidebar", 0, 1),
      applicationContentSlot(),
    ],
    variant("start-content", [
      ["top-bar", "top-bar"],
      ["start-sidebar", "content"],
    ]),
  ),
  application(
    "builtin.layout.application.navigation-footer",
    "Navigation plus footer",
    "A top bar, logical start sidebar, content region, and footer.",
    [
      visualSlot("top-bar", "Top bar", 0, 1),
      visualSlot("start-sidebar", "Start sidebar", 0, 1),
      applicationContentSlot(),
      visualSlot("footer", "Footer", 0, 1),
    ],
    variant("start-content", [
      ["top-bar", "top-bar"],
      ["start-sidebar", "content"],
      ["footer", "footer"],
    ]),
  ),
  application(
    "builtin.layout.application.full-height-navigation",
    "Full-height navigation",
    "A persistent logical start navigation region beside a top bar and content.",
    [
      visualSlot("top-bar", "Top bar", 0, 1),
      visualSlot("start-sidebar", "Start sidebar", 0, 1),
      applicationContentSlot(),
    ],
    variant("start-content", [
      ["start-sidebar", "top-bar"],
      ["start-sidebar", "content"],
    ]),
  ),
  application(
    "builtin.layout.application.split-workspace",
    "Split workspace",
    "A top bar over equal logical start and end work panels.",
    [
      visualSlot("top-bar", "Top bar", 0, 1),
      pageHostSlot("start-panel", "Start panel", 1, 1),
      pageHostSlot("end-panel", "End panel", 1, 1),
    ],
    variant("equal-split", [
      ["top-bar", "top-bar"],
      ["start-panel", "end-panel"],
    ]),
  ),
  application(
    "builtin.layout.application.review-workspace",
    "Review workspace",
    "A review-oriented shell with start navigation, content, end context, and footer.",
    [
      visualSlot("top-bar", "Top bar", 0, 1),
      visualSlot("start-sidebar", "Start sidebar", 0, 1),
      applicationContentSlot(),
      visualSlot("end-panel", "End panel", 0, 1),
      visualSlot("footer", "Footer", 0, 1),
    ],
    variant("three-panel", [
      ["top-bar", "top-bar", "top-bar"],
      ["start-sidebar", "content", "end-panel"],
      ["footer", "footer", "footer"],
    ]),
  ),
  application(
    "builtin.layout.application.immersive",
    "Immersive",
    "A chrome-free content region for focused or media-rich experiences.",
    [applicationContentSlot()],
    variant("single", [["content"]]),
  ),
];

const pageSpecs: readonly LayoutSpec[] = [
  page(
    "builtin.layout.page.single",
    "Single content",
    "One ordered content region.",
    [pageContentSlot()],
    variant("single", [["content"]]),
  ),
  page(
    "builtin.layout.page.header-content",
    "Page header plus content",
    "A page header followed by ordered content.",
    [visualSlot("page-header", "Page header", 0, 1), pageContentSlot()],
    variant("single", [["page-header"], ["content"]]),
  ),
  page(
    "builtin.layout.page.main-aside",
    "Main plus end aside",
    "Main content with an optional logical end aside.",
    [pageContentSlot(), visualSlot("end-aside", "End aside", 0, 1)],
    variant("content-end", [["content", "end-aside"]]),
  ),
  page(
    "builtin.layout.page.aside-main",
    "Start aside plus main",
    "An optional logical start aside followed by main content.",
    [visualSlot("start-aside", "Start aside", 0, 1), pageContentSlot()],
    variant("start-content", [["start-aside", "content"]]),
  ),
  page(
    "builtin.layout.page.equal-split",
    "Equal split",
    "Two required equal work panels.",
    [
      visualSlot("start-panel", "Start panel", 1, 64),
      visualSlot("end-panel", "End panel", 1, 64),
    ],
    variant("equal-split", [["start-panel", "end-panel"]]),
  ),
  page(
    "builtin.layout.page.three-panel",
    "Three panel",
    "Optional logical side panels surrounding required content.",
    [
      visualSlot("start-panel", "Start panel", 0, 1),
      pageContentSlot(),
      visualSlot("end-panel", "End panel", 0, 1),
    ],
    variant("three-panel", [["start-panel", "content", "end-panel"]]),
  ),
];

export const SYSTEM_FOUNDATION_LAYOUT_PRESETS: readonly SystemFoundationLayoutPreset[] =
  [...applicationSpecs, ...pageSpecs].map(createPreset);

export const SYSTEM_FOUNDATION_LAYOUT_DEFINITIONS: readonly AssetDefinition[] =
  SYSTEM_FOUNDATION_LAYOUT_PRESETS.map(createDefinition);

export const SYSTEM_FOUNDATION_LAYOUT_ENTRIES: readonly AssetPackAssetEntry[] =
  SYSTEM_FOUNDATION_LAYOUT_DEFINITIONS.map((definition) =>
    createEntry(definition),
  );

const presetsById = new Map(
  SYSTEM_FOUNDATION_LAYOUT_PRESETS.map((preset) => [preset.presetId, preset]),
);

export function readSystemFoundationLayoutPreset(
  definitionId: string,
): SystemFoundationLayoutPreset | undefined {
  return presetsById.get(definitionId as SystemFoundationLayoutId);
}

export function createSystemRootSlotDefinition(): AssetSlotDefinition {
  return slot("application-shell", "Application shell", 1, 1, {
    acceptedDefinitionRefs:
      SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS.map(exactRef),
  });
}

function application(
  id: SystemFoundationApplicationLayoutId,
  displayName: string,
  description: string,
  slots: readonly AssetSlotDefinition[],
  regular: SystemFoundationLayoutVariant,
): LayoutSpec {
  return {
    id,
    kind: "application-shell",
    displayName,
    description,
    slots,
    regular,
  };
}

function page(
  id: SystemFoundationPageLayoutId,
  displayName: string,
  description: string,
  slots: readonly AssetSlotDefinition[],
  regular: SystemFoundationLayoutVariant,
): LayoutSpec {
  return { id, kind: "page-layout", displayName, description, slots, regular };
}

function createPreset(spec: LayoutSpec): SystemFoundationLayoutPreset {
  const sourceOrder = spec.slots.map((item) => item.slotId);
  return {
    schemaVersion: SYSTEM_FOUNDATION_LAYOUT_SCHEMA_VERSION,
    presetId: spec.id,
    kind: spec.kind,
    displayName: spec.displayName,
    description: spec.description,
    sourceOrder,
    responsive: {
      compact: variant(
        "single",
        sourceOrder.map((slotId) => [slotId]),
      ),
      regular: spec.regular,
      wide: spec.wide ?? spec.regular,
    },
    slots: spec.slots,
  };
}

function createDefinition(
  preset: SystemFoundationLayoutPreset,
): AssetDefinition {
  const definitionId = normalizeAssetId(preset.presetId);
  const layoutMetadata = preset as unknown as AssetJsonValue;
  return {
    definitionId,
    assetType: preset.kind === "page-layout" ? "page" : "ui-component",
    assetFamily: "structural",
    version: SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
    displayName: preset.displayName,
    description: preset.description,
    lifecycleStatus: "published",
    reviewStatus: "approved",
    provenance: {
      sourceKind: "system-generated",
      authorship: "human-authored",
      metadata: sourceMetadata(preset),
    },
    configurationSchema: {
      schemaId: `${preset.presetId}.configuration`,
      schemaVersion: SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
      fields: [
        {
          fieldId: "title",
          valueKind: "string",
          label: "Title",
          required: false,
          defaultValue: preset.displayName,
          uiHint: { hintKind: "text" },
        },
        {
          fieldId: "accessibilityLabel",
          valueKind: "string",
          label: "Accessibility label",
          required: false,
          defaultValue: preset.displayName,
          uiHint: { hintKind: "text" },
        },
      ],
      strict: true,
      description: "Safe semantic configuration for a predefined layout.",
    },
    defaultConfiguration: {
      title: preset.displayName,
      accessibilityLabel: preset.displayName,
    },
    slots: preset.slots,
    compositionRules: [
      {
        ruleId: `${preset.presetId}.slot-containment`,
        ruleKind: "allowed-child",
        allowedChildTypes: ["page", "ui-component", "feature"],
        description: "Children are accepted only through declared named slots.",
        metadata: {
          layoutPresetId: preset.presetId,
          placementSchemaVersion: "asset-placement.v1",
        },
      },
    ],
    aiContext: {
      purpose: preset.description,
      userFacingSummary: `${preset.displayName} is a predefined responsive layout.`,
      developerFacingSummary:
        "A host-neutral, declarative layout interpreted only by trusted Foundation renderers.",
      capabilities: [
        {
          capabilityId: `${preset.presetId}.named-slots`,
          summary: "Contains compatible children in bounded named slots.",
        },
      ],
      limitations: [
        {
          limitationId: `${preset.presetId}.no-freeform-layout`,
          summary:
            "Does not accept arbitrary dimensions, CSS, grid coordinates, or executable code.",
        },
      ],
      configurationGuidance: {
        summary:
          "Use semantic labels only; dimensions are controlled by the preset.",
        recommendedDefaults: {
          title: preset.displayName,
          accessibilityLabel: preset.displayName,
        },
      },
      compositionGuidance: {
        summary:
          "Place children only through the declared slots and preserve source order.",
        bindingGuidance:
          "Use AssetPlacement for containment and AssetBinding only for typed connections.",
      },
    },
    metadata: {
      ...sourceMetadata(preset),
      builtIn: true,
      systemOwned: true,
      declarativeOnly: true,
      functional: true,
      layoutPreset: layoutMetadata,
    },
  };
}

function createEntry(definition: AssetDefinition): AssetPackAssetEntry {
  const category =
    definition.assetType === "page"
      ? "page-feature-shells"
      : "workflow-system-shells";
  const fingerprint = `fnv1a:${fnv1a(stableStringify(definition))}`;
  return {
    entryId: `system.foundation.${String(definition.definitionId).replace(/^builtin\./, "")}`,
    definition,
    definitionRef: exactRef(String(definition.definitionId)),
    category,
    sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
    fingerprint,
    tags: ["foundation", "layout", category],
    metadata: {
      sourcePack: {
        packId: SYSTEM_FOUNDATION_PACK_ID,
        version: SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
      },
      layoutPresetId: String(definition.definitionId),
      systemOwned: true,
      fingerprint,
    },
  };
}

function applicationContentSlot(): AssetSlotDefinition {
  return pageHostSlot("content", "Content", 1, 64);
}

function pageHostSlot(
  slotId: string,
  displayName: string,
  minItems: number,
  maxItems: number,
): AssetSlotDefinition {
  return slot(slotId, displayName, minItems, maxItems, {
    acceptedDefinitionRefs: applicationContentRefs,
  });
}

function pageContentSlot(): AssetSlotDefinition {
  return visualSlot("content", "Content", 1, 128);
}

function visualSlot(
  slotId: string,
  displayName: string,
  minItems: number,
  maxItems: number,
): AssetSlotDefinition {
  return slot(slotId, displayName, minItems, maxItems, {
    acceptedAssetTypes: visualChildTypes,
  });
}

function slot(
  slotId: string,
  displayName: string,
  minItems: number,
  maxItems: number,
  acceptance: Pick<
    AssetSlotDefinition,
    "acceptedAssetTypes" | "acceptedDefinitionRefs"
  >,
): AssetSlotDefinition {
  return normalizeAssetSlotDefinition({
    schemaVersion: ASSET_SLOT_DEFINITION_SCHEMA_VERSION,
    slotId: slotId as AssetSlotDefinition["slotId"],
    displayName,
    cardinality: { minItems, maxItems },
    ...acceptance,
  });
}

function exactRef(definitionId: string): AssetReference {
  return {
    kind: "asset-definition-version",
    id: normalizeAssetId(definitionId),
    version: SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  };
}

function variant(
  columnPattern: SystemFoundationLayoutToken,
  areas: readonly (readonly string[])[],
): SystemFoundationLayoutVariant {
  return { columnPattern, areas };
}

function sourceMetadata(
  preset: SystemFoundationLayoutPreset,
): Record<string, AssetJsonValue> {
  return {
    sourcePackId: SYSTEM_FOUNDATION_PACK_ID,
    sourcePackVersion: SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
    sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
    layoutPresetId: preset.presetId,
    layoutKind: preset.kind,
  };
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
    )
    .join(",")}}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
